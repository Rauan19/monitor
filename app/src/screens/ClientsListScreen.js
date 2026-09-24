import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors } from '../theme';
import { api } from '../api';
import ClientRow from '../components/ClientRow';
import { EmptyState, ErrorBanner, LoadingState, Pager, SearchBar, StaleBanner } from '../components/common';
import { withCache } from '../cache';

const PAGE_SIZE = 20;
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
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [staleAt, setStaleAt] = useState(null);
  const [oltsPorId, setOltsPorId] = useState({});
  const focused = useRef(true);

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
      const { data: res, stale, savedAt } = await withCache(
        `clients:${mode}:${query}:${page}`,
        () => FETCHERS[mode]({ q: query, page, pageSize: PAGE_SIZE }),
        (guardado, salvoEm) => {
          aplicar(guardado);
          setStaleAt(salvoEm);
          setLoading(false);
        }
      );
      setStaleAt(stale ? savedAt : null);
      aplicar(res);
      setError('');
    } catch (err) {
      setError(err.message || 'Falha ao carregar');
    } finally {
      setLoading(false);
    }
  }, [mode, query, page]);

  useEffect(() => {
    setPage(1);
  }, [query]);

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
          keyExtractor={(item) => item.session_key}
          renderItem={({ item }) => (
            <ClientRow oltsPorId={oltsPorId} row={item} mode={mode} onPress={() => navigation.navigate('ClientDetail', { sessionKey: item.session_key })} />
          )}
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
