import { config } from '../config.js';
import { mikrotik } from '../mikrotik/client.js';
import { getRecentDisconnectGroups, updatePollStatus, upsertOnlineSessions } from '../db/index.js';
import { updateBandwidth } from './bandwidth.js';
import { notifyWebhook } from '../notify.js';
import { sendPushToAll } from '../push.js';

let timer = null;
let running = false;
let wasConnected = null; // null = ainda não sabemos
const outageCooldowns = new Map(); // "port:3" | "region:Centro" -> timestamp do último push

function checkCorrelatedOutages() {
  const { threshold, windowMinutes, cooldownMinutes } = config.outageAlert;
  const { byPort, byRegion } = getRecentDisconnectGroups({ minutes: windowMinutes, threshold });
  const now = Date.now();
  const cooldownMs = cooldownMinutes * 60 * 1000;

  for (const group of byPort) {
    const key = `port:${group.port}`;
    const lastSent = outageCooldowns.get(key) || 0;
    if (now - lastSent < cooldownMs) continue;
    outageCooldowns.set(key, now);
    sendPushToAll({
      title: `⚠️ Queda em massa — Porta ${group.port}`,
      body: `${group.count} clientes caíram juntos na porta ${group.port} nos últimos ${windowMinutes} min.`,
      data: { type: 'outage_port', port: group.port, count: group.count, names: group.names },
    });
  }

  for (const group of byRegion) {
    const key = `region:${group.region}`;
    const lastSent = outageCooldowns.get(key) || 0;
    if (now - lastSent < cooldownMs) continue;
    outageCooldowns.set(key, now);
    sendPushToAll({
      title: `⚠️ Queda em massa — ${group.region}`,
      body: `${group.count} clientes caíram juntos em "${group.region}" nos últimos ${windowMinutes} min.`,
      data: { type: 'outage_region', region: group.region, count: group.count, names: group.names },
    });
  }
}

async function tick() {
  if (running) return;
  running = true;

  try {
    const clients = await mikrotik.getPppActive();
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

    if (result.newlyDisconnected.length) {
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
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[poller] erro:', message);
    updatePollStatus({
      connected: false,
      onlineCount: 0,
      error: message,
    });
    if (wasConnected !== false) {
      notifyWebhook({ type: 'ccr_down', host: config.mikrotik.host, error: message });
    }
    wasConnected = false;
    try {
      await mikrotik.disconnect();
    } catch {
      // ignore
    }
  } finally {
    running = false;
  }
}

export function startPoller() {
  if (timer) return;
  console.log(
    `[poller] iniciando — ${config.mikrotik.host}:${config.mikrotik.port} a cada ${config.pollIntervalMs}ms`
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
