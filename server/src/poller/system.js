import { config } from '../config.js';
import { mikrotik } from '../mikrotik/client.js';
import {
  aquecerCacheAgregacao,
  insertSystemStat,
  insertBandwidthSnapshot,
  insertLogEvents,
  pruneOldData,
} from '../db/index.js';
import { getAllBandwidth } from './bandwidth.js';

let timer = null;
let timerInicial = null;
let rodando = false;

// Desencontra o system-poller (60s) do poller principal (10s).
// Sem esse atraso inicial de 5s, os dois davam partida no mesmo milissegundo
// (0s, 60s, 120s...) e disputavam o CCR juntos. Com 5s de defasagem, o
// system-poller roda em 5s, 65s, 125s..., exatamente no meio da janela ociosa
// entre os ciclos de 10s do poller principal.
const ATRASO_INICIAL_MS = 5000;

async function tick() {
  if (rodando) return;
  rodando = true;
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
  aquecerCacheAgregacao();
  rodando = false;
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
  if (timer || timerInicial) return;
  console.log(`[system-poller] iniciando, a cada ${config.systemPollIntervalMs}ms (defasado em ${ATRASO_INICIAL_MS}ms)`);
  timerInicial = setTimeout(() => {
    timerInicial = null;
    tick();
    timer = setInterval(tick, config.systemPollIntervalMs);
  }, ATRASO_INICIAL_MS);
}

export function stopSystemPoller() {
  if (timerInicial) {
    clearTimeout(timerInicial);
    timerInicial = null;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
