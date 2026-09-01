import { Router } from 'express';
import {
  getAddressNameMap,
  getBandwidthBaseline,
  getClientBySessionKey,
  getDashboardStats,
  getHourlyLoad,
  getPollStatus,
  getSlaByPort,
  getSlaStats,
  getTopConsumers,
  listAll,
  listBandwidthHistory,
  listDisconnected,
  listDisconnectedForExport,
  listEvents,
  listEventsForExport,
  listEventsForSession,
  listLogEvents,
  listLogTopics,
  listMapPoints,
  listOnline,
  listSystemStats,
  registerPushToken,
  removeSession,
  setAlias,
  setLocation,
  setPort,
  unregisterPushToken,
} from '../db/index.js';
import { config } from '../config.js';
import { getAllBandwidth } from '../poller/bandwidth.js';
import { mikrotik } from '../mikrotik/client.js';

function withBandwidth(result) {
  const bw = getAllBandwidth();
  result.items = result.items.map((item) => {
    const stats = bw[item.name];
    return stats ? { ...item, downBps: stats.downBps, upBps: stats.upBps } : item;
  });
  return result;
}

export const apiRouter = Router();

function pageParams(query) {
  return {
    page: Number(query.page || 1),
    pageSize: Number(query.pageSize || 20),
  };
}

function paginateArray(items, page = 1, pageSize = 20) {
  const size = Math.min(200, Math.max(1, Number(pageSize) || 20));
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size) || 1);
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const offset = (current - 1) * size;
  return { items: items.slice(offset, offset + size), page: current, pageSize: size, total, pages };
}

const TUNNEL_IFACE_TYPE = /^(pppoe|pptp|l2tp|ovpn|sstp)/i;

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

apiRouter.get('/status', (_req, res) => {
  const status = getPollStatus();
  res.json({
    pollIntervalMs: config.pollIntervalMs,
    connected: Boolean(status?.connected),
    last_poll_at: status?.last_poll_at || null,
    last_success_at: status?.last_success_at || null,
    last_error: status?.last_error || null,
    online_count: status?.online_count ?? 0,
  });
});

apiRouter.get('/dashboard', (_req, res) => {
  res.json(getDashboardStats());
});

apiRouter.get('/online', (req, res) => {
  const q = String(req.query.q || '').trim();
  res.json(withBandwidth(listOnline({ q, ...pageParams(req.query) })));
});

apiRouter.get('/disconnected', (req, res) => {
  const hours = Number(req.query.hours || 24);
  const q = String(req.query.q || '').trim();
  res.json(listDisconnected({ hours, q, ...pageParams(req.query) }));
});

apiRouter.get('/all', (req, res) => {
  const q = String(req.query.q || '').trim();
  const port = String(req.query.port || '').trim();
  res.json(withBandwidth(listAll({ q, port, ...pageParams(req.query) })));
});

apiRouter.post('/clients/alias', (req, res) => {
  const { sessionKey, alias } = req.body || {};
  if (!sessionKey || typeof sessionKey !== 'string') {
    return res.status(400).json({ error: 'sessionKey obrigatório' });
  }
  if (typeof alias === 'string' && alias.length > 80) {
    return res.status(400).json({ error: 'Apelido muito longo (máx. 80 caracteres)' });
  }
  const row = setAlias(sessionKey, alias);
  res.json({ ok: true, ...row });
});

apiRouter.post('/clients/location', (req, res) => {
  const { sessionKey, region, city, street, neighborhood, lat, lng } = req.body || {};
  if (!sessionKey || typeof sessionKey !== 'string') {
    return res.status(400).json({ error: 'sessionKey obrigatório' });
  }
  for (const [label, value] of Object.entries({ region, city, street, neighborhood })) {
    if (value != null && typeof value === 'string' && value.length > 120) {
      return res.status(400).json({ error: `Campo ${label} muito longo (máx. 120 caracteres)` });
    }
  }
  if (lat != null && (Math.abs(Number(lat)) > 90 || Number.isNaN(Number(lat)))) {
    return res.status(400).json({ error: 'Latitude inválida' });
  }
  if (lng != null && (Math.abs(Number(lng)) > 180 || Number.isNaN(Number(lng)))) {
    return res.status(400).json({ error: 'Longitude inválida' });
  }
  const row = setLocation(sessionKey, { region, city, street, neighborhood, lat, lng });
  res.json({ ok: true, ...row });
});

apiRouter.get('/map', (_req, res) => {
  res.json({ items: listMapPoints() });
});

apiRouter.post('/clients/port', (req, res) => {
  const { sessionKey, port } = req.body || {};
  if (!sessionKey || typeof sessionKey !== 'string') {
    return res.status(400).json({ error: 'sessionKey obrigatório' });
  }
  if (port !== null && port !== undefined && port !== '') {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 8) {
      return res.status(400).json({ error: 'Porta deve ser um número entre 1 e 8' });
    }
  }
  const row = setPort(sessionKey, port);
  res.json({ ok: true, ...row });
});

