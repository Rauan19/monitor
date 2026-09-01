import net from 'node:net';
import { config } from '../config.js';

/**
 * Codifica uma "word" no protocolo binário da API RouterOS.
 * @param {string} str
 */
function encodeWord(str) {
  const data = Buffer.from(str, 'utf8');
  const len = data.length;
  let prefix;

  if (len < 0x80) {
    prefix = Buffer.from([len]);
  } else if (len < 0x4000) {
    prefix = Buffer.from([(len >> 8) | 0x80, len & 0xff]);
  } else if (len < 0x200000) {
    prefix = Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
  } else if (len < 0x10000000) {
    prefix = Buffer.from([
      (len >> 24) | 0xe0,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
    ]);
  } else {
    prefix = Buffer.from([
      0xf0,
      (len >> 24) & 0xff,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
    ]);
  }

  return Buffer.concat([prefix, data]);
}

function encodeSentence(words) {
  return Buffer.concat([...words.map(encodeWord), Buffer.from([0])]);
}

/**
 * Cliente RouterOS API — somente leitura (print).
 */
export class MikroTikClient {
  constructor() {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.connected = false;
    this.connecting = null;
    this.pending = [];
    this.tagSeq = 1;
  }

  async connect() {
    if (this.connected && this.socket) return;
    if (this.connecting) return this.connecting;

    this.connecting = this._connectOnce();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  _connectOnce() {
    return new Promise((resolve, reject) => {
      this._cleanupSocket();

      const socket = net.createConnection({
        host: config.mikrotik.host,
        port: config.mikrotik.port,
      });

      const timeoutMs = config.mikrotik.timeout;
      const onTimeout = () => {
        socket.destroy();
        reject(new Error(`Timeout ao conectar em ${config.mikrotik.host}:${config.mikrotik.port}`));
      };
      socket.setTimeout(timeoutMs, onTimeout);

      socket.once('connect', async () => {
        socket.setTimeout(0);
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        this.connected = true;

        socket.on('data', (chunk) => this._onData(chunk));
        socket.on('error', (err) => this._failAll(err));
        socket.on('close', () => {
          this.connected = false;
          this._failAll(new Error('Conexão com MikroTik fechada'));
          this.socket = null;
        });

        try {
          await this._login();
          resolve();
        } catch (err) {
          this._cleanupSocket();
          reject(err);
        }
      });

      socket.once('error', (err) => {
        this.connected = false;
        reject(new Error(`Falha ao conectar: ${err.message}`));
      });
    });
  }

  async _login() {
    // Login moderno (RouterOS 6.43+)
    const reply = await this._write([
      '/login',
      `=name=${config.mikrotik.user}`,
      `=password=${config.mikrotik.password}`,
    ]);

    const done = reply.find((s) => s[0] === '!done');
    const trap = reply.find((s) => s[0] === '!trap');
    if (trap) {
      const msg = trap.find((w) => w.startsWith('=message='))?.slice(9) || 'login negado';
      throw new Error(`Login MikroTik: ${msg}`);
    }
    if (!done) throw new Error('Login MikroTik: resposta inesperada');
  }

  async disconnect() {
    this._cleanupSocket();
  }

  _cleanupSocket() {
    this.connected = false;
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.destroy();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.buffer = Buffer.alloc(0);
    this._failAll(new Error('Cliente MikroTik desconectado'));
  }

  _failAll(err) {
    const pending = this.pending.splice(0);
    for (const item of pending) item.reject(err);
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const parsed = this._readSentence();
      if (!parsed) break;
      this._dispatchSentence(parsed);
    }
  }

  _readSentence() {
    const words = [];
    let offset = 0;

    while (offset < this.buffer.length) {
      if (this.buffer[offset] === 0) {
        this.buffer = this.buffer.subarray(offset + 1);
        return words;
      }

      const lenInfo = this._readLength(offset);
      if (!lenInfo) return null;

      const { length, size } = lenInfo;
      const start = offset + size;
      const end = start + length;
      if (end > this.buffer.length) return null;

      words.push(this.buffer.subarray(start, end).toString('utf8'));
      offset = end;
    }

    return null;
  }

