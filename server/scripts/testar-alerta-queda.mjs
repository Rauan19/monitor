/**
 * Teste da confirmacao de queda em massa.
 *
 * Prova o que importa no comportamento novo: queda curta nao notifica, queda
 * que persiste notifica (uma vez so), e quem voltou sai da contagem.
 *
 * Usa banco temporario proprio e nao tem token de push cadastrado, entao nao
 * fala com o CCR nem com o Expo/FCM. Rode de dentro de server/:
 *   node scripts/testar-alerta-queda.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alerta-'));
process.env.DB_PATH = path.join(tmp, 'teste.db');
process.env.OUTAGE_ALERT_CONFIRM_MINUTES = '0.05'; // 3 segundos
process.env.OUTAGE_ALERT_COOLDOWN_MINUTES = '10';
process.env.OUTAGE_ALERT_GAP_MS = '0';
process.env.MIKROTIK_HOST = '127.0.0.1';
process.env.AUTH_PASSWORD = 'x';
process.env.AUTH_SECRET = 'y'.repeat(32);

const { getDb, upsertOnlineSessions, listNotifications } = await import('../src/db/index.js');
const { checkCorrelatedOutages } = await import('../src/poller/index.js');

const db = getDb();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// 6 clientes na porta 5 da OLT 1.
const TODOS = ['ana', 'bia', 'caio', 'duda', 'eva', 'fabio'];
db.prepare(`INSERT INTO olts (id, name, created_at) VALUES (1, 'OLT-TESTE', datetime('now'))`).run();
upsertOnlineSessions(TODOS.map((n) => ({ name: n, address: '10.0.0.1', uptime: '1h' })));
db.prepare(`UPDATE sessions SET olt_id = 1, ont_port = 5`).run();

const online = (nomes) =>
  upsertOnlineSessions(nomes.map((n) => ({ name: n, address: '10.0.0.1', uptime: '1h' })));

const pushes = () => listNotifications({ page: 1, pageSize: 50 }).items.length;

let falhas = 0;
function conferir(descricao, obtido, esperado) {
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? 'OK  ' : 'FALHA'}  ${descricao} (obtido ${obtido}, esperado ${esperado})`);
}

// --- Cenario 1: 4 caem e voltam rapido. Nao deve notificar. ---
online(['ana', 'bia']); // caio, duda, eva, fabio sairam
checkCorrelatedOutages(); // detecta e poe em observacao
conferir('queda curta nao notifica no instante da queda', pushes(), 0);

online(TODOS); // todos voltaram antes do prazo
await esperar(3200);
checkCorrelatedOutages();
conferir('queda curta nao notifica depois do prazo', pushes(), 0);

// --- Cenario 2: 4 caem e continuam fora. Deve notificar uma vez. ---
online(['ana', 'bia']);
checkCorrelatedOutages();
conferir('ainda nao notifica dentro do prazo de espera', pushes(), 0);

await esperar(3200);
checkCorrelatedOutages();
await esperar(200); // a fila de push grava o historico de forma assincrona
conferir('queda que persiste notifica', pushes(), 1);

checkCorrelatedOutages();
await esperar(200);
conferir('nao repete o alerta (cooldown)', pushes(), 1);

// --- Cenario 3: numeros do alerta refletem o momento da confirmacao ---
const alerta = listNotifications({ page: 1, pageSize: 1 }).items[0];
const dados = typeof alerta.data === 'string' ? JSON.parse(alerta.data) : alerta.data;
conferir('conta os 4 que seguem fora', dados.count, 4);
conferir('sobre o total da porta', dados.total, 6);
conferir('aponta a porta certa', dados.port, 5);
console.log(`\n  titulo: ${alerta.title}\n  corpo:  ${alerta.body}`);

// --- Cenario 4: porta SEM olt_id e regiao ---
// Esse e o caminho que roda de verdade: na base real nenhum cliente tem OLT
// associada, so a porta. Se a contagem errasse com olt_id NULL, o alerta nunca
// sairia em producao e o teste acima nao perceberia.
db.prepare(`DELETE FROM notifications`).run();
const SOLTOS = ['gil', 'hugo', 'ivo', 'joao', 'kaue'];
online([...TODOS, ...SOLTOS]);
db.prepare(`UPDATE sessions SET olt_id = NULL, ont_port = 9, loc_region = 'Centro' WHERE name IN ('gil','hugo','ivo','joao','kaue')`).run();

online(TODOS); // os 5 da porta 9 cairam juntos
checkCorrelatedOutages();
conferir('porta sem OLT: nao notifica na hora', pushes(), 0);

await esperar(3200);
checkCorrelatedOutages();
await esperar(300);
conferir('porta sem OLT e regiao notificam quando persistem', pushes(), 2);

const tipos = listNotifications({ page: 1, pageSize: 10 })
  .items.map((n) => n.type)
  .sort()
  .join(',');
conferir('um alerta de porta e um de regiao', tipos, 'outage_port,outage_region');

// No Windows o arquivo fica travado enquanto a conexao estiver aberta, e
// limpar o temporario nao e o que o teste prova: nao pode derrubar o resultado.
try {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  // tudo bem, e um diretorio temporario
}
console.log(falhas === 0 ? '\nTodos passaram.' : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