apiRouter.post('/clients/remove', (req, res) => {
  const { sessionKey } = req.body || {};
  if (!sessionKey || typeof sessionKey !== 'string') {
    return res.status(400).json({ error: 'sessionKey obrigatório' });
  }
  const result = removeSession(sessionKey);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ ok: true });
});

// --- Saúde do CCR ---

apiRouter.get('/system', async (_req, res) => {
  try {
    const [resource, health] = await Promise.all([
      mikrotik.getSystemResource(),
      mikrotik.getSystemHealth(),
    ]);
    res.json({ resource, health });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Falha ao consultar o CCR' });
  }
});

apiRouter.get('/system/history', (req, res) => {
  const hours = Number(req.query.hours || 24);
  res.json({ items: listSystemStats({ hours }) });
});

apiRouter.get('/interfaces', async (req, res) => {
  try {
    const all = await mikrotik.getInterfaces();
    const physical = all.filter((i) => !TUNNEL_IFACE_TYPE.test(i.type || ''));
    res.json(paginateArray(physical, req.query.page, req.query.pageSize));
  } catch (err) {
    res.status(502).json({ error: err.message || 'Falha ao consultar o CCR' });
  }
});

apiRouter.get('/dhcp-leases', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  try {
    let items = await mikrotik.getDhcpLeases();
    if (q) {
      items = items.filter((item) => JSON.stringify(item).toLowerCase().includes(q));
    }
    res.json(paginateArray(items, req.query.page, req.query.pageSize));
  } catch (err) {
    res.status(502).json({ error: err.message || 'Falha ao consultar o CCR' });
  }
});

apiRouter.get('/queues', async (req, res) => {
  try {
    const items = await mikrotik.getQueues();
    res.json(paginateArray(items, req.query.page, req.query.pageSize));
  } catch (err) {
    res.status(502).json({ error: err.message || 'Falha ao consultar o CCR' });
  }
});

apiRouter.get('/wireless', async (req, res) => {
  try {
    const items = await mikrotik.getWirelessRegistrations();
    res.json(paginateArray(items, req.query.page, req.query.pageSize));
  } catch (err) {
    res.status(502).json({ error: err.message || 'Falha ao consultar o CCR' });
  }
});

apiRouter.get('/logs', (req, res) => {
  const q = String(req.query.q || '').trim();
  const topic = String(req.query.topic || '').trim();
  const hours = Number(req.query.hours || 168);
  res.json(listLogEvents({ q, topic, hours, ...pageParams(req.query) }));
});

apiRouter.get('/logs/topics', (_req, res) => {
  res.json({ items: listLogTopics() });
});

// --- Banda histórica / consumo ---

apiRouter.get('/bandwidth-history', (req, res) => {
  const client = String(req.query.client || '').trim();
  const hours = Number(req.query.hours || 24);
  if (!client) return res.status(400).json({ error: 'client obrigatório' });
  res.json({ items: listBandwidthHistory({ client, hours }) });
});

apiRouter.get('/top-consumers', (req, res) => {
  const hours = Number(req.query.hours || 24);
  const limit = Number(req.query.limit || 10);
  res.json({ items: getTopConsumers({ hours, limit }) });
});

apiRouter.get('/sla', (req, res) => {
  const days = Number(req.query.days || 30);
  const q = String(req.query.q || '').trim().toLowerCase();
  let items = getSlaStats({ days });
  if (q) items = items.filter((i) => (i.name || '').toLowerCase().includes(q));
  res.json(paginateArray(items, req.query.page, req.query.pageSize));
});

apiRouter.get('/sla/by-port', (req, res) => {
  const days = Number(req.query.days || 30);
  res.json({ items: getSlaByPort({ days }) });
});

apiRouter.get('/hourly-load', (req, res) => {
  const days = Number(req.query.days || 7);
  const tzOffsetMinutes = Number(req.query.tzOffsetMinutes || 0);
  res.json({ items: getHourlyLoad({ days, tzOffsetMinutes }) });
});

