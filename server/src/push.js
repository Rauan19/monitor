import { listPushTokens, removePushTokens } from './db/index.js';
import { sendFcmWebPush } from './fcm.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Manda notificação push pra uma lista de tokens.
 * Tokens do app mobile (Expo) vão pela API do Expo; tokens do navegador (web)
 * vão direto pro FCM v1, já que não passam pelo Expo.
 * Best-effort: nunca lança erro pro chamador. Remove tokens inválidos/expirados.
 * Devolve um resumo do envio ({ sent, failed, errors }) pro endpoint de teste.
 */
export async function sendPushToTokens(tokens, { title, body, data }) {
  const list = tokens.filter(Boolean);
  if (!list.length) return { sent: 0, failed: 0, errors: [] };

  const expoTokens = list.filter((t) => t.startsWith('ExponentPushToken'));
  const webTokens = list.filter((t) => !t.startsWith('ExponentPushToken'));

  const deadTokens = [];
  const errors = [];
  let sent = 0;

  if (expoTokens.length) {
    const messages = expoTokens.map((to) => ({
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
          if (ticket?.status === 'error') {
            errors.push(ticket.message || ticket.details?.error || 'erro desconhecido (expo)');
            if (ticket.details?.error === 'DeviceNotRegistered') deadTokens.push(expoTokens[i]);
          } else {
            sent += 1;
          }
        });
      } else {
        const message = json?.errors?.[0]?.message || `HTTP ${res.status}`;
        errors.push(`expo: ${message}`);
      }
    } catch (err) {
      const message = err?.message || String(err);
      console.error('[push] falha ao enviar notificação (expo):', message);
      errors.push(`expo: ${message}`);
    }
  }

  for (const token of webTokens) {
    try {
      const result = await sendFcmWebPush(token, { title, body, data });
      if (result.ok) {
        sent += 1;
        continue;
      }
      errors.push(`web: ${result.error}`);
      if (result.invalid) deadTokens.push(token);
      if (result.error === 'not-configured') break; // web push não configurado, sem sentido tentar de novo pros outros
    } catch (err) {
      const message = err?.message || String(err);
      console.error('[push] falha ao enviar notificação (web):', message);
      errors.push(`web: ${message}`);
    }
  }

  if (deadTokens.length) removePushTokens(deadTokens);

  return { sent, failed: list.length - sent, errors };
}

/** Manda notificação push pra todos os tokens registrados. */
export async function sendPushToAll({ title, body, data }) {
  const tokens = listPushTokens().map((r) => r.token);
  return sendPushToTokens(tokens, { title, body, data });
}
