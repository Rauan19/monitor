/**
 * Diagnostico: descobre se da pra preencher a porta ONT dos clientes
 * automaticamente, lendo o CCR.
 *
 * Por que existe: o alerta de queda em massa agrupa os clientes por porta. Se
 * ninguem tem porta preenchida, nao existe grupo e o alerta nunca dispara, por
 * mais que meia OLT caia. Preencher 1000 clientes a mao e inviavel, entao a
 * pergunta e: o CCR sabe por qual VLAN/porta cada sessao PPPoE entra?
 *
 * Rode no servidor, onde o CCR responde:
 *   node scripts/descobrir-portas.mjs
 *
 * E so leitura, nao altera nada no CCR nem no banco.
 */
import 'dotenv/config';
import { mikrotik } from '../src/mikrotik/client.js';

const linha = (t = '') => console.log(t);
const titulo = (t) => {
  linha('');
  linha('=== ' + t + ' ===');
};

async function tentar(nome, fn) {
  try {
    return await fn();
  } catch (err) {
    linha(`  (${nome} falhou: ${err?.message || err})`);
    return null;
  }
}

async function main() {
  titulo('Sessoes PPPoE ativas: todos os campos que o CCR devolve');
  const ativos = await tentar('/ppp/active', () => mikrotik._printRows('/ppp/active', null));
  if (ativos?.length) {
    const campos = new Set();
    for (const r of ativos.slice(0, 100)) Object.keys(r).forEach((k) => campos.add(k));
    linha(`  ${ativos.length} sessoes`);
    linha('  campos: ' + [...campos].sort().join(', '));
    linha('  exemplo: ' + JSON.stringify(ativos[0]));
  }

  titulo('Interfaces pppoe-server (costuma ligar a sessao a interface de origem)');
  const srv = await tentar('/interface/pppoe-server', () =>
    mikrotik._printRows('/interface/pppoe-server', null)
  );
  if (srv?.length) {
    linha(`  ${srv.length} linhas`);
    linha('  campos: ' + Object.keys(srv[0]).join(', '));
    linha('  exemplos:');
    for (const r of srv.slice(0, 3)) linha('    ' + JSON.stringify(r));

    // O que interessa: existe um campo apontando pra VLAN/porta?
    const chaveInterface = Object.keys(srv[0]).find((k) =>
      /interface|service|port/i.test(k)
    );
    if (chaveInterface) {
      const valores = {};
      for (const r of srv) {
        const v = r[chaveInterface] || '(vazio)';
        valores[v] = (valores[v] || 0) + 1;
      }
      linha('');
      linha(`  >> DISTRIBUICAO por "${chaveInterface}" (se aparecerem as VLANs GPON aqui, da pra automatizar):`);
      for (const [v, c] of Object.entries(valores).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
        linha('     ' + String(v).padEnd(30) + c + ' sessoes');
      }
    }
  }

  titulo('Servidores PPPoE configurados (mostra sobre quais interfaces rodam)');
  const servers = await tentar('/interface/pppoe-server/server', () =>
    mikrotik._printRows('/interface/pppoe-server/server', null)
  );
  if (servers?.length) {
    for (const r of servers) linha('  ' + JSON.stringify(r));
  }

  titulo('Conclusao');
  linha('  Se a distribuicao acima mostrar as VLANs (GPON-2/PORTA-1, etc) com as');
  linha('  sessoes espalhadas entre elas, o preenchimento automatico e possivel.');
  linha('  Me mande esta saida inteira.');

  await mikrotik.disconnect();
}

main()
  .catch((err) => {
    console.error('Erro:', err?.message || err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