  _readLength(offset) {
    if (offset >= this.buffer.length) return null;
    const b0 = this.buffer[offset];

    if (b0 & 0x80) {
      if ((b0 & 0xc0) === 0x80) {
        if (offset + 1 >= this.buffer.length) return null;
        return {
          length: ((b0 & 0x3f) << 8) + this.buffer[offset + 1],
          size: 2,
        };
      }
      if ((b0 & 0xe0) === 0xc0) {
        if (offset + 2 >= this.buffer.length) return null;
        return {
          length: ((b0 & 0x1f) << 16) + (this.buffer[offset + 1] << 8) + this.buffer[offset + 2],
          size: 3,
        };
      }
      if ((b0 & 0xf0) === 0xe0) {
        if (offset + 3 >= this.buffer.length) return null;
        return {
          length:
            ((b0 & 0x0f) << 24) +
            (this.buffer[offset + 1] << 16) +
            (this.buffer[offset + 2] << 8) +
            this.buffer[offset + 3],
          size: 4,
        };
      }
      if ((b0 & 0xf8) === 0xf0) {
        if (offset + 4 >= this.buffer.length) return null;
        return {
          length:
            (this.buffer[offset + 1] << 24) +
            (this.buffer[offset + 2] << 16) +
            (this.buffer[offset + 3] << 8) +
            this.buffer[offset + 4],
          size: 5,
        };
      }
    }

    return { length: b0, size: 1 };
  }

  _dispatchSentence(words) {
    if (!words.length) return;
    const tagWord = words.find((w) => w.startsWith('.tag='));
    const tag = tagWord ? tagWord.slice(5) : null;

    const waiter = tag
      ? this.pending.find((p) => p.tag === tag)
      : this.pending[0];

    if (!waiter) return;

    waiter.sentences.push(words);

    if (words[0] === '!done' || words[0] === '!trap' || words[0] === '!fatal') {
      this.pending = this.pending.filter((p) => p !== waiter);
      clearTimeout(waiter.timer);
      if (words[0] === '!trap' || words[0] === '!fatal') {
        const msg =
          words.find((w) => w.startsWith('=message='))?.slice(9) || words[0];
        waiter.reject(new Error(msg));
      } else {
        waiter.resolve(waiter.sentences);
      }
    }
  }

