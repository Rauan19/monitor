import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radius } from '../theme';
import { api } from '../api';
import { Card, ErrorBanner, KeyValue, Pager, SearchBar } from '../components/common';
import MiniBars from '../components/MiniBars';
import { formatBytes, formatDate } from '../format';

const emptyMeta = { page: 1, pageSize: 10, total: 0, pages: 1 };
const metaOf = (res) => ({ page: res.page || 1, pageSize: res.pageSize || 10, total: res.total || 0, pages: res.pages || 1 });

export default function SystemScreen() {
  const [resource, setResource] = useState(null);
  const [health, setHealth] = useState({});
  const [history, setHistory] = useState([]);

  const [interfaces, setInterfaces] = useState([]);
  const [interfacesMeta, setInterfacesMeta] = useState(emptyMeta);
  const [interfacesPage, setInterfacesPage] = useState(1);

  const [dhcp, setDhcp] = useState([]);
  const [dhcpMeta, setDhcpMeta] = useState(emptyMeta);
  const [dhcpPage, setDhcpPage] = useState(1);
  const [dhcpQuery, setDhcpQuery] = useState('');

  const [queues, setQueues] = useState([]);
  const [queuesMeta, setQueuesMeta] = useState(emptyMeta);
  const [queuesPage, setQueuesPage] = useState(1);

  const [wireless, setWireless] = useState([]);

  const [logs, setLogs] = useState([]);
  const [logsMeta, setLogsMeta] = useState(emptyMeta);
  const [logsPage, setLogsPage] = useState(1);
  const [logTopics, setLogTopics] = useState([]);
  const [logTopic, setLogTopic] = useState('');

  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [sys, hist, ifaces, dh, q, wl, lg, topics] = await Promise.all([
        api.system(),
        api.systemHistory(24),
        api.interfaces({ page: interfacesPage, pageSize: 10 }),
        api.dhcpLeases({ q: dhcpQuery, page: dhcpPage, pageSize: 10 }),
        api.queues({ page: queuesPage, pageSize: 10 }),
        api.wireless({ page: 1, pageSize: 10 }),
        api.logs({ topic: logTopic, hours: 168, page: logsPage, pageSize: 12 }),
        api.logTopics(),
      ]);
      setResource(sys.resource);
      setHealth(sys.health || {});
      setHistory(hist.items || []);
      setInterfaces(ifaces.items || []);
      setInterfacesMeta(metaOf(ifaces));
      setDhcp(dh.items || []);
      setDhcpMeta(metaOf(dh));
      setQueues(q.items || []);
      setQueuesMeta(metaOf(q));
      setWireless(wl.items || []);
      setLogs(lg.items || []);
      setLogsMeta(metaOf(lg));
      setLogTopics(topics.items || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Falha ao carregar dados do sistema');
    }
  }, [interfacesPage, dhcpPage, dhcpQuery, queuesPage, logsPage, logTopic]);

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

  const cpuBars = history.map((h) => ({ value: h.cpu_load ?? 0 }));
  const memBars = history.map((h) => ({
    value: h.total_memory != null && h.free_memory != null ? h.total_memory - h.free_memory : 0,
  }));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 12 }}>
      <ErrorBanner message={error} />

      <Card title="Recursos do CCR">
        {resource ? (
          <>
            <KeyValue label="CPU" value={`${resource.cpuLoad ?? '—'}%`} />
            <KeyValue label="Memória livre" value={formatBytes(resource.freeMemory)} />
            <KeyValue label="Memória total" value={formatBytes(resource.totalMemory)} />
            <KeyValue label="Uptime" value={resource.uptime} />
            <KeyValue label="Versão" value={resource.version} />
            <KeyValue label="Placa" value={resource.boardName} />
            {health.voltage != null && <KeyValue label="Voltagem" value={`${health.voltage}V`} />}
            {health.temperature != null && <KeyValue label="Temperatura" value={`${health.temperature}°C`} />}
          </>
        ) : (
          <Text style={styles.muted}>Carregando…</Text>
        )}
      </Card>

      <Card title="CPU (24h)">
        <MiniBars data={cpuBars} color={colors.cyan} />
      </Card>

      <Card title="Memória usada (24h)">
        <MiniBars data={memBars} color={colors.violet} />
      </Card>

      <Card title="Interfaces" count={interfacesMeta.total}>
        {interfaces.map((r) => (
          <View key={r.name} style={styles.listRow}>
            <Text style={styles.listName} numberOfLines={1}>
              {r.name}
            </Text>
            <Text style={[styles.listBadge, r.running ? styles.ok : styles.warn]}>
              {r.disabled ? 'Desligada' : r.running ? 'Ativa' : 'Inativa'}
            </Text>
          </View>
        ))}
        <Pager meta={interfacesMeta} onChange={setInterfacesPage} />
      </Card>

      {wireless.length > 0 && (
        <Card title="Clientes wireless" count={wireless.length}>
          {wireless.map((r, i) => (
            <View key={i} style={styles.listRow}>
              <Text style={styles.listName}>{r.interface}</Text>
              <Text style={styles.listMeta}>{r.signal}</Text>
            </View>
          ))}
        </Card>
      )}

      <Card title="Leases DHCP" count={dhcpMeta.total}>
        <SearchBar value={dhcpQuery} onChangeText={setDhcpQuery} placeholder="Buscar IP, MAC ou host" />
        {dhcp.map((r, i) => (
          <View key={i} style={styles.listRow}>
            <Text style={styles.listName}>{r.address}</Text>
            <Text style={styles.listMeta}>{r.hostname || '—'}</Text>
          </View>
        ))}
        <Pager meta={dhcpMeta} onChange={setDhcpPage} />
      </Card>

      {queues.length > 0 && (
        <Card title="Filas (limite contratado)" count={queuesMeta.total}>
          {queues.map((r, i) => (
            <View key={i} style={styles.listRow}>
              <Text style={styles.listName} numberOfLines={1}>
                {r.name}
              </Text>
              <Text style={styles.listMeta}>{r.rate || '—'}</Text>
            </View>
          ))}
          <Pager meta={queuesMeta} onChange={setQueuesPage} />
        </Card>
      )}

      <Card title="Log do CCR" count={logsMeta.total}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          <Pressable onPress={() => setLogTopic('')} style={[styles.chip, !logTopic && styles.chipActive]}>
            <Text style={[styles.chipText, !logTopic && styles.chipTextActive]}>Todos</Text>
          </Pressable>
          {logTopics.map((t) => (
            <Pressable key={t} onPress={() => setLogTopic(t)} style={[styles.chip, logTopic === t && styles.chipActive]}>
              <Text style={[styles.chipText, logTopic === t && styles.chipTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {logs.map((r) => (
          <View key={r.id} style={styles.logRow}>
            <Text style={styles.logTime}>{formatDate(r.fetched_at)}</Text>
            <Text style={styles.logMsg}>{r.message}</Text>
          </View>
        ))}
        <Pager meta={logsMeta} onChange={setLogsPage} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  muted: { color: colors.inkFaint, fontSize: 13 },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 8 },
  listName: { color: colors.ink, fontSize: 13, fontWeight: '650', flexShrink: 1 },
  listMeta: { color: colors.inkFaint, fontSize: 12, fontFamily: 'monospace' },
  listBadge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  ok: { color: colors.ok, backgroundColor: colors.okBg },
  warn: { color: '#fff', backgroundColor: colors.badSolid },
  chipRow: { marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, marginRight: 6 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.inkFaint, fontSize: 11, fontWeight: '650' },
  chipTextActive: { color: '#061024' },
  logRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line },
  logTime: { color: colors.inkFaint, fontSize: 10, fontFamily: 'monospace' },
  logMsg: { color: colors.inkSoft, fontSize: 12, marginTop: 2 },
});
