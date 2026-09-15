import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export default function MiniBars({ data, height = 70, color = colors.cyan, labelEvery = 0 }) {
  if (!data.length) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>Sem dados ainda</Text>
      </View>
    );
  }
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <View style={[styles.row, { height }]}>
      {data.map((d, i) => {
        const pct = Math.max(2, Math.round((d.value / max) * 100));
        return (
          <View key={i} style={styles.col}>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { height: `${pct}%`, backgroundColor: color }]} />
            </View>
            {labelEvery > 0 && i % labelEvery === 0 ? <Text style={styles.label}>{d.label}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  col: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  barTrack: { width: '100%', height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 3, minHeight: 2 },
  label: { color: colors.inkFaint, fontSize: 8, marginTop: 2 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.inkFaint, fontSize: 12 },
});