  _write(words) {
    if (!this.socket || !this.connected) {
      return Promise.reject(new Error('Não conectado ao MikroTik'));
    }

    const tag = String(this.tagSeq++);
    const payload = encodeSentence([...words, `.tag=${tag}`]);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = this.pending.filter((p) => p.tag !== tag);
        reject(new Error('Timeout aguardando resposta da API RouterOS'));
      }, config.mikrotik.timeout);

      this.pending.push({ tag, sentences: [], resolve, reject, timer });
      this.socket.write(payload);
    });
  }

  /**
   * Somente leitura: lista sessões PPPoE ativas.
   */
  async getPppActive() {
    await this.connect();
    const sentences = await this._write([
      '/ppp/active/print',
      '=.proplist=name,service,caller-id,address,uptime,encoding,radius,profile',
    ]);
    const rows = [];

    for (const words of sentences) {
      if (words[0] !== '!re') continue;
      const row = {};
      for (const word of words.slice(1)) {
        if (!word.startsWith('=')) continue;
        const eq = word.indexOf('=', 1);
        if (eq === -1) continue;
        const key = word.slice(1, eq);
        const value = word.slice(eq + 1);
        row[key] = value;
      }
      rows.push({
        name: String(row.name || row['.id'] || 'unknown'),
        address: row.address ? String(row.address) : null,
        callerId: row['caller-id'] ? String(row['caller-id']) : null,
        service: row.service ? String(row.service) : null,
        uptime: row.uptime ? String(row.uptime) : null,
        encoding: row.encoding ? String(row.encoding) : null,
        radius: row.radius ? String(row.radius) : null,
        profile: row.profile ? String(row.profile) : null,
      });
    }

    return rows;
  }

  /**
   * Helper genérico de leitura: roda um /print e devolve as linhas como objetos.
   */
  async _printRows(path, proplist, extraArgs = []) {
    await this.connect();
    const words = [`${path}/print`];
    if (proplist) words.push(`=.proplist=${proplist}`);
    words.push(...extraArgs);
    const sentences = await this._write(words);
    const rows = [];

    for (const s of sentences) {
      if (s[0] !== '!re') continue;
      const row = {};
      for (const word of s.slice(1)) {
        if (!word.startsWith('=')) continue;
        const eq = word.indexOf('=', 1);
        if (eq === -1) continue;
        row[word.slice(1, eq)] = word.slice(eq + 1);
      }
      rows.push(row);
    }

    return rows;
  }

  /**
   * Somente leitura: CPU, memória, uptime, versão do CCR.
   */
  async getSystemResource() {
    const rows = await this._printRows('/system/resource', null);
    const r = rows[0] || {};
    return {
      uptime: r.uptime || null,
      version: r.version || null,
      boardName: r['board-name'] || null,
      cpuLoad: r['cpu-load'] != null ? Number(r['cpu-load']) : null,
      cpuCount: r['cpu-count'] != null ? Number(r['cpu-count']) : null,
      freeMemory: r['free-memory'] != null ? Number(r['free-memory']) : null,
      totalMemory: r['total-memory'] != null ? Number(r['total-memory']) : null,
      freeHddSpace: r['free-hdd-space'] != null ? Number(r['free-hdd-space']) : null,
      totalHddSpace: r['total-hdd-space'] != null ? Number(r['total-hdd-space']) : null,
    };
  }

  /**
   * Somente leitura: voltagem/temperatura (RouterOS 6 devolve uma linha, RouterOS 7 uma por sensor).
   */
  async getSystemHealth() {
    try {
      const rows = await this._printRows('/system/health', null);
      if (rows.length && rows[0].name !== undefined && rows[0].value !== undefined) {
        const out = {};
        for (const row of rows) out[row.name] = row.value;
        return out;
      }
      return rows[0] || {};
    } catch {
      return {};
    }
  }

  /**
   * Somente leitura: estado e contadores de erro/drop de todas as interfaces.
   */
  async getInterfaces() {
    try {
      const rows = await this._printRows(
        '/interface',
        'name,type,running,disabled,rx-byte,tx-byte,rx-drop,tx-drop,rx-error,tx-error,link-downs'
      );
      return rows.map((r) => ({
        name: r.name || null,
        type: r.type || null,
        running: r.running === 'true',
        disabled: r.disabled === 'true',
        rxByte: Number(r['rx-byte'] || 0),
        txByte: Number(r['tx-byte'] || 0),
        rxDrop: Number(r['rx-drop'] || 0),
        txDrop: Number(r['tx-drop'] || 0),
        rxError: Number(r['rx-error'] || 0),
        txError: Number(r['tx-error'] || 0),
        linkDowns: Number(r['link-downs'] || 0),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Somente leitura: leases DHCP ativos (se o CCR também servir DHCP).
   */
  async getDhcpLeases() {
    try {
      const rows = await this._printRows(
        '/ip/dhcp-server/lease',
        'address,mac-address,host-name,status,expires-after,server'
      );
      return rows.map((r) => ({
        address: r.address || null,
        mac: r['mac-address'] || null,
        hostname: r['host-name'] || null,
        status: r.status || null,
        expiresAfter: r['expires-after'] || null,
        server: r.server || null,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Somente leitura: filas simples (limite contratado vs. uso).
   */
  async getQueues() {
    try {
      const rows = await this._printRows(
        '/queue/simple',
        'name,target,max-limit,limit-at,bytes,rate,disabled'
      );
      return rows.map((r) => ({
        name: r.name || null,
        target: r.target || null,
        maxLimit: r['max-limit'] || null,
        limitAt: r['limit-at'] || null,
        bytes: r.bytes || null,
        rate: r.rate || null,
        disabled: r.disabled === 'true',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Somente leitura: clientes wireless registrados (sinal/CCQ), se houver rádio.
   */
  async getWirelessRegistrations() {
    try {
      const rows = await this._printRows(
        '/interface/wireless/registration-table',
        'interface,mac-address,signal-strength,tx-ccq,rx-ccq,uptime'
      );
      return rows.map((r) => ({
        interface: r.interface || null,
        mac: r['mac-address'] || null,
        signal: r['signal-strength'] || null,
        txCcq: r['tx-ccq'] || null,
        rxCcq: r['rx-ccq'] || null,
        uptime: r.uptime || null,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Somente leitura: buffer de log do RouterOS (é circular — por isso persistimos no SQLite).
   */
  async getLogs(limit = 200) {
    try {
      const rows = await this._printRows('/log', 'time,topics,message');
      return rows.slice(-limit).map((r) => ({
        time: r.time || null,
        topics: r.topics || null,
        message: r.message || null,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Somente leitura: contadores de bytes das interfaces PPPoE (pra calcular velocidade).
   */
  async getPppoeInterfaceCounters() {
    await this.connect();
    const sentences = await this._write([
      '/interface/print',
      '=.proplist=name,rx-byte,tx-byte',
      '?type=pppoe-in',
    ]);
    const rows = [];

    for (const words of sentences) {
      if (words[0] !== '!re') continue;
      const row = {};
      for (const word of words.slice(1)) {
        if (!word.startsWith('=')) continue;
        const eq = word.indexOf('=', 1);
        if (eq === -1) continue;
        row[word.slice(1, eq)] = word.slice(eq + 1);
      }
      const match = String(row.name || '').match(/^<pppoe-(.+)>$/);
      if (!match) continue;
      rows.push({
        client: match[1],
        rxByte: Number(row['rx-byte'] || 0),
        txByte: Number(row['tx-byte'] || 0),
      });
    }

    return rows;
  }
}

export const mikrotik = new MikroTikClient();