apiRouter.get('/anomalies', (req, res) => {
  const hours = Number(req.query.hours || 168);
  const baseline = getBandwidthBaseline({ hours });
  const live = getAllBandwidth();
  const results = [];

  for (const [name, stats] of Object.entries(live)) {
    const base = baseline[name];
    if (!base || base.samples < 10) continue;
    const downThreshold = Math.max(base.avgDownBps + 3 * base.stdDownBps, base.avgDownBps * 3, 1_000_000);
    const upThreshold = Math.max(base.avgUpBps + 3 * base.stdUpBps, base.avgUpBps * 3, 500_000);
    const isDownAnomaly = stats.downBps > downThreshold;
    const isUpAnomaly = stats.upBps > upThreshold;
    if (!isDownAnomaly && !isUpAnomaly) continue;

    results.push({
      name,
      currentDownBps: stats.downBps,
      currentUpBps: stats.upBps,
      avgDownBps: Math.round(base.avgDownBps),
      avgUpBps: Math.round(base.avgUpBps),
      direction: isDownAnomaly && isUpAnomaly ? 'ambos' : isDownAnomaly ? 'download' : 'upload',
    });
  }

  results.sort((a, b) => b.currentDownBps + b.currentUpBps - (a.currentDownBps + a.currentUpBps));
  res.json({ items: results });
});

function parseRouterosRate(v) {
  if (!v) return null;
  const m = String(v).trim().match(/^([\d.]+)\s*([kKmMgG])?$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'k') n *= 1e3;
  else if (unit === 'm') n *= 1e6;
  else if (unit === 'g') n *= 1e9;
  return n;
}

const QUEUE_PPPOE_TARGET = /^<pppoe-(.+)>$/;

apiRouter.get('/queue-usage', async (req, res) => {
  const hours = Number(req.query.hours || 24);
  try {
    const queuesLive = await mikrotik.getQueues();
    const addressMap = getAddressNameMap();
    const baseline = getBandwidthBaseline({ hours });

    const items = queuesLive
      .filter((q) => !q.disabled)
      .map((q) => {
        const pppoeMatch = String(q.target || q.name || '').match(QUEUE_PPPOE_TARGET);
        const targetIp = String(q.target || '').split('/')[0];
        const clientName = pppoeMatch ? pppoeMatch[1] : addressMap[targetIp] || null;
        const usage = clientName ? baseline[clientName] : null;
        // Convenção RouterOS pro campo max-limit: "upload/download"
        const [uploadLimit, downloadLimit] = String(q.maxLimit || '')
          .split('/')
          .map(parseRouterosRate);
        const avgDown = usage?.avgDownBps ?? null;
        const avgUp = usage?.avgUpBps ?? null;
        return {
          name: q.name,
          target: q.target,
          client: clientName,
          uploadLimitBps: uploadLimit || null,
          downloadLimitBps: downloadLimit || null,
          avgDownBps: avgDown,
          avgUpBps: avgUp,
          downloadUsagePct: avgDown != null && downloadLimit ? Math.round((avgDown / downloadLimit) * 100) : null,
          uploadUsagePct: avgUp != null && uploadLimit ? Math.round((avgUp / uploadLimit) * 100) : null,
        };
      })
      .filter((r) => r.client);

    items.sort((a, b) => (b.downloadUsagePct ?? -1) - (a.downloadUsagePct ?? -1));
    res.json(paginateArray(items, req.query.page, req.query.pageSize));
  } catch (err) {
    res.status(502).json({ error: err.message || 'Falha ao consultar o CCR' });
  }
});

apiRouter.get('/client-detail', (req, res) => {
  const sessionKey = String(req.query.sessionKey || '').trim();
  if (!sessionKey) return res.status(400).json({ error: 'sessionKey obrigatório' });

  const session = getClientBySessionKey(sessionKey);
  if (!session) return res.status(404).json({ error: 'Cliente não encontrado' });

  const events = listEventsForSession(sessionKey, { limit: 20 });
  const bandwidth = listBandwidthHistory({ client: session.name, hours: 24 });
  const live = getAllBandwidth()[session.name] || null;
  const sla = getSlaStats({ days: 30 }).find((s) => s.sessionKey === sessionKey) || null;

  res.json({ session, events, bandwidth, live, sla });
});

// --- Exportação CSV ---

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function sendCsv(res, filename, rows, columns) {
  const header = columns.map(([, label]) => csvEscape(label)).join(',');
  const lines = rows.map((row) => columns.map(([key]) => csvEscape(row[key])).join(','));
  const csv = `﻿${[header, ...lines].join('\r\n')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

apiRouter.get('/export/disconnected.csv', (req, res) => {
  const hours = Number(req.query.hours || 24);
  const q = String(req.query.q || '').trim();
  const items = listDisconnectedForExport({ hours, q });
  sendCsv(res, 'desconexoes.csv', items, [
    ['name', 'Nome'],
    ['alias', 'Apelido'],
    ['address', 'IP'],
    ['caller_id', 'MAC'],
    ['loc_region', 'Regiao'],
    ['loc_city', 'Cidade'],
    ['disconnected_at', 'Desconectou em'],
  ]);
});

apiRouter.get('/export/events.csv', (req, res) => {
  const hours = Number(req.query.hours || 168);
  const q = String(req.query.q || '').trim();
  const type = String(req.query.type || '').trim();
  const items = listEventsForExport({ hours, q, type });
  sendCsv(res, 'eventos.csv', items, [
    ['name', 'Nome'],
    ['address', 'IP'],
    ['caller_id', 'MAC'],
    ['event_type', 'Evento'],
    ['created_at', 'Data'],
  ]);
});

// --- Relatório imprimível ---

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatBpsServer(bps) {
  const n = Number(bps || 0);
  if (n < 1000) return `${Math.round(n)} bps`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(0)} Kbps`;
  return `${(n / 1_000_000).toFixed(1)} Mbps`;
}

