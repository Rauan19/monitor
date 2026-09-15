import { mikrotik } from '../mikrotik/client.js';
import { listMonitoredLinks, saveLinkEvent, semearLinksSeNecessario } from '../db/index.js';
import { enqueueNotification } from '../notifyQueue.js';

// Vigia o estado das interfaces de transporte do CCR (uplink, fibra pra POP,
// radio pra torre).
//
// Antes disso a queda de um link era descoberta por DEDUCAO: o alerta de queda
// em massa disparava quando varios clientes da mesma porta caiam juntos. Isso
// diz que algo quebrou, mas nao o que quebrou, e so depois dos clientes cairem.
// Lendo /interface print o servidor sabe qual link caiu, na hora.
//
// Limite conhecido: interface de pe nao garante que o equipamento do outro lado
// esta vivo (fibra ok, radio remoto morto). Pra isso e preciso ping, e o usuario
// do monitor e read-only (!test). O caminho nesse caso e o netwatch do RouterOS,
// lido em outra etapa.

// Estado do ciclo anterior, so em memoria: o historico no banco guarda as
// transicoes, aqui basta saber o que mudou de um ciclo pro outro.
const anterior = new Map(); // name -> { running, linkDowns }

let primeiraLeitura = true;

export async function checkLinks() {
  const interfaces = await mikrotik.getInterfaces();
  if (!interfaces.length) return; // falha de leitura: nao inventa queda

  // Na primeira execucao cadastra sozinho os links de transporte, pra tela nao
  // nascer vazia esperando o operador escolher entre mais de mil interfaces.
  const semeados = semearLinksSeNecessario(interfaces);
  if (semeados?.length) {
    console.log(`[links] cadastrados automaticamente ${semeados.length} links de transporte: ${semeados.join(', ')}`);
  }

  const vigiados = listMonitoredLinks();
  if (!vigiados.length) return; // nada cadastrado, nada a fazer

  const porNome = new Map(vigiados.map((l) => [l.name, l.label]));

  for (const iface of interfaces) {
    if (!porNome.has(iface.name)) continue;
    const label = porNome.get(iface.name);
    const antes = anterior.get(iface.name);
    const agora = { running: iface.running, linkDowns: iface.linkDowns };
    anterior.set(iface.name, agora);

    // Na primeira leitura depois de subir o servidor nao existe "antes", entao
    // qualquer coisa pareceria mudanca. Um link que ja estava caido antes do
    // restart nao e uma queda nova e nao deve gerar alerta.
    if (primeiraLeitura || !antes) continue;

    const desc = label ? `${iface.name} (${label})` : iface.name;

    if (antes.running && !iface.running) {
      saveLinkEvent({ name: iface.name, label, eventType: 'down', linkDowns: iface.linkDowns });
      enqueueNotification(
        {
          title: `🔴 Link caiu: ${desc}`,
          body: `A interface ${iface.name} parou de responder no CCR.`,
          data: { type: 'link_down', name: iface.name, label: label || null },
        },
        { priority: true }
      );
      continue;
    }

    if (!antes.running && iface.running) {
      saveLinkEvent({ name: iface.name, label, eventType: 'up', linkDowns: iface.linkDowns });
      enqueueNotification(
        {
          title: `✅ Link voltou: ${desc}`,
          body: `A interface ${iface.name} voltou a responder.`,
          data: { type: 'link_up', name: iface.name, label: label || null },
        },
        { priority: true }
      );
      continue;
    }

    // O contador link-downs do RouterOS subiu mas a interface esta de pe: o
    // link caiu e voltou entre duas leituras. Nao da alerta de queda (ja
    // voltou), mas fica registrado: link que pisca e fibra ruim ou radio
    // instavel, e e o tipo de coisa que passa despercebida.
    if (iface.running && antes.linkDowns != null && iface.linkDowns > antes.linkDowns) {
      saveLinkEvent({ name: iface.name, label, eventType: 'flap', linkDowns: iface.linkDowns });
    }
  }

  primeiraLeitura = false;
}

/** Usado pelos testes pra comecar do zero. */
export function resetLinkState() {
  anterior.clear();
  primeiraLeitura = true;
}
