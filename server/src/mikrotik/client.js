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
 * Cliente RouterOS API, somente leitura (print).
 */
export class MikroTikClient {
  constructor() {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.connected = false;
    this.connecting = null;
    this.pending = [];
    this.tagSeq = 1;
    this._cache = new Map(); // chave -> { em, valor }
    this._emAndamento = new Map();
    this._avisouFiltroInterface = false; // chave -> Promise
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

        // A conexao sai do servidor e atravessa a internet ate o CCR, passando
        // por NAT no caminho. Sem keepalive, se ela morre em silencio (NAT
        // esquecendo a sessao, reboot de equipamento no meio) o cliente so
        // descobre quando um comando estoura o timeout de 15s: ate la, toda
        // leitura fica pendurada. Com keepalive o proprio sistema derruba o
        // socket morto e a reconexao acontece na hora.
        socket.setKeepAlive(true, 30000);
        // Comandos da API sao pequenos; esperar pra agrupar pacote so adiciona
        // latencia em cada leitura.
        socket.setNoDelay(true);

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
    // Conexao caiu: o que estava em cache virou retrato de antes da queda.
    // Manter serviria dado velho justamente na hora em que o operador precisa
    // saber o que esta acontecendo agora.
    this._limparCache();
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

    // Sentenca sem tag nao pode ser atribuida por chute.
    //
    // Isto era `this.pending[0]`, o comando mais antigo da fila. Todo comando
    // nosso passa pelo _write, que sempre poe tag, login incluido, entao uma
    // sentenca sem tag e anomalia. E o chute tinha um custo assimetrico: uma
    // sentenca de dados entrando no resultado do comando errado o corrompe, e
    // um `!done` sem tag RESOLVE o comando errado antes da hora, devolvendo
    // uma leitura cortada. Com mil sessoes PPPoE, isso e exatamente o sintoma
    // de "o app mostra 157 online".
    //
    // Agora nao adivinha. `!fatal` continua indo pro mais antigo, porque e
    // erro de nivel de conexao e nao de comando: o RouterOS manda sem tag
    // quando vai derrubar a sessao, e engolir isso deixaria todo mundo
    // esperando o timeout. Qualquer outra sentenca sem tag e descartada com
    // aviso: o comando dela vai estourar o timeout, que e visivel e e
    // retentado, em vez de devolver dado faltando, que passa por verdade.
    let waiter;
    if (tag) {
      waiter = this.pending.find((p) => p.tag === tag);
    } else if (words[0] === '!fatal') {
      waiter = this.pending[0];
    } else {
      if (!this._avisouSentencaSemTag) {
        this._avisouSentencaSemTag = true;
        console.warn(
          `[mikrotik] sentenca ${words[0]} sem .tag= com ${this.pending.length} comando(s) em voo; ` +
            'descartada pra nao corromper a resposta de outro comando'
        );
      }
      this._sentencasSemTag = (this._sentencasSemTag || 0) + 1;
      return;
    }

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

    // Guarda as duas contagens pra /api/system. `sentences` e o que a API
    // mandou (inclui o !done e qualquer !re que nao virou linha); `rows` e o
    // que viramos sessao. Se as duas forem ~157 o CCR respondeu 157, e o
    // problema esta no roteador ou na consulta. Se sentences for ~1035 e rows
    // for 157, estamos perdendo linhas no parse, e o problema e nosso.
    this._ultimasSentencasSessoes = sentences.length;
    this._ultimasSessoesLidas = rows.length;

    return rows;
  }

