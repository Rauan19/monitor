import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';
import { Badge } from './common';
import { formatBps, relativeAgo, locationSummary } from '../format';

export default function ClientRow({ row, mode, onPress, oltsPorId }) {
  const online = mode === 'online' ? true : Number(row.is_online) === 1;
  const loc = locationSummary(row);
  const displayName = row.alias || row.name || '—';
  // A lista recebe olt_id do servidor, nao o nome. O nome sai do cadastro de
  // OLTs, que a tela busca uma vez e passa aqui como mapa id -> nome.
  const oltNome = row.olt_id ? oltsPorId?.[Number(row.olt_id)] : null;

  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed, !online && styles.rowOff]} onPress={onPress}>
      <View style={styles.top}>
        <Badge label={online ? 'Online' : 'Offline'} tone={online ? 'ok' : 'warn'} />
        <Text style={styles.name} numberOfLines={1}>
          {displayName}
        </Text>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.mono}>{row.address || 'sem IP'}</Text>
        {oltNome ? (
          <Text style={styles.tagOlt} numberOfLines={1}>
            {oltNome}
          </Text>
        ) : null}
        {/* A porta e nomeada com a regiao que ela atende, entao o nome diz mais
            que o numero: mostra "Porta 3 - Centro" quando tem nome. */}
        {row.ont_port ? (
          <Text style={styles.tag} numberOfLines={1}>
            Porta {row.ont_port}
            {row.port_label ? ` · ${row.port_label}` : ''}
          </Text>
        ) : null}
        {loc ? (
          <Text style={styles.tag} numberOfLines={1}>
            {loc}
          </Text>
        ) : null}
      </View>
      <View style={styles.bottom}>
        {online && (row.downBps != null || row.upBps != null) ? (
          <Text style={styles.speed}>
            ↓ {formatBps(row.downBps || 0)}  ↑ {formatBps(row.upBps || 0)}
          </Text>
        ) : (
          <View />
        )}
        <Text style={styles.time}>
          {online ? row.uptime || relativeAgo(row.last_seen_at) : relativeAgo(row.disconnected_at)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    marginBottom: 8,
  },
  rowPressed: { backgroundColor: colors.surface3 },
  rowOff: { borderColor: 'rgba(220,38,38,0.2)' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  name: { color: colors.ink, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  mono: { color: colors.inkFaint, fontSize: 12, fontFamily: 'monospace' },
  tag: {
    color: colors.violet,
    backgroundColor: colors.violetBg,
    fontSize: 11,
    fontWeight: '650',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    maxWidth: 210,
  },
  tagOlt: {
    color: colors.cyan,
    backgroundColor: colors.cyanBg,
    fontSize: 11,
    fontWeight: '650',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    maxWidth: 140,
  },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  speed: { color: colors.cyan, fontSize: 12, fontFamily: 'monospace' },
  time: { color: colors.inkFaint, fontSize: 12 },
});
