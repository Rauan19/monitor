import { useCallback, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radius } from '../theme';
import { api } from '../api';
import { Badge, EmptyState, ErrorBanner, LoadingState, Pager, StaleBanner } from '../components/common';
import { Ionicons } from '@expo/vector-icons';
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

/**
 * Tira travessao/meia-risca do texto do alerta. Os alertas gerados hoje ja vem
 * sem, mas os que estao gravados no banco de antes dessa mudanca continuam com
 * " \u2014 " no meio do titulo. Normalizar na exibicao arruma o historico todo
 * sem precisar reescrever dado no servidor.
 */
function semTravessao(texto) {
  if (!texto) return texto;
  return String(texto)
    .replace(/\s+[\u2014\u2013\u2212]\s+/g, ': ')
    .replace(/[\u2014\u2013\u2212]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function NotificationRow({ row, onPress }) {
  const kind = KINDS[row.type] || { label: 'Alerta', tone: 'amber' };
  const pct = row.data?.percent != null ? Math.round(row.data.percent * 100) : null;
  const names = Array.isArray(row.data?.names) ? row.data.names : [];
  const extra = names.length - MAX_NAMES;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.top}>
        <Badge label={kind.label} tone={kind.tone} />
        <View style={styles.topRight}>
          {pct != null && <Text style={styles.pct}>{pct}%</Text>}
          <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} />
        </View>
      </View>
      <Text style={styles.title}>{semTravessao(row.title)}</Text>
      <Text style={styles.body}>{semTravessao(row.body)}</Text>
      {names.length > 0 && (
        <Text style={styles.names}>
          {names.slice(0, MAX_NAMES).join(', ')}
          {extra > 0 ? ` +${extra}` : ''}
        </Text>
      )}
      <Text style={styles.time}>{relativeAgo(row.created_at)}</Text>
    </Pressable>
  );
}

function Linha({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <View style={styles.dl}>
      <Text style={styles.dt}>{label}</Text>
      <Text style={styles.dd}>{value}</Text>
    </View>
  );
}

/** Ficha completa do alerta: tudo que veio no payload, sem truncar nomes. */
function DetalheAlerta({ row, onClose }) {
  if (!row) return null;
  const kind = KINDS[row.type] || { label: 'Alerta', tone: 'amber' };
  const d = row.data || {};
  const pct = d.percent != null ? `${Math.round(d.percent * 100)}%` : null;
  const names = Array.isArray(d.names) ? d.names : [];

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalShell}>
        <Pressable style={styles.modalFundo} onPress={onClose} />
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <Badge label={kind.label} tone={kind.tone} />
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={colors.inkSoft} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.modalTitulo}>{semTravessao(row.title)}</Text>
            <Text style={styles.modalTexto}>{semTravessao(row.body)}</Text>

            <View style={styles.divisor} />

            <Linha label="Quando" value={formatDate(row.created_at)} />
            <Linha label="Há" value={relativeAgo(row.created_at)} />

            {d.oltName ? <Linha label="OLT" value={d.oltName} /> : null}
            {d.port != null ? (
              <Linha label="Porta" value={d.label ? `${d.port} (${d.label})` : String(d.port)} />
            ) : null}
            {d.region ? <Linha label="Região" value={d.region} /> : null}
            {d.count != null && d.total != null ? (
              <Linha label="Caíram" value={`${d.count} de ${d.total} clientes`} />
            ) : null}
            {pct ? <Linha label="Proporção" value={pct} /> : null}
            {d.host ? <Linha label="Host do CCR" value={d.host} /> : null}
            {d.onlineCount != null ? <Linha label="Online ao voltar" value={String(d.onlineCount)} /> : null}
            {d.error ? <Linha label="Erro" value={d.error} /> : null}

            {names.length > 0 ? (
              <>
                <View style={styles.divisor} />
                <Text style={styles.dt}>Clientes afetados ({names.length})</Text>
                <View style={styles.nomes}>
                  {names.map((n) => (
                    <View key={n} style={styles.chip}>
                      <Text style={styles.chipText}>{n}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function NotificationsScreen() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(emptyMeta);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [staleAt, setStaleAt] = useState(null);
  const [aberto, setAberto] = useState(null);

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
      // O 3o argumento roda com o que ja esta guardado, antes da rede
      // responder: a tela aparece preenchida na hora.
      const { data: res, stale, savedAt } = await withCache(
        `notifications:${page}`,
        () => api.notifications({ page, pageSize: PAGE_SIZE }),
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
          renderItem={({ item }) => <NotificationRow row={item} onPress={() => setAberto(item)} />}
          ListEmptyComponent={
            <EmptyState
              title="Nenhuma notificação ainda"
              hint="Quedas em massa por porta/OLT ou região e o CCR caindo/voltando aparecem aqui."
            />
          }
          ListFooterComponent={<Pager meta={meta} onChange={setPage} />}
        />
      )}
      <DetalheAlerta row={aberto} onClose={() => setAberto(null)} />
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
  rowPressed: { backgroundColor: colors.surface3 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pct: { color: colors.amber, fontSize: 13, fontWeight: '800' },
  title: { color: colors.ink, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  body: { color: colors.inkSoft, fontSize: 12, marginBottom: 6 },
  names: { color: colors.inkFaint, fontSize: 11, fontStyle: 'italic', marginBottom: 6 },
  time: { color: colors.inkFaint, fontSize: 11 },

  modalShell: { flex: 1, justifyContent: 'flex-end' },
  modalFundo: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: colors.line,
    maxHeight: '85%',
    paddingTop: 14,
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  modalBody: { paddingHorizontal: 16, paddingBottom: 28 },
  modalTitulo: { color: colors.ink, fontSize: 16, fontWeight: '800', marginBottom: 6 },
  modalTexto: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
  divisor: { height: 1, backgroundColor: colors.line, marginVertical: 14 },
  dl: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  dt: { color: colors.inkFaint, fontSize: 11, fontWeight: '650', textTransform: 'uppercase' },
  dd: { color: colors.ink, fontSize: 13, fontWeight: '650', flex: 1, textAlign: 'right' },
  nomes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: { color: colors.inkSoft, fontSize: 11.5, fontWeight: '600' },
});