  /**
   * Cache curto + deduplicacao das leituras ao vivo do CCR.
   *
   * O problema: cada tela de cada aparelho disparava uma consulta propria. A
   * tela Sistema recarrega a cada 15s e pede interfaces (583ms), filas (737ms),
   * leases e wireless de uma vez: ~1,4s de trabalho no roteador por aparelho,
   * por ciclo. Com dois celulares abertos isso dobra, e o CCR ja esta ocupado
   * atendendo mais de mil sessoes PPPoE.
   *
   * Duas defesas:
   *
   * 1. TTL curto: uma resposta recente serve todo mundo. Lista de filas e de
   *    interfaces nao muda de segundo em segundo.
   * 2. Deduplicacao: se a mesma leitura ja esta em andamento, os pedidos que
   *    chegam esperam A MESMA promessa em vez de abrir outra consulta. Sem
   *    isso, dois aparelhos pedindo junto viram duas consultas mesmo com TTL,
   *    porque nenhuma delas terminou pra popular o cache ainda.
   */
  async _comCache(chave, ttlMs, fn, maxObsoletoMs = ttlMs * 4) {
    const agora = Date.now();
    const guardado = this._cache.get(chave);
    const idade = guardado ? agora - guardado.em : Infinity;

    // Dentro do TTL: resposta na hora, sem encostar no CCR.
    if (guardado && idade < ttlMs) return guardado.valor;

    const emAndamento = this._emAndamento.get(chave);

    // Venceu o TTL mas ainda nao e velho demais: devolve o guardado AGORA e
    // renova atras.
    //
    // Era aqui que o celular esperava. Vencido o TTL, a requisicao do app
    // ficava parada esperando a ida e volta ao CCR, e o CCR nao e rapido: ele
    // monta a tabela, serializa e manda pela API, tudo isso depois dos ~150ms
    // de rede que o celular ja pagou. Resultado: a tela parecia travada por
    // causa de um dado que a gente ja tinha na memoria, so com alguns segundos
    // de idade.
    //
    // O CCR sai do caminho de quem esta com o celular na mao. O dado servido e
    // no maximo `ttlMs + maxObsoletoMs` velho, e a proxima requisicao, que vem
    // em segundos, ja pega o renovado.
    if (guardado && idade < ttlMs + maxObsoletoMs) {
      if (!emAndamento) {
        // Dispara e esquece, mas sem deixar rejeicao solta: se a leitura
        // falhar, o valor guardado continua valendo e a proxima tentativa
        // acontece no pedido seguinte.
        this._renovar(chave, fn).catch(() => {});
      }
      return guardado.valor;
    }

    // Sem nada guardado, ou velho demais pra servir: ai sim vale esperar.
    if (emAndamento) return emAndamento;
    return this._renovar(chave, fn);
  }

  /** Faz a leitura, guarda o resultado e desduplica quem pedir junto. */
  _renovar(chave, fn) {
    const promessa = (async () => {
      try {
        const valor = await fn();
        this._cache.set(chave, { em: Date.now(), valor });
        return valor;
      } finally {
        this._emAndamento.delete(chave);
      }
    })();

    this._emAndamento.set(chave, promessa);
    return promessa;
  }

  /**
   * Diagnostico das leituras do CCR, pra /api/system.
   *
   * Existe por uma pergunta que nao tinha resposta: o filtro que exclui as
   * ~1000 interfaces PPPoE usa a negacao `?#!` da pilha de query da API, que
   * foi deduzida das regras e nunca testada contra um CCR de verdade. Se ela
   * nao funcionar nesta versao de RouterOS, o codigo cai calado pra ler a
   * tabela inteira e avisa UMA vez no log, aviso que num servidor rodando ha
   * semanas ja saiu do pm2 fazia tempo. Era um "talvez" permanente sobre a
   * causa da lentidao.
   */
  diagnostico() {
    return {
      interfacesLidasPorVez: this._ultimasInterfacesLidas ?? null,
      filtroDeInterfaceFuncionando: !this._avisouFiltroInterface,
      // Quantas linhas o /ppp/active/print devolveu na ultima leitura, e
      // quantas sentencas a API mandou no total.
      //
      // Isto existe pra separar duas causas que dao o MESMO sintoma, "o app
      // mostra 157 online quando ha mais de mil", e que tem consertos
      // opostos: ou o CCR respondeu 157, ou ele respondeu mil e nos perdemos
      // linhas na leitura. Sem esse numero as duas sao indistinguiveis de
      // fora, e o banco nao ajuda, porque ele guarda o resultado, nao a
      // leitura.
      sessoesLidasPorVez: this._ultimasSessoesLidas ?? null,
      sentencasNaUltimaLeituraDeSessoes: this._ultimasSentencasSessoes ?? null,
      // Quantas interfaces pppoe-in existem. Como sao dinamicas, isto equivale
      // ao numero de sessoes ativas, medido por outro comando. Comparar com
      // sessoesLidasPorVez fecha o diagnostico.
      interfacesPppoeAtivas: this._ultimosContadoresPppoe ?? null,
      // Quantas sentencas chegaram sem .tag= e foram descartadas. Se isto for
      // maior que zero, o protocolo esta se comportando de um jeito que o
      // codigo nao previa, e e o primeiro lugar pra olhar numa leitura cortada.
      sentencasSemTagDescartadas: this._sentencasSemTag ?? 0,
    };
  }

