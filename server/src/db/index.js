import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';

let db;

export function getDb() {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      address TEXT,
      caller_id TEXT,
      service TEXT,
      uptime TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      disconnected_at TEXT,
      is_online INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_online ON sessions(is_online);
    CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name);
    CREATE INDEX IF NOT EXISTS idx_sessions_disconnected ON sessions(disconnected_at);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      caller_id TEXT,
      event_type TEXT NOT NULL CHECK(event_type IN ('connected', 'disconnected')),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);

    CREATE TABLE IF NOT EXISTS poll_status (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      connected INTEGER NOT NULL DEFAULT 0,
      last_poll_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      online_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO poll_status (id, connected, online_count, updated_at)
    VALUES (1, 0, 0, datetime('now'));

    CREATE TABLE IF NOT EXISTS system_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      cpu_load REAL,
      free_memory INTEGER,
      total_memory INTEGER,
      voltage REAL,
      temperature REAL,
      uptime TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_system_stats_created ON system_stats(created_at DESC);

    CREATE TABLE IF NOT EXISTS bandwidth_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      client_name TEXT NOT NULL,
      down_bps INTEGER,
      up_bps INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_bw_samples_client_time ON bandwidth_samples(client_name, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bw_samples_time ON bandwidth_samples(created_at DESC);

    CREATE TABLE IF NOT EXISTS log_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ccr_time TEXT,
      topics TEXT,
      message TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      UNIQUE(ccr_time, message)
    );
    CREATE INDEX IF NOT EXISTS idx_log_events_fetched ON log_events(fetched_at DESC);

    CREATE TABLE IF NOT EXISTS push_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      platform TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
  `);

  const hasProfile = db
    .prepare(`SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'profile'`)
    .get();
  if (!hasProfile) {
    db.exec(`ALTER TABLE sessions ADD COLUMN profile TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profile)`);

  const hasAlias = db
    .prepare(`SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'alias'`)
    .get();
  if (!hasAlias) {
    db.exec(`ALTER TABLE sessions ADD COLUMN alias TEXT`);
  }

  const locColumns = ['loc_region', 'loc_city', 'loc_street', 'loc_neighborhood'];
  for (const col of locColumns) {
    const has = db
      .prepare(`SELECT 1 FROM pragma_table_info('sessions') WHERE name = ?`)
      .get(col);
    if (!has) {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${col} TEXT`);
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_loc_region ON sessions(loc_region)`);

  const hasPort = db
    .prepare(`SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'ont_port'`)
    .get();
  if (!hasPort) {
    db.exec(`ALTER TABLE sessions ADD COLUMN ont_port INTEGER`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_ont_port ON sessions(ont_port)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_session_time ON events(session_key, created_at)`);

  const geoColumns = ['lat', 'lng'];
  for (const col of geoColumns) {
    const has = db
      .prepare(`SELECT 1 FROM pragma_table_info('sessions') WHERE name = ?`)
      .get(col);
    if (!has) {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${col} REAL`);
    }
  }

  return db;
}

export function removeSession(sessionKey) {
  const database = getDb();
  const row = database
    .prepare(`SELECT is_online FROM sessions WHERE session_key = ?`)
    .get(sessionKey);
  if (!row) return { ok: false, error: 'Cliente não encontrado' };
  if (row.is_online === 1) {
    return { ok: false, error: 'Cliente está online — não dá pra remover agora' };
  }
  database.prepare(`DELETE FROM sessions WHERE session_key = ?`).run(sessionKey);
  return { ok: true };
}

export function setAlias(sessionKey, alias) {
  const database = getDb();
  const clean = (alias || '').trim();
  database
    .prepare(`UPDATE sessions SET alias = ? WHERE session_key = ?`)
    .run(clean || null, sessionKey);
  return database.prepare(`SELECT session_key, alias FROM sessions WHERE session_key = ?`).get(sessionKey);
}

export function setLocation(sessionKey, { region, city, street, neighborhood, lat, lng } = {}) {
  const database = getDb();
  const clean = (v) => {
    const s = (v || '').trim();
    return s || null;
  };
  const cleanCoord = (v) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const latClean = cleanCoord(lat);
  const lngClean = cleanCoord(lng);
  const setCoords = latClean !== undefined && lngClean !== undefined;

  database
    .prepare(
      `UPDATE sessions
       SET loc_region = ?, loc_city = ?, loc_street = ?, loc_neighborhood = ?
           ${setCoords ? ', lat = ?, lng = ?' : ''}
       WHERE session_key = ?`
    )
    .run(
      ...[
        clean(region),
        clean(city),
        clean(street),
        clean(neighborhood),
        ...(setCoords ? [latClean, lngClean] : []),
        sessionKey,
      ]
    );
  return database
    .prepare(
      `SELECT session_key, loc_region, loc_city, loc_street, loc_neighborhood, lat, lng
       FROM sessions WHERE session_key = ?`
    )
    .get(sessionKey);
}

export function listMapPoints() {
  const database = getDb();
  return database
    .prepare(
      `SELECT session_key, name, alias, is_online, ont_port, loc_region, loc_neighborhood, loc_city, lat, lng
       FROM sessions
       WHERE lat IS NOT NULL AND lng IS NOT NULL`
    )
    .all();
}

export function setPort(sessionKey, port) {
  const database = getDb();
  const n = Number(port);
  const clean = Number.isInteger(n) && n >= 1 && n <= 8 ? n : null;
  database
    .prepare(`UPDATE sessions SET ont_port = ? WHERE session_key = ?`)
    .run(clean, sessionKey);
  return database
    .prepare(`SELECT session_key, ont_port FROM sessions WHERE session_key = ?`)
    .get(sessionKey);
}

export function sessionKey({ name, callerId, address }) {
  const mac = (callerId || '').trim().toLowerCase();
  const ip = (address || '').trim();
  return `${(name || '').trim().toLowerCase()}|${mac || ip || 'unknown'}`;
}

export function upsertOnlineSessions(clients) {
  const database = getDb();
  const now = new Date().toISOString();

  const selectOnline = database.prepare(
    `SELECT session_key, name, address, caller_id FROM sessions WHERE is_online = 1`
  );
  const findByKey = database.prepare(`SELECT * FROM sessions WHERE session_key = ?`);
  const insertSession = database.prepare(`
    INSERT INTO sessions (
      session_key, name, address, caller_id, service, uptime, profile,
      first_seen_at, last_seen_at, disconnected_at, is_online
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)
  `);
  const updateOnline = database.prepare(`
    UPDATE sessions
    SET name = ?, address = ?, caller_id = ?, service = ?, uptime = ?, profile = ?,
        last_seen_at = ?, disconnected_at = NULL, is_online = 1
    WHERE session_key = ?
  `);
  const markOffline = database.prepare(`
    UPDATE sessions
    SET is_online = 0, disconnected_at = ?, uptime = COALESCE(uptime, uptime)
    WHERE session_key = ?
  `);
  const insertEvent = database.prepare(`
    INSERT INTO events (session_key, name, address, caller_id, event_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const apply = database.transaction((list) => {
    const previous = selectOnline.all();
    const previousKeys = new Set(previous.map((row) => row.session_key));
    const currentKeys = new Set();
    const currentByKey = new Map();

    for (const client of list) {
      currentByKey.set(sessionKey(client), client);
      const key = sessionKey(client);
      currentKeys.add(key);

      const existing = findByKey.get(key);
      if (!existing) {
        insertSession.run(
          key,
          client.name,
          client.address || null,
          client.callerId || null,
          client.service || null,
          client.uptime || null,
          client.profile || null,
          now,
          now
        );
        insertEvent.run(
          key,
          client.name,
          client.address || null,
          client.callerId || null,
          'connected',
          now
        );
      } else if (existing.is_online === 0) {
        updateOnline.run(
          client.name,
          client.address || null,
          client.callerId || null,
          client.service || null,
          client.uptime || null,
          client.profile || null,
          now,
          key
        );
        insertEvent.run(
          key,
          client.name,
          client.address || null,
          client.callerId || null,
          'connected',
          now
        );
      } else {
        updateOnline.run(
          client.name,
          client.address || null,
          client.callerId || null,
          client.service || null,
          client.uptime || null,
          client.profile || null,
          now,
          key
        );
      }
    }

    for (const row of previous) {
      if (!currentKeys.has(row.session_key)) {
        markOffline.run(now, row.session_key);
        insertEvent.run(
          row.session_key,
          row.name,
          row.address || null,
          row.caller_id || null,
          'disconnected',
          now
        );
      }
    }

    const newlyConnectedKeys = [...currentKeys].filter((key) => !previousKeys.has(key));
    const newlyDisconnected = previous.filter((row) => !currentKeys.has(row.session_key));

    return {
      onlineCount: currentKeys.size,
      connected: newlyConnectedKeys.length,
      disconnected: newlyDisconnected.length,
      newlyConnected: newlyConnectedKeys.map((key) => {
        const c = currentByKey.get(key);
        return { name: c?.name || null, address: c?.address || null };
      }),
      newlyDisconnected: newlyDisconnected.map((row) => ({
        name: row.name,
        address: row.address || null,
      })),
    };
  });

  return apply(clients);
}

export function updatePollStatus({ connected, onlineCount, error }) {
  const database = getDb();
  const now = new Date().toISOString();
  database
    .prepare(
      `
      UPDATE poll_status
      SET connected = ?,
          last_poll_at = ?,
          last_success_at = CASE WHEN ? = 1 THEN ? ELSE last_success_at END,
          last_error = ?,
          online_count = ?,
          updated_at = ?
      WHERE id = 1
    `
    )
    .run(
      connected ? 1 : 0,
      now,
      connected ? 1 : 0,
      now,
      error || null,
      onlineCount ?? 0,
      now
    );
}

export function getPollStatus() {
  return getDb().prepare(`SELECT * FROM poll_status WHERE id = 1`).get();
}

function hoursAgoIso(hours) {
  return new Date(Date.now() - Number(hours) * 60 * 60 * 1000).toISOString();
}

function normalizePage(page, pageSize, total) {
  const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const pages = Math.max(1, Math.ceil(Number(total) / size) || 1);
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  return {
    page: current,
    pageSize: size,
    total: Number(total) || 0,
    pages,
    offset: (current - 1) * size,
  };
}

function searchClause(q, params) {
  if (!q) return '';
  const like = `%${q}%`;
  params.push(like, like, like, like);
  return ` AND (
    name LIKE ? OR
    IFNULL(alias, '') LIKE ? OR
    IFNULL(address, '') LIKE ? OR
    IFNULL(caller_id, '') LIKE ?
  )`;
}

export function listOnline({ page = 1, pageSize = 20, q = '' } = {}) {
  const database = getDb();
  const params = [];
  const where = `WHERE is_online = 1${searchClause(q, params)}`;
  const total = database
    .prepare(`SELECT COUNT(*) AS c FROM sessions ${where}`)
    .get(...params).c;
  const meta = normalizePage(page, pageSize, total);
  const items = database
    .prepare(
      `
      SELECT session_key, name, alias, address, caller_id, service, uptime, profile, ont_port, loc_region, loc_city, loc_street, loc_neighborhood,
             first_seen_at, last_seen_at
      FROM sessions
      ${where}
      ORDER BY name COLLATE NOCASE
      LIMIT ? OFFSET ?
    `
    )
    .all(...params, meta.pageSize, meta.offset);

  return { items, ...meta };
}

export function listDisconnected({
  hours = 24,
  page = 1,
  pageSize = 20,
  q = '',
} = {}) {
  const database = getDb();
  const since = hoursAgoIso(hours);
  const params = [since];
  const where = `WHERE is_online = 0
        AND disconnected_at IS NOT NULL
        AND disconnected_at >= ?${searchClause(q, params)}`;
  const total = database
    .prepare(`SELECT COUNT(*) AS c FROM sessions ${where}`)
    .get(...params).c;
  const meta = normalizePage(page, pageSize, total);
  const items = database
    .prepare(
      `
      SELECT session_key, name, alias, address, caller_id, service, uptime, profile,
             ont_port, loc_region, loc_city, loc_street, loc_neighborhood,
             first_seen_at, last_seen_at, disconnected_at, is_online
      FROM sessions
      ${where}
      ORDER BY disconnected_at DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(...params, meta.pageSize, meta.offset);

  return { items, ...meta };
}

export function listEvents({
  q = '',
  type = '',
  page = 1,
  pageSize = 20,
  hours = 168,
} = {}) {
  const database = getDb();
  const params = [hoursAgoIso(hours)];
  let where = `WHERE created_at >= ?`;

  if (type === 'connected' || type === 'disconnected') {
    where += ` AND event_type = ?`;
    params.push(type);
  }

  if (q) {
    where += ` AND (
      name LIKE ? OR
      IFNULL(address, '') LIKE ? OR
      IFNULL(caller_id, '') LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const total = database
    .prepare(`SELECT COUNT(*) AS c FROM events ${where}`)
    .get(...params).c;
  const meta = normalizePage(page, pageSize, total);
  const items = database
    .prepare(
      `
      SELECT id, session_key, name, address, caller_id, event_type, created_at
      FROM events
      ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(...params, meta.pageSize, meta.offset);

  return { items, ...meta };
}

export function listAll({
  page = 1,
  pageSize = 20,
  q = '',
  port = '',
} = {}) {
  const database = getDb();
  const params = [];
  let where = `WHERE 1 = 1`;

  if (q) {
    where += ` AND (
      name LIKE ? OR
      IFNULL(alias, '') LIKE ? OR
      IFNULL(address, '') LIKE ? OR
      IFNULL(caller_id, '') LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  if (port) {
    where += ` AND ont_port = ?`;
    params.push(Number(port));
  }

  const total = database
    .prepare(`SELECT COUNT(*) AS c FROM sessions ${where}`)
    .get(...params).c;
  const meta = normalizePage(page, pageSize, total);
  const items = database
    .prepare(
      `
      SELECT session_key, name, alias, address, caller_id, service, uptime, profile, ont_port, loc_region, loc_city, loc_street, loc_neighborhood,
             first_seen_at, last_seen_at, disconnected_at, is_online
      FROM sessions
      ${where}
      ORDER BY is_online DESC, name COLLATE NOCASE
      LIMIT ? OFFSET ?
    `
    )
    .all(...params, meta.pageSize, meta.offset);

  return { items, ...meta };
}

function daysAgoIso(days) {
  return new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Agrupa quedas recentes por porta e por região — pra detectar queda em massa
 * (ex: OLT/porta caiu e derrubou vários clientes juntos) e disparar push.
 */
export function getRecentDisconnectGroups({ minutes = 5, threshold = 3 } = {}) {
  const database = getDb();
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  const byPort = database
    .prepare(
      `SELECT ont_port AS port, COUNT(*) AS c, GROUP_CONCAT(COALESCE(alias, name), '||') AS names
       FROM sessions
       WHERE is_online = 0 AND disconnected_at >= ? AND ont_port IS NOT NULL
       GROUP BY ont_port HAVING COUNT(*) >= ?`
    )
    .all(since, threshold);

  const byRegion = database
    .prepare(
      `SELECT loc_region AS region, COUNT(*) AS c, GROUP_CONCAT(COALESCE(alias, name), '||') AS names
       FROM sessions
       WHERE is_online = 0 AND disconnected_at >= ? AND loc_region IS NOT NULL AND loc_region != ''
       GROUP BY loc_region HAVING COUNT(*) >= ?`
    )
    .all(since, threshold);

  return {
    byPort: byPort.map((r) => ({ port: r.port, count: r.c, names: r.names.split('||') })),
    byRegion: byRegion.map((r) => ({ region: r.region, count: r.c, names: r.names.split('||') })),
  };
}

export function registerPushToken(token, platform) {
  const database = getDb();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO push_tokens (token, platform, created_at, last_seen_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET last_seen_at = excluded.last_seen_at, platform = excluded.platform`
    )
    .run(token, platform || null, now, now);
}

export function unregisterPushToken(token) {
  const database = getDb();
  database.prepare(`DELETE FROM push_tokens WHERE token = ?`).run(token);
}

export function listPushTokens() {
  const database = getDb();
  return database.prepare(`SELECT token FROM push_tokens`).all().map((r) => r.token);
}

export function removePushTokens(tokens) {
  if (!tokens.length) return;
  const database = getDb();
  const del = database.prepare(`DELETE FROM push_tokens WHERE token = ?`);
  const tx = database.transaction((list) => {
    for (const t of list) del.run(t);
  });
  tx(tokens);
}

export function getClientBySessionKey(sessionKey) {
  const database = getDb();
  return database.prepare(`SELECT * FROM sessions WHERE session_key = ?`).get(sessionKey);
}

export function listEventsForSession(sessionKey, { limit = 20 } = {}) {
  const database = getDb();
  return database
    .prepare(
      `SELECT id, event_type, created_at FROM events WHERE session_key = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(sessionKey, limit);
}

export function insertSystemStat(stat) {
  const database = getDb();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO system_stats (created_at, cpu_load, free_memory, total_memory, voltage, temperature, uptime)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      now,
      stat.cpuLoad ?? null,
      stat.freeMemory ?? null,
      stat.totalMemory ?? null,
      stat.voltage ?? null,
      stat.temperature ?? null,
      stat.uptime ?? null
    );
}

export function listSystemStats({ hours = 24 } = {}) {
  const database = getDb();
  const since = hoursAgoIso(hours);
  return database
    .prepare(
      `SELECT created_at, cpu_load, free_memory, total_memory, voltage, temperature, uptime
       FROM system_stats WHERE created_at >= ? ORDER BY created_at ASC`
    )
    .all(since);
}

export function insertBandwidthSnapshot(bwMap) {
  const database = getDb();
  const now = new Date().toISOString();
  const insert = database.prepare(
    `INSERT INTO bandwidth_samples (created_at, client_name, down_bps, up_bps) VALUES (?, ?, ?, ?)`
  );
  const tx = database.transaction((entries) => {
    for (const [client, stats] of entries) {
      insert.run(now, client, stats.downBps || 0, stats.upBps || 0);
    }
  });
  tx(Object.entries(bwMap || {}));
}

export function listBandwidthHistory({ client, hours = 24 } = {}) {
  const database = getDb();
  const since = hoursAgoIso(hours);
  return database
    .prepare(
      `SELECT created_at, down_bps, up_bps FROM bandwidth_samples
       WHERE client_name = ? AND created_at >= ?
       ORDER BY created_at ASC`
    )
    .all(client, since);
}

export function getTopConsumers({ hours = 24, limit = 10 } = {}) {
  const database = getDb();
  const since = hoursAgoIso(hours);
  return database
    .prepare(
      `SELECT client_name AS name,
              AVG(down_bps) AS avgDownBps,
              AVG(up_bps) AS avgUpBps,
              MAX(down_bps) AS peakDownBps,
              MAX(up_bps) AS peakUpBps
       FROM bandwidth_samples
       WHERE created_at >= ?
       GROUP BY client_name
       ORDER BY (AVG(down_bps) + AVG(up_bps)) DESC
       LIMIT ?`
    )
    .all(since, limit);
}

/**
 * Média/desvio-padrão de banda por cliente num período — baseline pra detectar
 * anomalia (comparando com a leitura ao vivo) ou pra cruzar com o limite da fila.
 */
export function getBandwidthBaseline({ hours = 168 } = {}) {
  const database = getDb();
  const since = hoursAgoIso(hours);
  const rows = database
    .prepare(
      `SELECT client_name AS name,
              AVG(down_bps) AS avgDownBps,
              AVG(up_bps) AS avgUpBps,
              COUNT(*) AS samples
       FROM bandwidth_samples
       WHERE created_at >= ?
       GROUP BY client_name
       HAVING COUNT(*) >= 5`
    )
    .all(since);

  const stdPrep = database.prepare(
    `SELECT down_bps, up_bps FROM bandwidth_samples WHERE client_name = ? AND created_at >= ?`
  );
  const out = {};
  for (const r of rows) {
    const samples = stdPrep.all(r.name, since);
    const downMean = r.avgDownBps || 0;
    const upMean = r.avgUpBps || 0;
    const downVar = samples.reduce((acc, s) => acc + (s.down_bps - downMean) ** 2, 0) / samples.length;
    const upVar = samples.reduce((acc, s) => acc + (s.up_bps - upMean) ** 2, 0) / samples.length;
    out[r.name] = {
      avgDownBps: downMean,
      avgUpBps: upMean,
      stdDownBps: Math.sqrt(downVar),
      stdUpBps: Math.sqrt(upVar),
      samples: r.samples,
    };
  }
  return out;
}

/**
 * Carga média por hora do dia (0-23), somando todos os clientes — pra achar horário de pico.
 */
export function getHourlyLoad({ days = 7, tzOffsetMinutes = 0 } = {}) {
  const database = getDb();
  const since = daysAgoIso(days);
  const rows = database
    .prepare(
      `SELECT strftime('%H', created_at) AS hour,
              AVG(down_bps) AS avgDownBps,
              AVG(up_bps) AS avgUpBps,
              COUNT(*) AS samples
       FROM bandwidth_samples
       WHERE created_at >= ?
       GROUP BY hour
       ORDER BY hour ASC`
    )
    .all(since);

  // tzOffsetMinutes é o valor de Date.prototype.getTimezoneOffset() do navegador
  // (minutos a somar ao horário local pra chegar em UTC — positivo a oeste de UTC).
  const shift = -Math.round(Number(tzOffsetMinutes) || 0) / 60;
  const byHour = new Map(rows.map((r) => [Number(r.hour), r]));
  const buckets = Array.from({ length: 24 }, (_, hour) => {
    const r = byHour.get(hour);
    return {
      hour,
      avgDownBps: r ? Math.round(r.avgDownBps || 0) : 0,
      avgUpBps: r ? Math.round(r.avgUpBps || 0) : 0,
      samples: r ? r.samples : 0,
    };
  });

  return buckets.map((b, utcHour) => ({
    ...b,
    hour: ((utcHour + shift) % 24 + 24) % 24,
  })).sort((a, b) => a.hour - b.hour);
}

export function getAddressNameMap() {
  const database = getDb();
  const rows = database
    .prepare(`SELECT address, name, alias FROM sessions WHERE address IS NOT NULL AND address != ''`)
    .all();
  const map = {};
  for (const r of rows) map[r.address] = r.alias || r.name;
  return map;
}

export function insertLogEvents(logs) {
  const database = getDb();
  const now = new Date().toISOString();
  const insert = database.prepare(
    `INSERT OR IGNORE INTO log_events (ccr_time, topics, message, fetched_at) VALUES (?, ?, ?, ?)`
  );
  const tx = database.transaction((items) => {
    for (const log of items) {
      if (!log.message) continue;
      insert.run(log.time || null, log.topics || null, log.message, now);
    }
  });
  tx(logs || []);
}

export function listLogEvents({ q = '', topic = '', hours = 168, page = 1, pageSize = 20 } = {}) {
  const database = getDb();
  const since = hoursAgoIso(hours);
  const params = [since];
  let where = `WHERE fetched_at >= ?`;

  if (topic) {
    where += ` AND IFNULL(topics, '') LIKE ?`;
    params.push(`%${topic}%`);
  }
  if (q) {
    where += ` AND (message LIKE ? OR IFNULL(topics, '') LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like);
  }

  const total = database.prepare(`SELECT COUNT(*) AS c FROM log_events ${where}`).get(...params).c;
  const meta = normalizePage(page, pageSize, total);
  const items = database
    .prepare(
      `SELECT id, ccr_time, topics, message, fetched_at FROM log_events ${where}
       ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, meta.pageSize, meta.offset);

  return { items, ...meta };
}

export function listLogTopics() {
  const database = getDb();
  const rows = database
    .prepare(`SELECT DISTINCT topics FROM log_events WHERE topics IS NOT NULL AND topics != '' LIMIT 2000`)
    .all();
  const set = new Set();
  for (const r of rows) {
    String(r.topics)
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((t) => set.add(t));
  }
  return [...set].sort();
}

function computeSlaRows(days) {
  const database = getDb();
  const sinceIso = daysAgoIso(days);
  const sinceMs = Date.parse(sinceIso);
  const nowMs = Date.now();
  const periodMs = nowMs - sinceMs;

  const sessions = database.prepare(`SELECT session_key, name, alias, ont_port FROM sessions`).all();
  const lastBeforePrep = database.prepare(
    `SELECT event_type FROM events WHERE session_key = ? AND created_at < ? ORDER BY created_at DESC LIMIT 1`
  );
  const eventsPrep = database.prepare(
    `SELECT event_type, created_at FROM events WHERE session_key = ? AND created_at >= ? ORDER BY created_at ASC`
  );

  const results = [];
  for (const s of sessions) {
    const before = lastBeforePrep.get(s.session_key, sinceIso);
    let state = before ? before.event_type : 'connected';
    let cursor = sinceMs;
    let downtimeMs = 0;

    const events = eventsPrep.all(s.session_key, sinceIso);
    for (const ev of events) {
      const t = Date.parse(ev.created_at);
      if (state === 'disconnected') downtimeMs += t - cursor;
      cursor = t;
      state = ev.event_type;
    }
    if (state === 'disconnected') downtimeMs += nowMs - cursor;

    const uptimePct = periodMs > 0 ? Math.max(0, Math.min(100, 100 - (downtimeMs / periodMs) * 100)) : 100;
    results.push({
      sessionKey: s.session_key,
      name: s.alias || s.name,
      port: s.ont_port ?? null,
      uptimePct: Number(uptimePct.toFixed(2)),
      downtimeMinutes: Math.round(downtimeMs / 60000),
    });
  }

  return results;
}

export function getSlaStats({ days = 30 } = {}) {
  return computeSlaRows(days).sort((a, b) => a.uptimePct - b.uptimePct);
}

export function getSlaByPort({ days = 30 } = {}) {
  const rows = computeSlaRows(days);
  const groups = new Map();
  for (const r of rows) {
    const key = r.port ?? 'sem-porta';
    if (!groups.has(key)) groups.set(key, { port: key, clients: 0, sumUptime: 0, sumDowntime: 0 });
    const g = groups.get(key);
    g.clients += 1;
    g.sumUptime += r.uptimePct;
    g.sumDowntime += r.downtimeMinutes;
  }
  return [...groups.values()]
    .map((g) => ({
      port: g.port,
      clients: g.clients,
      avgUptimePct: Number((g.sumUptime / g.clients).toFixed(2)),
      avgDowntimeMinutes: Math.round(g.sumDowntime / g.clients),
    }))
    .sort((a, b) => a.avgUptimePct - b.avgUptimePct);
}

export function listDisconnectedForExport({ hours = 24, q = '' } = {}) {
  const database = getDb();
  const since = hoursAgoIso(hours);
  const params = [since];
  const where = `WHERE is_online = 0 AND disconnected_at IS NOT NULL AND disconnected_at >= ?${searchClause(q, params)}`;
  return database
    .prepare(
      `SELECT name, alias, address, caller_id, loc_region, loc_city, loc_street, loc_neighborhood, disconnected_at
       FROM sessions ${where} ORDER BY disconnected_at DESC LIMIT 5000`
    )
    .all(...params);
}

export function listEventsForExport({ hours = 168, q = '', type = '' } = {}) {
  const database = getDb();
  const params = [hoursAgoIso(hours)];
  let where = `WHERE created_at >= ?`;

  if (type === 'connected' || type === 'disconnected') {
    where += ` AND event_type = ?`;
    params.push(type);
  }
  if (q) {
    where += ` AND (name LIKE ? OR IFNULL(address, '') LIKE ? OR IFNULL(caller_id, '') LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  return database
    .prepare(
      `SELECT name, address, caller_id, event_type, created_at FROM events ${where}
       ORDER BY created_at DESC LIMIT 5000`
    )
    .all(...params);
}

export function pruneOldData(days = 30) {
  const database = getDb();
  const cutoff = daysAgoIso(days);
  database.prepare(`DELETE FROM system_stats WHERE created_at < ?`).run(cutoff);
  database.prepare(`DELETE FROM bandwidth_samples WHERE created_at < ?`).run(cutoff);
  database.prepare(`DELETE FROM log_events WHERE fetched_at < ?`).run(cutoff);
}

export function getDashboardStats() {
  const database = getDb();
  const since = hoursAgoIso(24);
  const online = database
    .prepare(`SELECT COUNT(*) AS c FROM sessions WHERE is_online = 1`)
    .get().c;
  const disconnected24h = database
    .prepare(
      `
      SELECT COUNT(*) AS c FROM events
      WHERE event_type = 'disconnected'
        AND created_at >= ?
    `
    )
    .get(since).c;
  const connected24h = database
    .prepare(
      `
      SELECT COUNT(*) AS c FROM events
      WHERE event_type = 'connected'
        AND created_at >= ?
    `
    )
    .get(since).c;
  const status = getPollStatus();

  return {
    online,
    disconnected24h,
    connected24h,
    status,
  };
}
