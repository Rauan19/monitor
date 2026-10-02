import { config } from '../config.js';
import { mikrotik } from '../mikrotik/client.js';
import {
  contarQuedaAtual,
  getOlt,
  getRecentDisconnectGroups,
  listPortLabels,
  updatePollStatus,
  upsertOnlineSessions,
} from '../db/index.js';
import { updateBandwidth } from './bandwidth.js';
import { notifyWebhook } from '../notify.js';
import { enqueueNotification } from '../notifyQueue.js';
import { getActiveCalibration } from '../portCalibration.js';
import { checkLinks } from './links.js';

let timer = null;
let running = false;
let wasConnected = null; // null = ainda não sabemos

// Quantos ciclos seguidos precisam falhar pra valer a pena derrubar e refazer a
// conexao. Um erro isolado (comando lento, CCR ocupado) nao justifica: a
// reconexao custa um login novo e nao conserta nada.
const FALHAS_ATE_RECONECTAR = 3;
let falhasSeguidas = 0;
const outageCooldowns = new Map(); // "port:3" | "region:Centro" -> timestamp do ultimo push

// Grupos que cairam e estao sob observacao, esperando pra ver se voltam.
// chave -> { desde, oltId, port, region }
const emObservacao = new Map();

function descreverPorta(oltId, port) {
  const olt = getOlt(oltId);
  const label = listPortLabels(oltId)[port];
  const texto = [
    olt ? `OLT ${olt.name}` : null,
    label ? `Porta ${port} (${label})` : `Porta ${port}`,
  ]
    .filter(Boolean)
    .join(', ');
  return { olt, label, texto };
}

/**
 * Queda em massa, em duas etapas.
 *
 * Antes isso avisava no instante em que o grupo se formava, e o ciclo roda a
 * cada poucos segundos: ONT que reiniciou, piscada de energia ou cliente
 * mexendo no roteador ja viravam push. Quem recebia reclamava, com razao, que
 * notificava demais, e o alerta que chega sempre acaba ignorado.
 *
 * Agora o grupo detectado so entra em observacao. O push sai depois de
 * `confirmMinutes` e apenas se aquele mesmo grupo CONTINUAR fora. Quem voltou
 * no meio do caminho sai da conta em silencio. Em troca o aviso de queda real
 * atrasa esses minutos, que e o preco de ele significar alguma coisa.
 */
// Exportada pra ser exercitada pelos testes: a confirmacao em duas etapas
// depende de estado entre chamadas, e e justamente isso que precisa de prova.
export function checkCorrelatedOutages() {
  const { threshold, percentThreshold, absoluteThreshold, windowMinutes, cooldownMinutes, confirmMinutes } =
    config.outageAlert;

  // Alerta quando o grupo bate o minimo E (representa boa parte da porta OU e
  // um numero grande em termos absolutos). So o percentual deixava passar
  // queda de 4 clientes numa porta grande; so o absoluto faria porta pequena
  // alertar por qualquer coisa.
  const deveAlertar = (grupo) =>
    grupo.count >= threshold && (grupo.percent >= percentThreshold || grupo.count >= absoluteThreshold);

  const now = Date.now();
  const cooldownMs = cooldownMinutes * 60 * 1000;
  const confirmMs = confirmMinutes * 60 * 1000;

  // --- etapa 1: quem acabou de cair entra na fila de observacao ---
  const { byPort, byRegion } = getRecentDisconnectGroups({ minutes: windowMinutes, threshold });

  const observar = (key, alvo) => {
    if (emObservacao.has(key)) return; // ja esperando, nao reinicia o relogio
    if (now - (outageCooldowns.get(key) || 0) < cooldownMs) return;
    emObservacao.set(key, { desde: now, ...alvo });
  };

  for (const group of byPort) {
    if (!deveAlertar(group)) continue;
    observar(`olt:${group.oltId || 0}:port:${group.port}`, {
      oltId: group.oltId || null,
      port: group.port,
      region: null,
    });
  }
  for (const group of byRegion) {
    if (!deveAlertar(group)) continue;
    observar(`region:${group.region}`, { oltId: null, port: null, region: group.region });
  }

  // --- etapa 2: reconferir os que estao em observacao ---
  // Nao olha mais a janela de queda: a essa altura aquelas desconexoes ja
  // sairam dela. A pergunta aqui e so "desse grupo, quantos continuam fora
  // agora?".
  for (const [key, alvo] of emObservacao) {
    let atual;
    try {
      atual = contarQuedaAtual(alvo);
    } catch (err) {
      console.error('[poller] erro ao reconferir queda:', err?.message || err);
      continue;
    }
    const percent = atual.total > 0 ? atual.count / atual.total : 0;

    if (!deveAlertar({ count: atual.count, percent })) {
      emObservacao.delete(key); // voltaram, nao era queda de verdade
      continue;
    }
    if (now - alvo.desde < confirmMs) continue; // ainda no prazo de espera

    emObservacao.delete(key);
    outageCooldowns.set(key, now);

    const minutosFora = Math.max(1, Math.round((now - alvo.desde) / 60000));
    const pct = Math.round(percent * 100);
    const nomes = atual.names.slice(0, 40);

    if (alvo.region != null) {
      enqueueNotification({
        title: `\u26a0\ufe0f Queda em massa: ${alvo.region}`,
        body: `${atual.count} de ${atual.total} clientes de "${alvo.region}" (${pct}%) seguem fora ha ${minutosFora} min.`,
        data: {
          type: 'outage_region',
          region: alvo.region,
          count: atual.count,
          total: atual.total,
          percent,
          minutesDown: minutosFora,
          names: nomes,
        },
      });
    } else {
      const { olt, label, texto } = descreverPorta(alvo.oltId, alvo.port);
      enqueueNotification({
        title: `\u26a0\ufe0f Queda em massa: ${texto}`,
        body: `${atual.count} de ${atual.total} clientes da ${texto} (${pct}%) seguem fora ha ${minutosFora} min.`,
        data: {
          type: 'outage_port',
          oltId: alvo.oltId,
          oltName: olt?.name || null,
          port: alvo.port,
          label: label || null,
          count: atual.count,
          total: atual.total,
          percent,
          minutesDown: minutosFora,
          names: nomes,
        },
      });
    }
  }
}

