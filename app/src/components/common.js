import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius } from '../theme';
import { relativeAgo } from '../format';

export function Badge({ label, tone = 'ok' }) {
  const map = {
    ok: { bg: colors.okBg, ink: colors.ok },
    warn: { bg: colors.badBg, ink: '#fff', solid: true },
    amber: { bg: colors.amberBg, ink: colors.amber },
    accent: { bg: colors.accentBg, ink: colors.accent },
  };
  const t = map[tone] || map.ok;
  return (
    <View style={[styles.badge, { backgroundColor: t.solid ? colors.badSolid : t.bg }]}>
      <Text style={[styles.badgeText, { color: t.solid ? '#fff' : t.ink }]}>{label}</Text>
    </View>
  );
}

export function Card({ title, count, children, style }) {
  return (
    <View style={[styles.card, style]}>
      {title != null && (
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>{title}</Text>
          {count != null && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{count}</Text>
            </View>
          )}
        </View>
      )}
      {children}
    </View>
  );
}

export function SearchBar({ value, onChangeText, placeholder = 'Buscar' }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.inkFaint}
      style={styles.search}
      autoCapitalize="none"
      autoCorrect={false}
    />
  );
}

export function EmptyState({ title, hint }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint && <Text style={styles.emptyHint}>{hint}</Text>}
    </View>
  );
}

export function LoadingState() {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerTitle}>Erro</Text>
      <Text style={styles.bannerText}>{message}</Text>
    </View>
  );
}

// Abaixo disto a tela nao fala nada. As telas se atualizam de 5 em 5s ou de 15
// em 15s, e o cache.js so marca desatualizado depois de duas falhas seguidas,
// entao dado de menos de um minuto e, pra qualquer efeito pratico, o dado de
// agora. Avisar sobre ele e ruido.
const IDADE_PRA_MENCIONAR_MS = 60 * 1000;

// Acima disto deixa de ser menção e passa a ser aviso: cinco minutos sem
// conseguir atualizar e tempo suficiente pra tela estar mentindo.
const IDADE_PRA_ALERTAR_MS = 5 * 60 * 1000;

/**
 * Diz de quando e o dado que a tela esta mostrando, quando ele nao e de agora.
 *
 * O texto era "Sem conexao com o servidor", em laranja, com titulo em negrito.
 * Tres problemas nisso:
 *
 * 1. Era afirmacao errada. O que aconteceu foi o celular nao conseguir falar
 *    com o servidor em duas tentativas seguidas: Wi-Fi trocando pra dados,
 *    elevador, sinal fraco. O servidor costuma estar no ar, e o CCR nem entra
 *    nessa conta, que e outro indicador.
 * 2. Era desproporcional. Aparecia com dado de dez segundos, com a mesma cara
 *    de alarme que mereceria dado de meia hora.
 * 3. Por isso virou alarme falso, e alarme falso treina quem olha a ignorar.
 *    Num monitor isso e o pior resultado possivel: quando a queda for real, o
 *    aviso ja nao significa nada.
 *
 * Agora e proporcional. Abaixo de um minuto, silencio. De um a cinco minutos,
 * uma linha discreta dizendo so a idade do dado, que e o fato. Acima de cinco
 * minutos, aviso de verdade, porque ai a tela realmente pode estar mentindo.
 */
export function StaleBanner({ savedAt }) {
  if (!savedAt) return null;

  const idade = Date.now() - new Date(savedAt).getTime();
  if (!(idade >= IDADE_PRA_MENCIONAR_MS)) return null; // cobre NaN tambem

  const alertar = idade >= IDADE_PRA_ALERTAR_MS;
  const quando = relativeAgo(new Date(savedAt).toISOString());

  if (!alertar) {
    return (
      <View style={styles.staleQuieto}>
        <Text style={styles.staleQuietoTexto}>Atualizado {quando}</Text>
      </View>
    );
  }

  return (
    <View style={styles.staleBanner}>
      <Text style={styles.staleTitle}>Nao foi possivel atualizar</Text>
      <Text style={styles.staleText}>Mostrando dados de {quando}</Text>
    </View>
  );
}

export function Pager({ meta, onChange }) {
  if (!meta || meta.total <= meta.pageSize) return null;
  return (
    <View style={styles.pager}>
      <Pressable
        disabled={meta.page <= 1}
        onPress={() => onChange(meta.page - 1)}
        style={[styles.pagerBtn, meta.page <= 1 && styles.pagerBtnDisabled]}
      >
        <Text style={styles.pagerBtnText}>‹</Text>
      </Pressable>
      <Text style={styles.pagerLabel}>
        {meta.page} / {meta.pages} · {meta.total} itens
      </Text>
      <Pressable
        disabled={meta.page >= meta.pages}
        onPress={() => onChange(meta.page + 1)}
        style={[styles.pagerBtn, meta.page >= meta.pages && styles.pagerBtnDisabled]}
      >
        <Text style={styles.pagerBtnText}>›</Text>
      </Pressable>
    </View>
  );
}

export function KeyValue({ label, value }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue}>{value ?? '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  card: {
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 10,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardTitle: { color: colors.inkSoft, fontSize: 13, fontWeight: '700' },
  countBadge: { backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  countBadgeText: { color: colors.inkFaint, fontSize: 11, fontWeight: '700' },
  search: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: colors.ink,
    fontSize: 14,
    marginBottom: 8,
  },
  empty: { padding: 32, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.inkSoft, fontWeight: '700', fontSize: 14 },
  emptyHint: { color: colors.inkFaint, fontSize: 12, marginTop: 4, textAlign: 'center' },
  banner: {
    backgroundColor: colors.badBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.22)',
    padding: 10,
    marginBottom: 10,
  },
  bannerTitle: { color: '#fecaca', fontWeight: '700', fontSize: 12 },
  bannerText: { color: '#f3b4b4', fontSize: 12, marginTop: 2 },
  staleBanner: {
    backgroundColor: colors.amberBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(251,146,60,0.22)',
    padding: 10,
    marginBottom: 10,
  },
  staleTitle: { color: colors.amber, fontWeight: '700', fontSize: 12 },
  staleText: { color: colors.inkSoft, fontSize: 12, marginTop: 2 },
  // Versao discreta, de um a cinco minutos: sem cor de alarme, sem negrito,
  // sem borda. E uma legenda, nao um aviso.
  staleQuieto: { paddingVertical: 4, marginBottom: 6 },
  staleQuietoTexto: { color: colors.inkFaint, fontSize: 11 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 10 },
  pagerBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagerBtnDisabled: { opacity: 0.35 },
  pagerBtnText: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  pagerLabel: { color: colors.inkFaint, fontSize: 12 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line },
  kvLabel: { color: colors.inkFaint, fontSize: 12 },
  kvValue: { color: colors.ink, fontSize: 13, fontWeight: '600' },
});
