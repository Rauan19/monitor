import { config } from '../config.js';
import { mikrotik } from '../mikrotik/client.js';
import { insertSystemStat, insertBandwidthSnapshot, insertLogEvents, pruneOldData } from '../db/index.js';
import { getAllBandwidth } from './bandwidth.js';

let timer = null;

async function tick() {
  try {
    const [resource, health] = await Promise.all([
      mikrotik.getSystemResource(),
      mikrotik.getSystemHealth(),
    ]);
    insertSystemStat({
      cpuLoad: resource.cpuLoad,
      freeMemory: resource.freeMemory,
      totalMemory: resource.totalMemory,
      voltage: health.voltage != null ? Number(health.voltage) : null,
      temperature: health.temperature != null ? Number(health.temperature) : null,
      uptime: resource.uptime,
    });
  } catch (err) {
    console.error('[system-poller] erro ao ler recursos do CCR:', err?.message || err);
  }

  try {
    insertBandwidthSnapshot(getAllBandwidth());
  } catch (err) {
    console.error('[system-poller] erro ao gravar amostra de banda:', err?.message || err);
  }

  try {
    const logs = await mikrotik.getLogs(200);
    insertLogEvents(logs);
  } catch (err) {
    console.error('[system-poller] erro ao ler log do CCR:', err?.message || err);
  }

  try {
    pruneOldData(config.retentionDays);
  } catch (err) {
    console.error('[system-poller] erro ao limpar dados antigos:', err?.message || err);
  }
}

export function startSystemPoller() {
  if (timer) return;
  console.log(`[system-poller] iniciando — a cada ${config.systemPollIntervalMs}ms`);
  tick();
  timer = setInterval(tick, config.systemPollIntervalMs);
}

export function stopSystemPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