  /** Descarta o cache (usado quando a conexao com o CCR cai). */
  _limparCache() {
    this._cache.clear();
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
    return this._comCache('getSystemResource', 5000, () => this._getSystemResource());
  }

  async _getSystemResource() {
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
    return this._comCache('getSystemHealth', 5000, () => this._getSystemHealth());
  }

  async _getSystemHealth() {
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
    // TTL maior que o intervalo do poller (10s). Com 5s o cache nunca acertava:
    // cada ciclo do poller refazia a leitura, e um celular abrindo a tela de
    // interfaces no meio fazia outra. Com 15s o ciclo do poller e as telas
    // compartilham a mesma resposta.
    return this._comCache('getInterfaces', 15000, () => this._getInterfaces());
  }

  async _getInterfaces() {
    try {
      const props =
        'name,type,running,disabled,rx-byte,tx-byte,rx-drop,tx-drop,rx-error,tx-error,link-downs';

      // Pede ao CCR todas as interfaces MENOS as pppoe-in.
      //
      // Isso aqui era a consulta mais pesada do sistema. Quem chama precisa dos
      // links de transporte (uplink, fibra de POP, radio de torre): uma duzia de
      // interfaces. Sem filtro o CCR montava a tabela inteira, e numa rede com
      // mil sessoes PPPoE isso e mil e poucas linhas com 11 propriedades cada,
      // a cada ciclo. Era de longe o maior consumidor de CPU do roteador no
      // monitor, e e o que fazia as leituras estourarem o timeout.
      //
      // Sintaxe da query da API: ?type=pppoe-in empilha a comparacao e ?#!
      // inverte o topo da pilha. Sobra tudo que nao e pppoe-in.
      let rows = await this._printRows('/interface', props, ['?type=pppoe-in', '?#!']);

      // A negacao foi deduzida das regras da pilha de query, nao de um exemplo
      // dos docs, e nao deu pra testar contra um CCR de verdade. Se ela nao
      // funcionar nesta versao de RouterOS o resultado vem vazio, e quem chama
      // trata vazio como falha de leitura: o monitoramento de link morreria
      // calado. Entao: vazio aqui cai pra consulta sem filtro, que e o
      // comportamento antigo, e avisa uma vez no log.
      if (!rows.length) {
        if (!this._avisouFiltroInterface) {
          this._avisouFiltroInterface = true;
          console.warn(
            '[mikrotik] o filtro ?#! nao devolveu interfaces nesta versao de RouterOS; ' +
              'voltando a ler a tabela inteira (mais pesado pro CCR)'
          );
        }
        rows = await this._printRows('/interface', props);
      }

      // Quantas linhas o CCR mandou de fato. Com o filtro funcionando sao umas
      // dezenas (so os links de transporte); se cair pra tabela inteira sao
      // mil e poucas. Exposto em /api/system pra dar pra responder "o CCR esta
      // lento por causa disso?" olhando um numero, em vez de supondo.
      this._ultimasInterfacesLidas = rows.length;

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
    return this._comCache('getDhcpLeases', 15000, () => this._getDhcpLeases());
  }

  async _getDhcpLeases() {
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
    return this._comCache('getQueues', 30000, () => this._getQueues());
  }

  async _getQueues() {
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
    return this._comCache('getWirelessRegistrations', 15000, () => this._getWirelessRegistrations());
  }

  async _getWirelessRegistrations() {
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
   * Somente leitura: buffer de log do RouterOS (é circular, por isso persistimos no SQLite).
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

    // O numero de ouro pra comparar com sessoesLidasPorVez.
    //
    // Interface pppoe-in e dinamica: o RouterOS cria quando a sessao sobe e
    // apaga quando ela cai. Entao este numero e, por definicao, a quantidade de
    // sessoes PPPoE ativas, lido por outro comando na MESMA conexao com o
    // mesmo CCR. Se aqui der mil e o /ppp/active der 157, nao ha duvida de
    // interpretacao: as sessoes existem e e a nossa leitura delas que esta
    // vindo cortada.
    this._ultimosContadoresPppoe = rows.length;

    return rows;
  }
}

export const mikrotik = new MikroTikClient();
