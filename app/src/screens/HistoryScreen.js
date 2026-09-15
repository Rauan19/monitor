import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radius } from '../theme';
import { api } from '../api';
import { Badge, EmptyState, ErrorBanner, LoadingState, Pager, SearchBar, StaleBanner } from '../components/common';
import { formatDate } from '../format';
import { withCache } from '../cache';

const PAGE_SIZE = 20;
const emptyMeta = { page: 1, pageSize: PAGE_SIZE, total: 0, pages: 1 };
const TYPES = [
  { id: '', label: 'Todos' },
  { id: 'disconnected', label: 'Desconexões' },
  { id: 'connected', label: 'Conexões' },
];

export default function HistoryScreen() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(emptyMeta);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [staleAt, setStaleAt] = useState(null);
  const focused = useRef(true);

  const load = useCallback(async () => {
    try {
      const { data: res, stale, savedAt } = await withCache(
        `events:${type}:${query}:${page}`,
        () => api.events({ q: query, type, hours: 168, page, pageSize: PAGE_SIZE })
      );
      setStaleAt(stale ? savedAt : null);
      setRows(res.items || []);
      setMeta({ page: res.page || 1, pageSize: res.pageSize || PAGE_SIZE, total: res.total || 0, pages: res.pages || 1 });
      setError('');
    } catch (err) {
      setError(err.message || 'Falha ao carregar');
    } finally {
      setLoading(false);
    }
  }, [query, type, page]);

  useEffect(() => {
    setPage(1);
  }, [query, type]);

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

  return (
    <View style={styles.screen}>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Buscar nome, IP ou MAC" />
      <View style={styles.filterRow}>
        {TYPES.map((t) => (
          <Pressable key={t.id} onPress={() => setType(t.id)} style={[styles.filterChip, type === t.id && styles.filterChipActive]}>
            <Text style={[styles.filterChipText, type === t.id && styles.filterChipTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorBanner message={error} />
      <StaleBanner savedAt={staleAt} />
      {loading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => {
            const down = item.event_type === 'disconnected';
            return (
              <View style={styles.row}>
                <Badge label={down ? 'Desconectou' : 'Conectou'} tone={down ? 'warn' : 'ok'} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.name || '—'}
                  </Text>
                  <Text style={styles.rowMeta}>{item.address || 'sem IP'}</Text>
                </View>
                <Text style={styles.rowDate}>{formatDate(item.created_at)}</Text>
              </View>
            );
          }}
          ListEmptyComponent={<EmptyState title="Nenhum evento no período" hint="Conexões e desconexões ficam aqui." />}
          ListFooterComponent={<Pager meta={meta} onChange={setPage} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 12 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line },
  filterChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterChipText: { color: colors.inkFaint, fontSize: 12, fontWeight: '650' },
  filterChipTextActive: { color: '#061024' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, padding: 12, marginBottom: 8 },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { color: colors.ink, fontSize: 14, fontWeight: '650' },
  rowMeta: { color: colors.inkFaint, fontSize: 12, marginTop: 2, fontFamily: 'monospace' },
  rowDate: { color: colors.inkFaint, fontSize: 11 },
});
