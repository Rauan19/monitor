import { config } from './config.js';

/**
 * Envia um evento pro WEBHOOK_URL configurado (Telegram, Slack, n8n, etc via bot/integração).
 * Best-effort: nunca lança erro pro chamador.
 */
export async function notifyWebhook(event) {
  if (!config.webhookUrl) return;
  try {
    await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...event, timestamp: new Date().toISOString() }),
    });
  } catch (err) {
    console.error('[webhook] falha ao notificar:', err?.message || err);
  }
}