apiRouter.get('/report/monthly', (req, res) => {
  const days = Number(req.query.days || 30);
  const dashboard = getDashboardStats();
  const worstSla = getSlaStats({ days }).slice(0, 15);
  const topConsumers = getTopConsumers({ hours: days * 24, limit: 10 });
  const slaByPort = getSlaByPort({ days });
  const generated = new Date().toLocaleString('pt-BR');

  const rows = (arr, render) => (arr.length ? arr.map(render).join('') : '<tr><td colspan="3">Sem dados no período.</td></tr>');

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Relatório de operação — Monitor MikroTik</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; color: #111; padding: 2rem; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 1.4rem; margin-bottom: 0; }
  .sub { color: #555; margin-top: 0.2rem; margin-bottom: 1.5rem; font-size: 0.85rem; }
  h2 { font-size: 1.05rem; margin-top: 2rem; border-bottom: 2px solid #333; padding-bottom: 0.3rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.6rem; font-size: 0.85rem; }
  th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid #ddd; }
  th { background: #f2f2f2; }
  .metrics { display: flex; gap: 1.5rem; margin-top: 0.5rem; }
  .metric { border: 1px solid #ddd; border-radius: 8px; padding: 0.6rem 1rem; }
  .metric strong { display: block; font-size: 1.3rem; }
  .metric span { font-size: 0.7rem; text-transform: uppercase; color: #777; }
  .print-hint { margin-top: 2rem; font-size: 0.8rem; color: #555; }
  @media print { .print-hint { display: none; } body { padding: 0; } }
</style>
</head>
<body>
  <h1>Relatório de operação — Monitor MikroTik</h1>
  <p class="sub">Período: últimos ${days} dias · gerado em ${generated}</p>

  <div class="metrics">
    <div class="metric"><span>Online agora</span><strong>${dashboard.online}</strong></div>
    <div class="metric"><span>Desconexões 24h</span><strong>${dashboard.disconnected24h}</strong></div>
    <div class="metric"><span>Reconexões 24h</span><strong>${dashboard.connected24h}</strong></div>
  </div>

  <h2>Piores uptime no período</h2>
  <table>
    <thead><tr><th>Cliente</th><th>Uptime</th><th>Tempo offline</th></tr></thead>
    <tbody>${rows(worstSla, (s) => `<tr><td>${escapeHtml(s.name)}</td><td>${s.uptimePct}%</td><td>${s.downtimeMinutes} min</td></tr>`)}</tbody>
  </table>

  <h2>Uptime médio por porta/OLT</h2>
  <table>
    <thead><tr><th>Porta</th><th>Clientes</th><th>Uptime médio</th></tr></thead>
    <tbody>${rows(slaByPort, (p) => `<tr><td>${escapeHtml(String(p.port))}</td><td>${p.clients}</td><td>${p.avgUptimePct}%</td></tr>`)}</tbody>
  </table>

  <h2>Top consumo de banda (média)</h2>
  <table>
    <thead><tr><th>Cliente</th><th>Download médio</th><th>Upload médio</th></tr></thead>
    <tbody>${rows(topConsumers, (c) => `<tr><td>${escapeHtml(c.name)}</td><td>${formatBpsServer(c.avgDownBps)}</td><td>${formatBpsServer(c.avgUpBps)}</td></tr>`)}</tbody>
  </table>

  <p class="print-hint">Use Ctrl+P (ou Cmd+P) e escolha "Salvar como PDF" pra exportar este relatório.</p>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// --- Notificações push (app mobile) ---

apiRouter.post('/push/register', (req, res) => {
  const { token, platform } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token obrigatório' });
  }
  registerPushToken(token, platform);
  res.json({ ok: true });
});

apiRouter.post('/push/unregister', (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token obrigatório' });
  }
  unregisterPushToken(token);
  res.json({ ok: true });
});

apiRouter.get('/events', (req, res) => {
  const q = String(req.query.q || '').trim();
  const type = String(req.query.type || '').trim();
  const hours = Number(req.query.hours || 168);
  res.json(listEvents({ q, type, hours, ...pageParams(req.query) }));
});
