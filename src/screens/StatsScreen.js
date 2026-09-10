import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors, radius } from '../theme';
import { api } from '../api';
import { Badge, Card, ErrorBanner, Pager, SearchBar } from '../components/common';
import PrimaryButton from '../components/PrimaryButton';
import MiniBars from '../components/MiniBars';
import { formatBps } from '../format';

const emptyMeta = { page: 1, pageSize: 15, total: 0, pages: 1 };
const metaOf = (res) => ({ page: res.page || 1, pageSize: res.pageSize || 15, total: res.total || 0, pages: res.pages || 1 });

export default function StatsScreen() {
  const navigation = useNavigation();
  const [topConsumers, setTopConsumers] = useState([]);
  const [topLimit, setTopLimit] = useState(10);

  const [sla, setSla] = useState([]);
  const [slaMeta, setSlaMeta] = useState(emptyMeta);
  const [slaPage, setSlaPage] = useState(1);
  const [slaQuery, setSlaQuery] = useState('');

  const [slaByPort, setSlaByPort] = useState([]);
  const [hourlyLoad, setHourlyLoad] = useState([]);
  const [anomalies, setAnomalies] = useState([]);

  const [queueUsage, setQueueUsage] = useState([]);
  const [queueUsageMeta, setQueueUsageMeta] = useState(emptyMeta);
  const [queueUsagePage, setQueueUsagePage] = useState(1);

  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      const [tc, slaData, hourly, anomaliesRes, queueUsageRes, slaPortRes] = await Promise.all([
        api.topConsumers(24, topLimit),
        api.sla({ days: 30, q: slaQuery, page: slaPage, pageSize: 15 }),
        api.hourlyLoad(7, tzOffsetMinutes),
        api.anomalies(168),
        api.queueUsage({ hours: 24, page: queueUsagePage, pageSize: 10 }),
        api.slaByPort(30),
      ]);
      setTopConsumers(tc.items || []);
      setSla(slaData.items || []);
      setSlaMeta(metaOf(slaData));
      setHourlyLoad((hourly.items || []).map((h) => ({ value: h.avgDownBps + h.avgUpBps, label: String(h.hour).padStart(2, '0') })));
      setAnomalies(anomaliesRes.items || []);
      setQueueUsage(queueUsageRes.items || []);
      setQueueUsageMeta(metaOf(queueUsageRes));
      setSlaByPort(slaPortRes.items || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Falha ao carregar estatísticas');
    }
  }, [topLimit, slaQuery, slaPage, queueUsagePage]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load();
      const id = setInterval(() => {
        if (active) load();
      }, 20000);
      return () => {
        active = false;
        clearInterval(id);
      };
    }, [load])
  );

  async function openReport() {
    const url = await api.reportUrl(30);
    Linking.openURL(url);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 12 }}>
      <ErrorBanner message={error} />

      <Card title="Relatório mensal">
        <Text style={styles.muted}>Resumo de uptime, consumo e quedas dos últimos 30 dias, pronto pra imprimir ou salvar em PDF.</Text>
        <PrimaryButton label="Abrir relatório" onPress={openReport} />
      </Card>

      {anomalies.length > 0 && (
        <Card title="Uso fora do padrão agora" count={anomalies.length}>
          {anomalies.map((a, i) => (
            <View key={i} style={styles.listRowCol}>
              <Text style={styles.listName}>{a.name}</Text>
              <Text style={styles.listMeta}>
                agora {formatBps(a.currentDownBps)}↓ / {formatBps(a.currentUpBps)}↑ · média {formatBps(a.avgDownBps)}↓ / {formatBps(a.avgUpBps)}↑
              </Text>
            </View>
          ))}
        </Card>
      )}

      <Card title="Horário de pico (7 dias)">
        <MiniBars data={hourlyLoad} color={colors.accent} labelEvery={3} height={90} />
      </Card>

      <Card title="Uptime médio por porta/OLT">
        {slaByPort.map((p, i) => (
          <View key={i} style={styles.listRow}>
            <Text style={styles.listName}>{p.port === 'sem-porta' ? 'Sem porta' : `Porta ${p.port}`}</Text>
            <Text style={styles.listMeta}>{p.avgUptimePct}% · {p.clients} clientes</Text>
          </View>
        ))}
      </Card>

      {queueUsage.length > 0 && (
        <Card title="Fila x consumo real" count={queueUsageMeta.total}>
          {queueUsage.map((q, i) => (
            <View key={i} style={styles.listRowCol}>
              <Text style={styles.listName}>{q.client}</Text>
              <Text style={styles.listMeta}>
                limite {formatBps(q.downloadLimitBps)}↓ · uso {formatBps(Math.round(q.avgDownBps || 0))}↓ ({q.downloadUsagePct ?? '—'}%)
              </Text>
            </View>
          ))}
          <Pager meta={queueUsageMeta} onChange={setQueueUsagePage} />
        </Card>
      )}

      <Card title="Top consumo de banda (24h, média)">
        <View style={styles.chipRow}>
          {[10, 20, 50].map((n) => (
            <Pressable key={n} onPress={() => setTopLimit(n)} style={[styles.chip, topLimit === n && styles.chipActive]}>
              <Text style={[styles.chipText, topLimit === n && styles.chipTextActive]}>Top {n}</Text>
            </Pressable>
          ))}
        </View>
        {topConsumers.map((c, i) => (
          <View key={i} style={styles.listRowCol}>
            <Text style={styles.listName}>{c.name}</Text>
            <Text style={styles.listMeta}>
              {formatBps(Math.round(c.avgDownBps || 0))}↓ / {formatBps(Math.round(c.avgUpBps || 0))}↑
            </Text>
          </View>
        ))}
      </Card>

      <Card title="Uptime por cliente (30 dias)" count={slaMeta.total}>
        <SearchBar value={slaQuery} onChangeText={setSlaQuery} placeholder="Buscar cliente" />
        {sla.map((s) => (
          <Pressable key={s.sessionKey} style={styles.listRow} onPress={() => navigation.navigate('ClientDetail', { sessionKey: s.sessionKey })}>
            <Text style={styles.listName}>{s.name}</Text>
            <Badge label={`${s.uptimePct}%`} tone={s.uptimePct < 95 ? 'warn' : 'ok'} />
          </Pressable>
        ))}
        <Pager meta={slaMeta} onChange={setSlaPage} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  muted: { color: colors.inkFaint, fontSize: 12, marginBottom: 4 },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 8 },
  listRowCol: { paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 2 },
  listName: { color: colors.ink, fontSize: 13, fontWeight: '650' },
  listMeta: { color: colors.inkFaint, fontSize: 11, fontFamily: 'monospace' },
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.inkFaint, fontSize: 11, fontWeight: '650' },
  chipTextActive: { color: '#061024' },
});
