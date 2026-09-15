import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { api } from '../api';
import { Badge, EmptyState, ErrorBanner, LoadingState, Pager, SearchBar, StaleBanner } from '../components/common';
import { formatDate, relativeAgo } from '../format';
import { withCache } from '../cache';

const PAGE_SIZE = 20;
const emptyMeta = { page: 1, pageSize: PAGE_SIZE, total: 0, pages: 1 };
const TYPES = [
  { id: '', label: 'Todos' },
  { id: 'disconnected', label: 'Desconexões' },
  { id: 'connected', label: 'Conexões' },
];

/**
 * Uma linha do historico. Antes mostrava so nome, IP e data, e nao dava pra
 * tocar. Porta, OLT e a regiao da porta vem do servidor junto do evento, porque
 * a pergunta que se faz lendo o historico e "esse que caiu fica em qual porta?".
 */
function EventoRow({ item, navigation }) {
  const down = item.event_type === 'disconnected';
  const nome = item.alias || item.name || '—';
  const local = [item.loc_neighborhood, item.loc_city].filter(Boolean).join(', ');

  return (
    <Pressable
      onPress={() => navigation.navigate('ClientDetail', { sessionKey: item.session_key })}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowTopo}>
        <Badge label={down ? 'Desconectou' : 'Conectou'} tone={down ? 'warn' : 'ok'} />
        <View style={styles.rowTopoDir}>
          {/* Situacao de agora: um evento de queda de 3h atras pode ser de um
              cliente que ja voltou, e saber isso muda a urgencia. */}
          {item.is_online != null ? (
            <Text style={[styles.agora, { color: item.is_online ? colors.ok : colors.bad }]}>
              {item.is_online ? 'online agora' : 'offline agora'}
            </Text>
          ) : null}
          <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} />
        </View>
      </View>

      <Text style={styles.rowName} numberOfLines={1}>
        {nome}
      </Text>
      {item.alias && item.name !== item.alias ? (
        <Text style={styles.rowPpp} numberOfLines={1}>
          {item.name}
        </Text>
      ) : null}

      <View style={styles.tags}>
        {item.olt_name ? (
          <Text style={styles.tagOlt} numberOfLines={1}>
            {item.olt_name}
          </Text>
        ) : null}
        {item.ont_port ? (
          <Text style={styles.tagPorta} numberOfLines={1}>
            Porta {item.ont_port}
            {item.port_label ? ` · ${item.port_label}` : ''}
          </Text>
        ) : null}
        {local ? (
          <Text style={styles.tagLocal} numberOfLines={1}>
            {local}
          </Text>
        ) : null}
      </View>

      <View style={styles.rowRodape}>
        <Text style={styles.rowMeta}>{item.address || 'sem IP'}</Text>
        <Text style={styles.rowDate}>
          {formatDate(item.created_at)} ({relativeAgo(item.created_at)})
        </Text>
      </View>
    </Pressable>
  );
}

export default function HistoryScreen() {
  const navigation = useNavigation();
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
      <SearchBar value={query} onChangeText={setQuery} placeholder="Buscar nome, apelido, IP, MAC ou região da porta" />
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
          renderItem={({ item }) => <EventoRow item={item} navigation={navigation} />}
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
  // A linha deixou de ser uma faixa horizontal: agora e um cartao, porque passou
  // a carregar porta, OLT, regiao e situacao atual junto do evento.
  row: {
    backgroundColor: colors.surface2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    marginBottom: 8,
  },
  rowPressed: { backgroundColor: colors.surface3 },
  rowTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  rowTopoDir: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  agora: { fontSize: 10.5, fontWeight: '700' },
  rowName: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  rowPpp: { color: colors.inkFaint, fontSize: 11, fontFamily: 'monospace', marginTop: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  tagOlt: {
    color: colors.cyan,
    backgroundColor: colors.cyanBg,
    fontSize: 10.5,
    fontWeight: '650',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    maxWidth: 130,
  },
  tagPorta: {
    color: colors.violet,
    backgroundColor: colors.violetBg,
    fontSize: 10.5,
    fontWeight: '650',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    maxWidth: 190,
  },
  tagLocal: {
    color: colors.inkSoft,
    backgroundColor: colors.surface3,
    fontSize: 10.5,
    fontWeight: '650',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    maxWidth: 170,
  },
  rowRodape: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 9 },
  rowMeta: { color: colors.inkFaint, fontSize: 11.5, fontFamily: 'monospace' },
  rowDate: { color: colors.inkFaint, fontSize: 10.5 },
});
