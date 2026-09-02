import { listPushTokens, removePushTokens } from './db/index.js';
import { sendFcmWebPush } from './fcm.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Manda notificação push pra todos os tokens registrados.
 * Tokens do app mobile (Expo) vão pela API do Expo; tokens do navegador (web)
 * vão direto pro FCM v1, já que não passam pelo Expo.
 * Best-effort: nunca lança erro pro chamador. Remove tokens inválidos/expirados.
 */
export async function sendPushToAll({ title, body, data }) {
  const rows = listPushTokens();
  if (!rows.length) return;

  const expoRows = rows.filter((r) => r.token.startsWith('ExponentPushToken'));
  const webRows = rows.filter((r) => !r.token.startsWith('ExponentPushToken'));

  const deadTokens = [];

  if (expoRows.length) {
    const messages = expoRows.map(({ token: to }) => ({
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
      if (Array.isArray(tickets)) {
        tickets.forEach((ticket, i) => {
          if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            deadTokens.push(expoRows[i].token);
          }
        });
      }
    } catch (err) {
      console.error('[push] falha ao enviar notificação (expo):', err?.message || err);
    }
  }

  for (const { token } of webRows) {
    try {
      const result = await sendFcmWebPush(token, { title, body, data });
      if (!result.ok && result.invalid) deadTokens.push(token);
      if (!result.ok && result.error === 'not-configured') break; // web push não configurado, sem sentido tentar de novo pros outros
    } catch (err) {
      console.error('[push] falha ao enviar notificação (web):', err?.message || err);
    }
  }

  if (deadTokens.length) removePushTokens(deadTokens);
}
