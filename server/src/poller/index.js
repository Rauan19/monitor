import { config } from '../config.js';
import { mikrotik } from '../mikrotik/client.js';
import {
  contarQuedaAtual,
  getOlt,
  getPollStatus,
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

// Quantos ciclos seguidos sem leitura ate dizer que o CCR esta fora. Com o
// poller a cada 10s, tres falhas sao uns 30s sem nenhuma resposta. Abaixo disso
// e ciclo ruim, que numa rede com mil sessoes PPPoE acontece o tempo todo.
const FALHAS_ATE_MARCAR_QUEDA = 3;
let falhasSeguidas = 0;

// Quantas sessoes a leitura anterior trouxe, pra detectar uma queda brusca na
// LEITURA (que e defeito nosso ou do CCR) e nao na rede.
let ultimaLeituraDeSessoes = null;
let leiturasSuspeitasSeguidas = 0;

// Abaixo desta fracao da leitura anterior, a leitura e tratada como suspeita.
const FRACAO_SUSPEITA = 0.5;

// Rede pequena oscila: 8 de 12 clientes e metade, e e normal. Abaixo deste
// numero de sessoes a protecao nem opina.
const MINIMO_PRA_DESCONFIAR = 50;

// Quantas leituras suspeitas SEGUIDAS ate acreditar nelas.
//
// Esta e a parte que nao pode faltar. Sem ela, uma queda em massa de verdade
// seria ignorada pra sempre, e o monitor pararia de monitorar exatamente no
// momento que importa. Com o poller a cada 10s, tres leituras batendo no mesmo
// numero baixo sao ~30s de confirmacao: leitura cortada e intermitente e nao
// sobrevive a isso, queda real sobrevive e passa a valer.
const SUSPEITAS_ATE_ACREDITAR = 3;

/**
 * Decide se uma leitura de sessoes deve ser gravada.
 *
 * Por que isso existe: com 1035 sessoes no ar e uma leitura trazendo 157, o
 * upsertOnlineSessions marca 878 clientes como offline. Isso nao erra so a
 * contagem: alimenta o detector de queda em massa e dispara alerta de uma rede
 * que esta inteira no ar. E, no sentido contrario, enterra uma queda real no
 * meio do ruido. Enquanto nao se sabe se o CCR responde pouco ou se perdemos
 * linhas no caminho, a unica conduta segura e nao gravar uma leitura
 * implausivel, e dizer isso no log.
 *
 * Exportada porque e decisao com estado entre chamadas, e e justamente isso
 * que precisa de teste.
 */
export function avaliarLeitura(quantidade) {
  const anterior = ultimaLeituraDeSessoes;
  const suspeita =
    anterior != null &&
    anterior >= MINIMO_PRA_DESCONFIAR &&
    quantidade < anterior * FRACAO_SUSPEITA;

  if (!suspeita) {
    leiturasSuspeitasSeguidas = 0;
    ultimaLeituraDeSessoes = quantidade;
    return { aplicar: true };
  }

  leiturasSuspeitasSeguidas += 1;

  if (leiturasSuspeitasSeguidas >= SUSPEITAS_ATE_ACREDITAR) {
    // Insistiu: passa a valer. Nao mexe em ultimaLeituraDeSessoes pra cima,
    // escreve o valor novo, que agora e a realidade aceita.
    ultimaLeituraDeSessoes = quantidade;
    leiturasSuspeitasSeguidas = 0;
    return {
      aplicar: true,
      aviso:
        `leitura de ${quantidade} sessoes se repetiu ${SUSPEITAS_ATE_ACREDITAR} vezes; ` +
        'tratando como real a partir de agora',
    };
  }

  // NAO atualiza ultimaLeituraDeSessoes: a referencia continua sendo a ultima
  // leitura que a gente acredita. Senao duas leituras cortadas seguidas
  // rebaixariam a referencia e a terceira passaria como normal.
  return {
    aplicar: false,
    motivo:
      `leitura de sessoes caiu de ${anterior} pra ${quantidade} (${leiturasSuspeitasSeguidas}/${SUSPEITAS_ATE_ACREDITAR}); ` +
      'nao vou marcar centenas de clientes como offline com base nisso. ' +
      'Se a rede caiu de verdade, a proxima leitura confirma e vale.',
  };
}

/** Só pros testes: zera o estado entre casos. */
export function _resetarAvaliacaoDeLeitura() {
  ultimaLeituraDeSessoes = null;
  leiturasSuspeitasSeguidas = 0;
}

// De quantos em quantos ciclos ler os contadores de banda. Com o poller a cada
// 10s, 3 da uma leitura a cada 30s.
const CICLOS_POR_LEITURA_DE_BANDA = 3;
let ciclo = 0;
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
  ciclo++;

  try {
    const clients = await mikrotik.getPppActive();
    falhasSeguidas = 0;

    const veredito = avaliarLeitura(clients.length);
    if (!veredito.aplicar) {
      console.warn(`[poller] ${veredito.motivo}`);
      // CCR respondeu, entao a conexao esta de pe: o que nao se confia e o
      // conteudo da resposta. Mantem a contagem anterior em vez de zerar, pra
      // nao transformar uma leitura ruim em "rede fora" na tela.
      updatePollStatus({
        connected: true,
        onlineCount: getPollStatus()?.online_count ?? 0,
        error: null,
      });
      return;
    }
    if (veredito.aviso) console.warn(`[poller] ${veredito.aviso}`);

    const result = upsertOnlineSessions(clients);
    updatePollStatus({
      connected: true,
      onlineCount: result.onlineCount,
      error: null,
    });

    if (result.connected || result.disconnected) {
      // `lidas` e quantas sessoes o CCR devolveu nesta leitura; `online` e
      // quantas ficaram marcadas no banco. As duas juntas separam "o CCR
      // respondeu pouco" de "nos perdemos linhas", que dao o mesmo sintoma de
      // contagem baixa no app e tem consertos opostos. Com `lidas` bem abaixo
      // do normal, a conta nao esta errada: a leitura esta.
      console.log(
        `[poller] lidas=${clients.length} online=${result.onlineCount} +${result.connected} -${result.disconnected}`
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

    // Banda por cliente nao precisa do ritmo do poller.
    //
    // Esta leitura pede ao CCR os contadores das mais de mil interfaces PPPoE.
    // Rodando a cada 10s junto com /ppp/active, era a segunda consulta mais
    // pesada e a que mais aparecia nos timeouts do log. A banda e calculada por
    // DIFERENCA de contador, entao um intervalo maior nao perde informacao: so
    // suaviza o valor, e a amostra que vai pro historico e gravada de minuto em
    // minuto pelo system-poller de qualquer jeito.
    if (ciclo % CICLOS_POR_LEITURA_DE_BANDA === 0) {
      try {
        const counters = await mikrotik.getPppoeInterfaceCounters();
        updateBandwidth(counters);
      } catch (bwErr) {
        console.error('[poller] erro ao ler contadores de banda:', bwErr?.message || bwErr);
      }
    }

    try {
      await checkLinks();
    } catch (linkErr) {
      console.error('[poller] erro ao checar links:', linkErr?.message || linkErr);
    }
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[poller] erro:', message);

    falhasSeguidas += 1;

    // "CCR sem resposta" so depois de falhas SEGUIDAS.
    //
    // Este catch pega qualquer leitura que estourou o timeout, e numa rede com
    // mil sessoes PPPoE isso acontece direto por ciclo ruim, nao por queda: o
    // comentario do push removido logo abaixo ja dizia isso. Mas o status
    // continuava virando "desconectado" na PRIMEIRA falha, entao o painel e o
    // app mostravam o CCR caindo o tempo todo com o CCR de pe. Um ciclo ruim nao
    // e queda; tres seguidos (uns 30s sem leitura nenhuma) ja e.
    //
    // onlineCount so e zerado quando a queda se confirma. Zerar na primeira
    // falha fazia o painel piscar "0 online" e voltar pra mil no ciclo seguinte.
    const quedaConfirmada = falhasSeguidas >= FALHAS_ATE_MARCAR_QUEDA;
    const statusAtual = getPollStatus();
    updatePollStatus({
      connected: !quedaConfirmada && statusAtual?.connected === 1,
      onlineCount: quedaConfirmada ? 0 : statusAtual?.online_count ?? 0,
      error: message,
    });
    if (!quedaConfirmada) {
      console.error(
        `[poller] falha ${falhasSeguidas}/${FALHAS_ATE_MARCAR_QUEDA}, ainda nao marcando o CCR como fora`
      );
    }

    // Nao existe mais push de "CCR fora do ar". O webhook, que resta, so dispara
    // com a queda confirmada, pelo mesmo motivo: ciclo ruim nao e queda.
    if (quedaConfirmada && wasConnected !== false) {
      notifyWebhook({ type: 'ccr_down', host: config.mikrotik.host, error: message });
      wasConnected = false;
    }

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
    //
    // Usa resto da divisao em vez de zerar o contador: zerando, a conta de
    // falhas seguidas reiniciava a cada reconexao e o CCR nunca chegava a ser
    // marcado como fora, por mais tempo que ficasse sem responder. Assim ele
    // tenta reconectar na falha 3, 6, 9... e a contagem segue de pe.
    if (falhasSeguidas % FALHAS_ATE_RECONECTAR === 0) {
      console.error(`[poller] ${falhasSeguidas} falhas seguidas, reconectando no CCR`);
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

/**
 * Um ciclo do poller, pros testes. A regra de "quantas falhas ate dizer que o
 * CCR esta fora" so da pra verificar executando ciclo a ciclo e olhando o
 * status gravado depois de cada um.
 */
export async function tickParaTeste() {
  await tick();
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
