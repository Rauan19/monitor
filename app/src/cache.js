import AsyncStorage from '@react-native-async-storage/async-storage';

// Cache offline das telas. O app e cliente puro: sem rede, toda tela ficava
// vazia com um banner de erro. Aqui guardamos a ultima resposta boa de cada
// tela e devolvemos ela quando a requisicao falha, marcando como desatualizada
// pra tela avisar de quando e o dado.
//
// Nao substitui o servidor: e so a ultima foto conhecida. Historico grande
// (banda, log do CCR) continua sendo buscado sob demanda e nao entra aqui.

const PREFIX = 'monitorzcnet:cache:';

// AsyncStorage no Android tem limite de tamanho. Paginas de 20 itens sao
// pequenas, mas grafico/estatistica pode vir grande: acima disso nao cacheia,
// porque encher o storage atrapalharia o resto do app.
const MAX_BYTES = 256 * 1024;

// Depois disso o guardado nao serve mais pra nada.
//
// O cache nao tinha validade, e aparecia na tela "Sem conexao com o servidor,
// mostrando dados de 32 dias atras". Quem esta online AGORA, ha 32 dias, e
// informacao inventada: a tela parecia cheia e estava mentindo. Vencido, vale
// mais mostrar o erro de conexao e a tela vazia, que pelo menos sao verdade.
//
// 12 horas cobre o caso que o cache existe pra resolver (abrir o app numa area
// sem sinal, servidor fora do ar por um tempo) sem chegar perto de um dado que
// nao descreve mais a rede.
const VALIDADE_MS = Number(12 * 60 * 60 * 1000);

// Cache em memoria RAM pra evitar JSON.parse + leitura de disco ao trocar de
// aba dentro da mesma sessao do app.
const memoria = new Map();

export async function readCache(key) {
  const emRam = memoria.get(key);
  if (emRam) {
    if (Date.now() - emRam.savedAt <= VALIDADE_MS) return emRam;
    memoria.delete(key);
  }
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > VALIDADE_MS) {
      // Apaga em vez de so ignorar: senao fica ocupando o storage do aparelho
      // pra sempre, e o storage do Android e limitado.
      AsyncStorage.removeItem(PREFIX + key).catch(() => {});
      return null;
    }
    memoria.set(key, parsed);
    return parsed; // { data, savedAt }
  } catch {
    return null;
  }
}

export async function writeCache(key, data) {
  const entry = { data, savedAt: Date.now() };
  memoria.set(key, entry);
  try {
    const raw = JSON.stringify(entry);
    if (raw.length > MAX_BYTES) return;
    await AsyncStorage.setItem(PREFIX + key, raw);
  } catch {
    // best-effort: falhar em cachear nunca pode quebrar a tela
  }
}

// Quantas falhas SEGUIDAS ate avisar "sem conexao com o servidor".
//
// O aviso aparecia na primeira requisicao que falhasse. Medindo o servidor de
// producao em 70 chamadas seguidas na rota /api/health, que so devolve
// {ok:true}, cerca de uma em cada dez falha ou passa de 5s. Com as telas
// recarregando a cada 10s, isso fazia o aviso piscar o tempo todo: aparecia num
// ciclo, sumia no seguinte, e o conteudo pulava junto.
//
// Uma falha isolada nao e queda de conexao, e um tropeco. Com duas seguidas o
// aviso so aparece depois de uns 20s sem resposta, que ai e de verdade. Enquanto
// isso a tela continua mostrando o que tem, sem alarme.
const FALHAS_PRA_AVISAR = 2;
const falhasSeguidas = new Map();

/**
 * Busca na rede e cacheia. Se a rede falhar e houver cache, devolve o cache
 * em vez de propagar o erro, marcando `stale` so depois de falhas seguidas.
 *
 * Devolve { data, stale, savedAt }. Se falhar e nao houver cache, lanca o erro
 * original, pra tela mostrar o banner de erro como antes.
 */
export async function withCache(key, fetcher, aoReceberCache) {
  // Dispara a requisicao de rede IMEDIATAMENTE, em paralelo com a leitura do
  // cache em disco. Antes o `await readCache(key)` vinha antes de `fetcher()`,
  // entao na primeira consulta (ou com disco ocupado) o pacote HTTP nem saia
  // do celular enquanto o AsyncStorage nao terminasse de ler.
  let redeConcluiu = false;

  if (aoReceberCache) {
    const emRam = memoria.get(key);
    if (emRam && Date.now() - emRam.savedAt <= VALIDADE_MS) {
      aoReceberCache(emRam.data, emRam.savedAt);
    } else {
      readCache(key)
        .then((guardado) => {
          if (guardado && !redeConcluiu) {
            aoReceberCache(guardado.data, guardado.savedAt);
          }
        })
        .catch(() => {});
    }
  }

  try {
    const data = await fetcher();
    redeConcluiu = true;
    writeCache(key, data); // sem await: nao atrasa a tela
    falhasSeguidas.delete(key);
    return { data, stale: false, savedAt: null };
  } catch (err) {
    redeConcluiu = true;
    const falhas = (falhasSeguidas.get(key) || 0) + 1;
    falhasSeguidas.set(key, falhas);

    const cached = await readCache(key);
    if (cached) {
      return {
        data: cached.data,
        // Uma falha sozinha nao vira aviso: a tela segue mostrando o que tem.
        stale: falhas >= FALHAS_PRA_AVISAR,
        savedAt: cached.savedAt,
      };
    }
    throw err;
  }
}

export async function clearCache() {
  memoria.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(PREFIX));
    if (ours.length) await AsyncStorage.multiRemove(ours);
  } catch {
    // best-effort
  }
}
