// Fila de notificações: quando várias portas/regiões caem juntas (ex: uma OLT
// inteira caiu), evita disparar todos os pushes de uma vez só: espaça o envio
// pra ficar organizado tanto no celular quanto na aba de notificações do web.
import { saveNotification } from './db/index.js';
import { sendPushToAll } from './push.js';

const GAP_MS = Number(process.env.OUTAGE_ALERT_GAP_MS || 60000);

const queue = [];
let processing = false;

/**
 * Enfileira uma notificação pra envio.
 * `priority` fura a fila: o CCR inteiro fora do ar é mais grave que alertas de
 * porta e não pode ficar esperando 1 min por cada alerta que já estava na fila.
 */
export function enqueueNotification(payload, { priority = false } = {}) {
  if (priority) queue.unshift(payload);
  else queue.push(payload);
  processQueue();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) {
      const payload = queue.shift();
      try {
        await sendPushToAll(payload);
      } catch (err) {
        console.error('[notify] falha ao enviar push:', err?.message || err);
      }
      try {
        saveNotification({
          type: payload.data?.type || null,
          title: payload.title,
          body: payload.body,
          data: payload.data,
        });
      } catch (err) {
        // Gravar o histórico é secundário. Se falhar, não pode derrubar a fila
        // e engolir as notificações que ainda faltam enviar.
        console.error('[notify] falha ao gravar notificação no histórico:', err?.message || err);
      }
      if (queue.length) await sleep(GAP_MS);
    }
  } finally {
    processing = false;
  }
}