async function tick() {
  if (running) return;
  running = true;

  try {
    const clients = await mikrotik.getPppActive();
    falhasSeguidas = 0;
    const result = upsertOnlineSessions(clients);
    updatePollStatus({
      connected: true,
      onlineCount: result.onlineCount,
      error: null,
    });

    if (result.connected || result.disconnected) {
      console.log(
        `[poller] online=${result.onlineCount} +${result.connected} -${result.disconnected}`
      );
    }

    // Sem push de "CCR voltou": o par dele, o de queda, saiu (veja o catch
    // abaixo), e avisar so a volta de algo que nunca foi anunciado nao diz nada.
    if (wasConnected === false) {
      notifyWebhook({ type: 'ccr_up', host: config.mikrotik.host });
    }
    wasConnected = true;

    if (config.webhookNotifyClients && (result.newlyConnected.length || result.newlyDisconnected.length)) {
      notifyWebhook({
        type: 'client_events',
        connected: result.newlyConnected,
        disconnected: result.newlyDisconnected,
      });
    }

    // Roda em todo ciclo, e nao so quando alguem cai: a confirmacao precisa
    // reconferir os grupos em observacao mesmo num ciclo sem queda nova, que e
    // justamente o ciclo em que o grupo ou voltou ou continua fora.
    if (!getActiveCalibration()) {
      try {
        checkCorrelatedOutages();
      } catch (err) {
        console.error('[poller] erro ao checar queda em massa:', err?.message || err);
      }
    }

    try {
      const counters = await mikrotik.getPppoeInterfaceCounters();
      updateBandwidth(counters);
    } catch (bwErr) {
      console.error('[poller] erro ao ler contadores de banda:', bwErr?.message || bwErr);
    }

    try {
      await checkLinks();
    } catch (linkErr) {
      console.error('[poller] erro ao checar links:', linkErr?.message || linkErr);
    }
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[poller] erro:', message);
    updatePollStatus({
      connected: false,
      onlineCount: 0,
      error: message,
    });
    // Nao existe mais push de "CCR fora do ar". Qualquer leitura lenta que
    // estoura o timeout cai aqui, e numa rede com mil sessoes PPPoE isso
    // acontece direto: o aviso disparava a toda hora por conta de ciclo ruim,
    // nao de queda. A queda real continua no status do painel, no historico e
    // no webhook, que e onde ela serve pra alguma coisa.
    if (wasConnected !== false) {
      notifyWebhook({ type: 'ccr_down', host: config.mikrotik.host, error: message });
    }
    wasConnected = false;

    // Antes, QUALQUER erro derrubava a conexao. Um comando lento que estourava
    // o timeout fazia o monitor deslogar e logar de novo no CCR a cada ciclo
    // (o log do roteador registrava dezenas de "user monitor logged in/out via
    // api"), e cada reconexao custa um login novo.
    //
    // Socket realmente morto ja se resolve sozinho: o evento 'close' limpa o
    // estado e a proxima leitura reconecta. Entao aqui so forcamos a reconexao
    // quando varios ciclos seguidos falham, que e o sinal de conexao
    // meio-aberta: o servidor escreve, o CCR nunca responde, e sem isso ficaria
    // preso nesse estado.
    falhasSeguidas += 1;
    if (falhasSeguidas >= FALHAS_ATE_RECONECTAR) {
      console.error(`[poller] ${falhasSeguidas} falhas seguidas, reconectando no CCR`);
      falhasSeguidas = 0;
      try {
        await mikrotik.disconnect();
      } catch {
        // ignore
      }
    }
  } finally {
    running = false;
  }
}

export function startPoller() {
  if (timer) return;
  console.log(
    `[poller] iniciando em ${config.mikrotik.host}:${config.mikrotik.port} a cada ${config.pollIntervalMs}ms`
  );
  tick();
  timer = setInterval(tick, config.pollIntervalMs);
}

export function stopPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
