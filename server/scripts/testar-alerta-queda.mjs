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
process.env.LINK_ALERT_CONFIRM_MINUTES = '0.03'; // ~1.8 segundos
process.env.MIKROTIK_HOST = '127.0.0.1';
process.env.AUTH_PASSWORD = 'x';
process.env.AUTH_SECRET = 'y'.repeat(32);

const { getDb, upsertOnlineSessions, listNotifications, addMonitoredLink, setNote, listAll } = await import('../src/db/index.js');
const { checkCorrelatedOutages, checkInactiveClients } = await import('../src/poller/index.js');
const { checkLinks, resetLinkState } = await import('../src/poller/links.js');
const { mikrotik } = await import('../src/mikrotik/client.js');

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

// --- Cenario 5: clientes antigos ja offline ha dias NAO disparam alerta falso ---
db.prepare(`DELETE FROM notifications`).run();
const PORTA_ANTIGA = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
online([...TODOS, ...SOLTOS, ...PORTA_ANTIGA]);
db.prepare(`UPDATE sessions SET olt_id = 1, ont_port = 7 WHERE name IN ('p1','p2','p3','p4','p5','p6')`).run();
// p1, p2, p3 cairam ha 3 dias (clientes velhos/cancelados)
const tresDiasAtras = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
db.prepare(`UPDATE sessions SET is_online = 0, disconnected_at = ?, inactive_notified_at = ? WHERE name IN ('p1','p2','p3')`).run(
  tresDiasAtras,
  tresDiasAtras
);
// Agora p4, p5, p6 piscam rapido (caem e voltam em 1s)
online([...TODOS, ...SOLTOS]); // p4, p5, p6 acabaram de cair
checkCorrelatedOutages(); // poe porta 7 em observacao
online([...TODOS, ...SOLTOS, 'p4', 'p5', 'p6']); // p4, p5, p6 ja voltaram! (so p1,p2,p3 antigos continuam offline)
await esperar(3200);
checkCorrelatedOutages();
await esperar(200);
conferir('clientes antigos offline nao confirmam piscada como queda em massa', pushes(), 0);

// --- Cenario 6: cliente inativo por 48h notifica 1 vez e reseta se reconectar ---
db.prepare(`DELETE FROM notifications`).run();
const anaKey = db.prepare(`SELECT session_key FROM sessions WHERE name = 'ana'`).get().session_key;
setNote(anaKey, 'Cliente viajou');
conferir('busca acha cliente pela nota opcional', listAll({ q: 'viajou' }).total, 1);
const cinquentaHorasAtras = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();
db.prepare(`UPDATE sessions SET is_online = 0, disconnected_at = ?, inactive_notified_at = NULL WHERE name = 'ana'`).run(
  cinquentaHorasAtras
);
checkInactiveClients();
await esperar(200);
conferir('cliente inativo ha 48h gera 1 notificacao', pushes(), 1);
const notifInativo = listNotifications({ page: 1, pageSize: 1 }).items[0];
conferir('tipo da notificacao de inativo', notifInativo.type, 'client_inactive');
conferir('notificacao traz a nota opcional do cliente', notifInativo.data?.note, 'Cliente viajou');
checkInactiveClients();
await esperar(200);
conferir('nao repete notificacao do mesmo cliente inativo', pushes(), 1);

// --- Cenario 7: link de transporte espera confirmacao (3 min) antes de alertar ---
db.prepare(`DELETE FROM notifications`).run();
resetLinkState();
addMonitoredLink('ether1-uplink', 'Operadora');
let estadoLink = true;
mikrotik.getInterfaces = async () => [
  { name: 'ether1-uplink', type: 'ether', running: estadoLink, disabled: false, rxByte: 1e12, txByte: 1e12, linkDowns: 0 },
];
await checkLinks(); // 1a leitura inicial
estadoLink = false;
await checkLinks(); // caiu agora -> entra em espera
await esperar(200);
conferir('link que acabou de cair nao notifica antes dos 3 min', pushes(), 0);
estadoLink = true;
await checkLinks(); // voltou rapido -> piscada curta, zero pushes
await esperar(2000);
conferir('link que piscou e voltou antes do prazo nao notifica', pushes(), 0);

estadoLink = false;
await checkLinks(); // caiu de verdade
await esperar(2000);
await checkLinks(); // passou do prazo de confirmacao -> agora notifica queda
await esperar(200);
conferir('link que persiste caido notifica link_down', pushes(), 1);
estadoLink = true;
await checkLinks(); // voltou depois de ter notificado -> notifica link_up
await esperar(200);
conferir('link que voltou apos queda confirmada notifica link_up', pushes(), 2);

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
