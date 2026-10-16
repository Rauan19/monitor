/**
 * Prova que /api/system responde com a ultima leitura guardada quando o CCR
 * nao responde, em vez de devolver 502 e deixar a tela de inicio sem dado.
 *
 * Banco temporario e MIKROTIK_HOST apontando pra uma porta morta: nao fala com
 * CCR nenhum. Rode de dentro de server/:
 *   node scripts/testar-system-offline.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'system-'));
process.env.DB_PATH = path.join(tmp, 'teste.db');
process.env.MIKROTIK_HOST = '127.0.0.1';
process.env.MIKROTIK_PORT = '9'; // descarte: ninguem escuta
process.env.MIKROTIK_TIMEOUT_MS = '300';
process.env.AUTH_PASSWORD = 'x';
process.env.AUTH_SECRET = 'y'.repeat(32);

const { getDb, insertSystemStat } = await import('../src/db/index.js');
const { apiRouter } = await import('../src/routes/api.js');

let falhas = 0;
function conferir(descricao, obtido, esperado) {
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? 'OK  ' : 'FALHA'}  ${descricao} (obtido ${obtido}, esperado ${esperado})`);
}

/** Chama o handler da rota direto, com req/res de mentira. */
function chamar(metodo, caminho) {
  const camada = apiRouter.stack.find(
    (c) => c.route?.path === caminho && c.route.methods[metodo.toLowerCase()]
  );
  if (!camada) throw new Error(`rota ${metodo} ${caminho} nao encontrada`);
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(corpo) {
        resolve({ status: this.statusCode, corpo });
      },
    };
    camada.route.stack[camada.route.stack.length - 1].handle({ query: {} }, res, () => {});
  });
}

// --- Sem nada gravado ainda: 502 e honesto, nao ha o que mostrar ---
const semNada = await chamar('GET', '/system');
conferir('sem historico, CCR morto: 502', semNada.status, 502);

// --- Com uma leitura gravada: responde com ela ---
insertSystemStat({
  cpuLoad: 37,
  freeMemory: 1_000_000,
  totalMemory: 4_000_000,
  voltage: 24.1,
  temperature: 48,
  uptime: '5d3h',
});

const comHistorico = await chamar('GET', '/system');
conferir('com historico, CCR morto: 200', comHistorico.status, 200);
conferir('marcado como desatualizado', comHistorico.corpo.stale, true);
conferir('devolve a CPU guardada', comHistorico.corpo.resource.cpuLoad, 37);
conferir('devolve a memoria guardada', comHistorico.corpo.resource.totalMemory, 4_000_000);
conferir('devolve o uptime guardado', comHistorico.corpo.resource.uptime, '5d3h');
conferir('devolve a temperatura guardada', comHistorico.corpo.health.temperature, 48);
conferir('diz de quando e o dado', typeof comHistorico.corpo.desde, 'string');

// Isso e o que a tela de inicio do app le: se vier vazio, o painel nasce com "—".
const recurso = comHistorico.corpo.resource;
const usoMemoria = Math.round(((recurso.totalMemory - recurso.freeMemory) / recurso.totalMemory) * 100);
conferir('da pra calcular o uso de memoria da tela', usoMemoria, 75);

try {
  getDb().close();
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  // diretorio temporario, nao importa
}
console.log(falhas === 0 ? '\nTodos passaram.' : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
