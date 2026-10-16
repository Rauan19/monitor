/**
 * Mede quanto tempo o CCR leva em cada leitura que o monitor faz, e confirma se
 * o filtro novo de interfaces funciona nesta versao de RouterOS.
 *
 * Rode no servidor, onde o CCR responde:
 *   cd server && node scripts/medir-carga-ccr.mjs
 *
 * E so leitura: nao altera nada no CCR nem no banco.
 */
import 'dotenv/config';
import { mikrotik } from '../src/mikrotik/client.js';

const PROPS =
  'name,type,running,disabled,rx-byte,tx-byte,rx-drop,tx-drop,rx-error,tx-error,link-downs';

async function cronometrar(rotulo, fn) {
  const t = Date.now();
  try {
    const linhas = await fn();
    const ms = Date.now() - t;
    const n = Array.isArray(linhas) ? linhas.length : 1;
    console.log(`  ${rotulo.padEnd(46)} ${String(ms).padStart(6)} ms   ${String(n).padStart(5)} linhas`);
    return { ms, n, linhas };
  } catch (err) {
    console.log(`  ${rotulo.padEnd(46)} ${'ERRO'.padStart(6)}      ${err?.message || err}`);
    return { ms: Date.now() - t, n: 0, linhas: null, erro: true };
  }
}

async function main() {
  console.log('\n=== Leituras que o monitor faz no CCR ===\n');

  const ativos = await cronometrar('/ppp/active (a cada 10s)', () =>
    mikrotik._printRows('/ppp/active', 'name,service,caller-id,address,uptime')
  );

  const banda = await cronometrar('/interface ?type=pppoe-in (a cada 30s)', () =>
    mikrotik._printRows('/interface', 'name,rx-byte,tx-byte', ['?type=pppoe-in'])
  );

  console.log('');
  const semFiltro = await cronometrar('/interface SEM filtro (era a cada 10s)', () =>
    mikrotik._printRows('/interface', PROPS)
  );

  const comFiltro = await cronometrar('/interface ?#! sem pppoe (agora, a cada 15s)', () =>
    mikrotik._printRows('/interface', PROPS, ['?type=pppoe-in', '?#!'])
  );

  console.log('\n=== O filtro funciona nesta versao de RouterOS? ===\n');
  if (comFiltro.erro || !comFiltro.n) {
    console.log('  NAO. O filtro voltou vazio ou deu erro.');
    console.log('  O codigo detecta isso e volta a ler a tabela inteira, entao nada quebra,');
    console.log('  mas o ganho desta parte nao acontece. Me mande esta saida.');
  } else {
    const pppoeVazou = comFiltro.linhas.filter((r) => r.type === 'pppoe-in').length;
    const transporteSemFiltro = (semFiltro.linhas || []).filter((r) => r.type !== 'pppoe-in').length;

    console.log(`  Sem filtro:  ${semFiltro.n} linhas`);
    console.log(`  Com filtro:  ${comFiltro.n} linhas`);
    console.log(`  PPPoE que vazaram pelo filtro: ${pppoeVazou} (tem que ser 0)`);
    console.log(`  Interfaces de transporte sem filtro: ${transporteSemFiltro} (tem que bater com o "com filtro")`);

    const certo = pppoeVazou === 0 && comFiltro.n === transporteSemFiltro;
    console.log(`\n  ${certo ? 'SIM, o filtro esta correto.' : 'ATENCAO: os numeros nao batem, me mande esta saida.'}`);
    if (semFiltro.ms > 0) {
      const ganho = Math.round((1 - comFiltro.ms / semFiltro.ms) * 100);
      console.log(`  Tempo no CCR: ${semFiltro.ms} ms -> ${comFiltro.ms} ms (${ganho}% menos)`);
    }
  }

  console.log('\n=== Carga por minuto (linhas x propriedades que o CCR monta) ===\n');
  const antes = ativos.n * 5 * 6 + banda.n * 3 * 6 + semFiltro.n * 11 * 6;
  const agora = ativos.n * 5 * 6 + banda.n * 3 * 2 + (comFiltro.erro ? semFiltro.n : comFiltro.n) * 11 * 4;
  console.log(`  Antes:  ${antes.toLocaleString('pt-BR')}`);
  console.log(`  Agora:  ${agora.toLocaleString('pt-BR')}`);
  console.log(`  Queda:  ${Math.round((1 - agora / antes) * 100)}%`);

  await mikrotik.disconnect();
}

main()
  .catch((err) => {
    console.error('Erro:', err?.message || err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
