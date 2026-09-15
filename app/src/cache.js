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

export async function readCache(key) {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    return parsed; // { data, savedAt }
  } catch {
    return null;
  }
}

export async function writeCache(key, data) {
  try {
    const raw = JSON.stringify({ data, savedAt: Date.now() });
    if (raw.length > MAX_BYTES) return;
    await AsyncStorage.setItem(PREFIX + key, raw);
  } catch {
    // best-effort: falhar em cachear nunca pode quebrar a tela
  }
}

/**
 * Busca na rede e cacheia. Se a rede falhar e houver cache, devolve o cache
 * marcado como `stale` em vez de propagar o erro.
 *
 * Devolve { data, stale, savedAt }. Se falhar e nao houver cache, lanca o erro
 * original, pra tela mostrar o banner de erro como antes.
 */
export async function withCache(key, fetcher) {
  try {
    const data = await fetcher();
    writeCache(key, data); // sem await: nao atrasa a tela
    return { data, stale: false, savedAt: null };
  } catch (err) {
    const cached = await readCache(key);
    if (cached) return { data: cached.data, stale: true, savedAt: cached.savedAt };
    throw err;
  }
}

export async function clearCache() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(PREFIX));
    if (ours.length) await AsyncStorage.multiRemove(ours);
  } catch {
    // best-effort
  }
}
