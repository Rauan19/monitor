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

  limparSePassouDoPrazo();
}

// Retencao e de 30 dias: limpar de minuto em minuto nao apaga nada a mais do
// que limpar de 6 em 6 horas, e custa caro. Rodando a cada ciclo, a limpeza
// chegou a segurar o processo por segundos (better-sqlite3 e sincrono), e era
// isso que o app via como "sem conexao com o servidor".
const INTERVALO_LIMPEZA_MS = Number(process.env.PRUNE_INTERVAL_MS || 6 * 60 * 60 * 1000);
let ultimaLimpeza = 0;

function limparSePassouDoPrazo() {
  if (Date.now() - ultimaLimpeza < INTERVALO_LIMPEZA_MS) return;
  ultimaLimpeza = Date.now();
  try {
    const inicio = Date.now();
    const apagadas = pruneOldData(config.retentionDays);
    const ms = Date.now() - inicio;
    if (apagadas) console.log(`[system-poller] limpeza: ${apagadas} linhas antigas apagadas em ${ms}ms`);
  } catch (err) {
    console.error('[system-poller] erro ao limpar dados antigos:', err?.message || err);
  }
}

export function startSystemPoller() {
  if (timer) return;
  console.log(`[system-poller] iniciando, a cada ${config.systemPollIntervalMs}ms`);
  tick();
  timer = setInterval(tick, config.systemPollIntervalMs);
}

export function stopSystemPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
