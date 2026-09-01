import { listPushTokens, removePushTokens } from './db/index.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Manda notificação push pra todos os tokens registrados via Expo Push API.
 * Best-effort: nunca lança erro pro chamador. Remove tokens que o Expo reportar como inválidos.
 */
export async function sendPushToAll({ title, body, data }) {
  const tokens = listPushTokens();
  if (!tokens.length) return;

  const messages = tokens.map((to) => ({
    to,
    title,
    body,
    data: data || {},
    sound: 'default',
    channelId: 'default',
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    const json = await res.json().catch(() => null);
    const tickets = json?.data;
    if (!Array.isArray(tickets)) return;

    const deadTokens = [];
    tickets.forEach((ticket, i) => {
      if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        deadTokens.push(tokens[i]);
      }
    });
    if (deadTokens.length) removePushTokens(deadTokens);
  } catch (err) {
    console.error('[push] falha ao enviar notificação:', err?.message || err);
  }
}
