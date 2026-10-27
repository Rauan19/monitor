import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors } from '../theme';
import { api } from '../api';
import ClientRow from '../components/ClientRow';
import { EmptyState, ErrorBanner, LoadingState, Pager, SearchBar, StaleBanner } from '../components/common';
import { withCache } from '../cache';

const PAGE_SIZE = 20;

const chaveDaLinha = (item) => item.session_key;

// Quantas falhas de rede seguidas antes de avisar na tela. Mesmo numero que o
// cache.js usa, pelo mesmo motivo.
const FALHAS_PRA_AVISAR = 2;
const emptyMeta = { page: 1, pageSize: PAGE_SIZE, total: 0, pages: 1 };

const FETCHERS = {
  all: api.all,
  online: api.online,
  disconnected: (opts) => api.disconnected({ ...opts, hours: 24 }),
};

const EMPTY_COPY = {
  all: { title: 'Nenhum cliente ainda', hint: 'Online e offline aparecem juntos aqui.' },
  online: { title: 'Ninguém online', hint: 'Quando o CCR conectar, as sessões aparecem.' },
  disconnected: { title: 'Nenhuma queda em 24h', hint: 'Quem sair do PPPoE Active entra aqui.' },
};

export default function ClientsListScreen({ mode }) {
  const navigation = useNavigation();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(emptyMeta);
  const [page, setPage] = useState(1);
  // `query` e o que esta escrito na caixa; `buscaFirme` e o que vai pra rede.
  //
  // Eram a mesma coisa, e `load` depende dela: cada tecla disparava uma
  // requisicao E derrubava/recriava o intervalo de 5s do useFocusEffect.
  // Digitar "joaosilva" eram dez requisicoes e dez trocas de timer, num
  // aparelho com uns 150ms de ida e volta. Era isso que travava a digitacao.
  const [query, setQuery] = useState('');
  const [buscaFirme, setBuscaFirme] = useState('');
  // Chaves de cache que ja receberam dado fresco. Ver o comentario no
  // callback do withCache.
  const chavesCarregadas = useRef(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [staleAt, setStaleAt] = useState(null);
  const [oltsPorId, setOltsPorId] = useState({});
  const focused = useRef(true);
  const falhasSeguidas = useRef(0);

  const load = useCallback(async () => {
    try {
      const aplicar = (res) => {
        setRows(res.items || []);
        setMeta({
          page: res.page || 1,
          pageSize: res.pageSize || PAGE_SIZE,
          total: res.total || 0,
          pages: res.pages || 1,
        });
      };
      const chaveCache = `clients:${mode}:${buscaFirme}:${page}`;
      const { data: res, stale, savedAt } = await withCache(
        chaveCache,
        () => FETCHERS[mode]({ q: buscaFirme, page, pageSize: PAGE_SIZE }),
        // Mostra o guardado antes da rede responder so quando a tela ainda nao
        // tem o dado DESTA chave: primeira carga, ou o usuario trocou de pagina,
        // busca ou filtro. Numa atualizacao da mesma chave isso fazia o aviso de
        // "desatualizado" entrar e sair a cada ciclo, e a tela tremia.
        chavesCarregadas.current.has(chaveCache)
          ? null
          : (guardado, salvoEm) => {
              aplicar(guardado);
              setStaleAt(salvoEm);
              setLoading(false);
            }
      );
      setStaleAt(stale ? savedAt : null);
      aplicar(res);
      chavesCarregadas.current.add(chaveCache);
      falhasSeguidas.current = 0;
      setError('');
    } catch (err) {
      // Tropeço de rede nao merece banner vermelho na primeira vez. O
      // request() ja insiste tres vezes numa falha instantanea; se mesmo assim
      // falhou, o ciclo de 5s tenta de novo logo. Mostrar na hora era o que
      // fazia aparecer "Nao foi possivel falar com o servidor" e, segundos
      // depois, a lista cheia, como se o app estivesse quebrado.
      //
      // Erro do servidor (HTTP 500, 403) aparece na hora: ai nao e tropeço,
      // insistir nao resolve e quem esta olhando precisa saber.
      falhasSeguidas.current += 1;
      if (!err.deRede || falhasSeguidas.current >= FALHAS_PRA_AVISAR) {
        setError(err.message || 'Falha ao carregar');
      }
    } finally {
      setLoading(false);
    }
  }, [mode, buscaFirme, page]);

  // 350ms depois da ultima tecla. Curto o bastante pra parecer imediato, longo
  // o bastante pra uma palavra inteira virar uma requisicao so.
  useEffect(() => {
    const t = setTimeout(() => setBuscaFirme(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [buscaFirme]);

  useEffect(() => {
    // O cadastro de OLTs muda raramente, entao busca uma vez em vez de vir
    // junto do polling da lista.
    let ativo = true;
    api
      .listOlts()
      .then((res) => {
        if (!ativo) return;
        const mapa = {};
        for (const o of res.olts || []) mapa[o.id] = o.name;
        setOltsPorId(mapa);
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      load();
      const id = setInterval(() => {
        if (focused.current) load();
      }, 5000);
      return () => {
        focused.current = false;
        clearInterval(id);
      };
    }, [load])
  );

  const copy = EMPTY_COPY[mode];

  // Estaveis entre renders: com uma arrow nova a cada vez, o memo do ClientRow
  // nao seguraria nada e as 20 linhas seriam refeitas em todo ciclo de 5s.
  const abrirCliente = useCallback(
    (row) => navigation.navigate('ClientDetail', { sessionKey: row.session_key }),
    [navigation]
  );
  const renderItem = useCallback(
    ({ item }) => (
      <ClientRow oltsPorId={oltsPorId} row={item} mode={mode} onPress={abrirCliente} />
    ),
    [oltsPorId, mode, abrirCliente]
  );

  return (
    <View style={styles.screen}>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Buscar nome, IP ou MAC" />
      <ErrorBanner message={error} />
      <StaleBanner savedAt={staleAt} />
      {loading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={chaveDaLinha}
          renderItem={renderItem}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={5}
          removeClippedSubviews
          ListEmptyComponent={<EmptyState title={copy.title} hint={copy.hint} />}
          ListFooterComponent={<Pager meta={meta} onChange={setPage} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 12 },
});
