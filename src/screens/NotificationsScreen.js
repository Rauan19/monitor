import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radius } from '../theme';
import { api } from '../api';
import { Badge, EmptyState, ErrorBanner, LoadingState, Pager, StaleBanner } from '../components/common';
import { formatDate, relativeAgo } from '../format';
import { withCache } from '../cache';

const PAGE_SIZE = 20;
const emptyMeta = { page: 1, pageSize: PAGE_SIZE, total: 0, pages: 1 };

const KINDS = {
  outage_port: { label: 'Porta', tone: 'warn' },
  outage_region: { label: 'Região', tone: 'warn' },
  ccr_down: { label: 'CCR fora do ar', tone: 'warn' },
  ccr_up: { label: 'CCR voltou', tone: 'ok' },
  test: { label: 'Teste', tone: 'accent' },
};

const MAX_NAMES = 6;

function NotificationRow({ row }) {
  const kind = KINDS[row.type] || { label: 'Alerta', tone: 'amber' };
  const pct = row.data?.percent != null ? Math.round(row.data.percent * 100) : null;
  const names = Array.isArray(row.data?.names) ? row.data.names : [];
  const extra = names.length - MAX_NAMES;
  return (
    <View style={styles.row}>
      <View style={styles.top}>
        <Badge label={kind.label} tone={kind.tone} />
        {pct != null && <Text style={styles.pct}>{pct}%</Text>}
      </View>
      <Text style={styles.title}>{row.title}</Text>
      <Text style={styles.body}>{row.body}</Text>
      {names.length > 0 && (
        <Text style={styles.names}>
          {names.slice(0, MAX_NAMES).join(', ')}
          {extra > 0 ? ` +${extra}` : ''}
        </Text>
      )}
      <Text style={styles.time} title={formatDate(row.created_at)}>
        {relativeAgo(row.created_at)}
      </Text>
    </View>
  );
}

export default function NotificationsScreen() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(emptyMeta);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [staleAt, setStaleAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: res, stale, savedAt } = await withCache(`notifications:${page}`, () =>
        api.notifications({ page, pageSize: PAGE_SIZE })
      );
      setStaleAt(stale ? savedAt : null);
      setRows(res.items || []);
      setMeta({ page: res.page || 1, pageSize: res.pageSize || PAGE_SIZE, total: res.total || 0, pages: res.pages || 1 });
      setError('');
    } catch (err) {
      setError(err.message || 'Falha ao carregar notificações');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load();
      const id = setInterval(() => {
        if (active) load();
      }, 15000);
      return () => {
        active = false;
        clearInterval(id);
      };
    }, [load])
  );

  return (
    <View style={styles.screen}>
      <ErrorBanner message={error} />
      <StaleBanner savedAt={staleAt} />
      {loading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <NotificationRow row={item} />}
          ListEmptyComponent={
            <EmptyState
              title="Nenhuma notificação ainda"
              hint="Quedas em massa por porta/OLT ou região e o CCR caindo/voltando aparecem aqui."
            />
          }
          ListFooterComponent={<Pager meta={meta} onChange={setPage} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 12 },
  row: {
    backgroundColor: colors.surface2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    marginBottom: 8,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  pct: { color: colors.amber, fontSize: 13, fontWeight: '800' },
  title: { color: colors.ink, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  body: { color: colors.inkSoft, fontSize: 12, marginBottom: 6 },
  names: { color: colors.inkFaint, fontSize: 11, fontStyle: 'italic', marginBottom: 6 },
  time: { color: colors.inkFaint, fontSize: 11 },
});
