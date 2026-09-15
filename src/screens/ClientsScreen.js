import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radius } from '../theme';
import { api } from '../api';
import ClientsListScreen from './ClientsListScreen';
import { withCache } from '../cache';

const MODES = [
  { id: 'all', label: 'Todos' },
  { id: 'online', label: 'Online' },
  { id: 'disconnected', label: 'Offline' },
];

export default function ClientsScreen() {
  const [mode, setMode] = useState('all');
  const [dashboard, setDashboard] = useState(null);
  const [connected, setConnected] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await withCache('dashboard', async () => {
        const [dash, status] = await Promise.all([api.dashboard(), api.status()]);
        return { dash, status };
      });
      setDashboard(data.dash);
      setConnected(Boolean(data.status?.connected));
    } catch {
      // segue com o valor anterior
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load();
      const id = setInterval(() => {
        if (active) load();
      }, 5000);
      return () => {
        active = false;
        clearInterval(id);
      };
    }, [load])
  );

  return (
    <View style={styles.screen}>
      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, { color: colors.ok }]}>{dashboard?.online ?? 0}</Text>
          <Text style={styles.metricLabel}>Online</Text>
        </View>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, { color: colors.bad }]}>{dashboard?.disconnected24h ?? 0}</Text>
          <Text style={styles.metricLabel}>Offline 24h</Text>
        </View>
        <View style={styles.metric}>
          <Text style={[styles.metricValue, { color: colors.cyan }]}>{dashboard?.connected24h ?? 0}</Text>
          <Text style={styles.metricLabel}>Voltou 24h</Text>
        </View>
        <View style={styles.metric}>
          <View style={[styles.dot, { backgroundColor: connected ? colors.ok : colors.bad }]} />
          <Text style={styles.metricLabel}>{connected ? 'API conectada' : 'API offline'}</Text>
        </View>
      </View>

      <View style={styles.segmented}>
        {MODES.map((m) => (
          <Pressable key={m.id} onPress={() => setMode(m.id)} style={[styles.segment, mode === m.id && styles.segmentActive]}>
            <Text style={[styles.segmentText, mode === m.id && styles.segmentTextActive]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>

      <ClientsListScreen mode={mode} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  metrics: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 10, gap: 8 },
  metric: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingVertical: 8 },
  metricValue: { fontSize: 18, fontWeight: '800' },
  metricLabel: { color: colors.inkFaint, fontSize: 9, fontWeight: '650', textTransform: 'uppercase', marginTop: 2, textAlign: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginBottom: 3 },
  segmented: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  segmentText: { color: colors.inkFaint, fontSize: 12, fontWeight: '700' },
  segmentTextActive: { color: '#061024' },
});
