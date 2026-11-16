import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radius } from '../theme';
import { api } from '../api';
import { Card, ErrorBanner, KeyValue, Pager, SearchBar } from '../components/common';
import MiniBars from '../components/MiniBars';
import { formatBytes, formatDate } from '../format';

const FALHAS_PRA_AVISAR = 2;
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
  // `dhcpQuery` e o que esta escrito na caixa; `dhcpBusca` e o que vai pra rede.
  // Eram a mesma coisa, e estava nas dependencias do load inteiro: cada tecla
  // refazia as oito requisicoes, interfaces e log do CCR incluidos. Digitar
  // "joao" eram 32 chamadas ao CCR pra buscar um lease.
  const [dhcpQuery, setDhcpQuery] = useState('');
  const [dhcpBusca, setDhcpBusca] = useState('');

  const [queues, setQueues] = useState([]);
  const [queuesMeta, setQueuesMeta] = useState(emptyMeta);
  const [queuesPage, setQueuesPage] = useState(1);

  const [wireless, setWireless] = useState([]);

  const [logs, setLogs] = useState([]);
  const [logsMeta, setLogsMeta] = useState(emptyMeta);
  const [logsPage, setLogsPage] = useState(1);
  const [logTopics, setLogTopics] = useState([]);
  const [logTopic, setLogTopic] = useState('');

  // Um erro por ciclo, nao um compartilhado: o rapido roda a cada 15s e o
  // pesado a cada 90s, entao um setError('') do rapido apagaria a falha do
  // pesado antes de alguem ler, e a parte que quebrou era justamente a que
  // demora pra tentar de novo.
  const [erroRapido, setErroRapido] = useState('');
  const [erroPesado, setErroPesado] = useState('');
  const falhasRapido = useRef(0);
  const falhasPesado = useRef(0);
  const reqDhcpId = useRef(0);

  // 350ms depois da ultima tecla, como na lista de clientes.
  useEffect(() => {
    const t = setTimeout(() => setDhcpBusca(dhcpQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [dhcpQuery]);

  useEffect(() => {
    setDhcpPage(1);
  }, [dhcpBusca]);

  // Busca de DHCP isolada: pesquisar um lease nao precisa recarregar
  // interfaces, filas, wireless e logs do CCR inteiros!
  const loadDhcp = useCallback(async () => {
    const idAtual = ++reqDhcpId.current;
    try {
      const dh = await api.dhcpLeases({ q: dhcpBusca, page: dhcpPage, pageSize: 10 });
      if (idAtual !== reqDhcpId.current) return;
      setDhcp(dh.items || []);
      setDhcpMeta(metaOf(dh));
      setErroPesado('');
    } catch (err) {
      if (idAtual !== reqDhcpId.current) return;
      falhasPesado.current += 1;
      if (!err.deRede || falhasPesado.current >= FALHAS_PRA_AVISAR) {
        setErroPesado(err.message || 'Falha ao buscar leases DHCP');
      }
    }
  }, [dhcpBusca, dhcpPage]);

  useEffect(() => {
    loadDhcp();
  }, [loadDhcp]);

  // CPU, memoria, voltagem e temperatura mudam a cada segundo: vale olhar de
  // perto. Sao duas consultas ao historico que o servidor ja tem gravado.
  const loadRapido = useCallback(async () => {
    try {
      const [sys, hist] = await Promise.all([api.system(), api.systemHistory(24)]);
      setResource(sys.resource);
      setHealth(sys.health || {});
      setHistory(hist.items || []);
      falhasRapido.current = 0;
      setErroRapido('');
    } catch (err) {
      falhasRapido.current += 1;
      if (!err.deRede || falhasRapido.current >= FALHAS_PRA_AVISAR) {
        setErroRapido(err.message || 'Falha ao carregar os recursos do CCR');
      }
    }
  }, []);

  // Estas cinco vao ao CCR/banco buscar listas grandes. Passam a cada 90s.
  const loadPesado = useCallback(async () => {
    try {
      const [ifaces, q, wl, lg, topics] = await Promise.all([
        api.interfaces({ page: interfacesPage, pageSize: 10 }),
        api.queues({ page: queuesPage, pageSize: 10 }),
        api.wireless({ page: 1, pageSize: 10 }),
        api.logs({ topic: logTopic, hours: 168, page: logsPage, pageSize: 12 }),
        api.logTopics(),
      ]);
      setInterfaces(ifaces.items || []);
      setInterfacesMeta(metaOf(ifaces));
      setQueues(q.items || []);
      setQueuesMeta(metaOf(q));
      setWireless(wl.items || []);
      setLogs(lg.items || []);
      setLogsMeta(metaOf(lg));
      setLogTopics(topics.items || []);
      falhasPesado.current = 0;
      setErroPesado('');
    } catch (err) {
      falhasPesado.current += 1;
      if (!err.deRede || falhasPesado.current >= FALHAS_PRA_AVISAR) {
        setErroPesado(err.message || 'Falha ao carregar interfaces, DHCP, filas e log');
      }
    }
  }, [interfacesPage, queuesPage, logsPage, logTopic]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadRapido();
      loadPesado();
      const rapido = setInterval(() => {
        if (active) loadRapido();
      }, 15000);
      const pesado = setInterval(() => {
        if (active) loadPesado();
      }, 90000);
      return () => {
        active = false;
        clearInterval(rapido);
        clearInterval(pesado);
      };
    }, [loadRapido, loadPesado])
  );

  const cpuBars = history.map((h) => ({ value: h.cpu_load ?? 0 }));
  const memBars = history.map((h) => ({
    value: h.total_memory != null && h.free_memory != null ? h.total_memory - h.free_memory : 0,
  }));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 12 }}>
      <ErrorBanner message={erroRapido || erroPesado} />

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
