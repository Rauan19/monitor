import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { api } from '../api';
import { withCache } from '../cache';
import { Badge, EmptyState, ErrorBanner, LoadingState, StaleBanner } from '../components/common';
import PrimaryButton from '../components/PrimaryButton';
import { formatDate, relativeAgo } from '../format';

function LinkCard({ link, onRemover }) {
  return (
    <View style={[styles.card, !link.up && styles.cardCaido]}>
      <View style={styles.cardTopo}>
        <Badge label={link.up ? 'De pé' : 'Caído'} tone={link.up ? 'ok' : 'warn'} />
        <Pressable onPress={() => onRemover(link)} hitSlop={10}>
          <Ionicons name="trash-outline" size={17} color={colors.inkFaint} />
        </Pressable>
      </View>
      <Text style={styles.nome} numberOfLines={1}>
        {link.label || link.name}
      </Text>
      {link.label ? <Text style={styles.iface}>{link.name}</Text> : null}
      <View style={styles.rodape}>
        <Text style={styles.meta}>
          {link.since
            ? `${link.up ? 'De pé' : 'Caído'} há ${relativeAgo(link.since)}`
            : 'Sem mudança registrada'}
        </Text>
        {link.downs24h > 0 ? (
          <Text style={styles.quedas}>
            {link.downs24h} {link.downs24h === 1 ? 'queda' : 'quedas'} em 24h
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function EventoLinha({ ev }) {
  const tipo =
    ev.event_type === 'down'
      ? { texto: 'Caiu', cor: colors.bad }
      : ev.event_type === 'up'
        ? { texto: 'Voltou', cor: colors.ok }
        : { texto: 'Piscou', cor: colors.amber };
  return (
    <View style={styles.evento}>
      <View style={[styles.eventoDot, { backgroundColor: tipo.cor }]} />
      <View style={styles.eventoTexto}>
        <Text style={styles.eventoNome} numberOfLines={1}>
          <Text style={{ color: tipo.cor, fontWeight: '800' }}>{tipo.texto}</Text>
          {'  '}
          {ev.label || ev.name}
        </Text>
        <Text style={styles.eventoTempo}>{formatDate(ev.created_at)}</Text>
      </View>
    </View>
  );
}

export default function LinksScreen() {
  const [links, setLinks] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [disponiveis, setDisponiveis] = useState(null);
  const [novoLabel, setNovoLabel] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [staleAt, setStaleAt] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const aplicar = (d) => {
        setLinks(d.links || []);
        setEventos(d.eventos || []);
      };
      const { data, stale, savedAt } = await withCache(
        'links',
        async () => {
          const [st, ev] = await Promise.all([
            api.links(),
            api.linkEvents({ hours: 168, page: 1, pageSize: 15 }),
          ]);
          return { links: st.items, eventos: ev.items };
        },
        (guardado, salvoEm) => {
          aplicar(guardado);
          setStaleAt(salvoEm);
          setLoading(false);
        }
      );
      setStaleAt(stale ? savedAt : null);
      aplicar(data);
      setError('');
    } catch (err) {
      setError(err.message || 'Falha ao carregar os links');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      load();
      const id = setInterval(() => {
        if (ativo) load();
      }, 15000);
      return () => {
        ativo = false;
        clearInterval(id);
      };
    }, [load])
  );

  async function abrirCadastro() {
    setBusy(true);
    try {
      const res = await api.availableLinks();
      setDisponiveis(res.items || []);
    } catch (err) {
      Alert.alert('Erro', err.message || 'Não foi possível ler as interfaces do CCR');
    } finally {
      setBusy(false);
    }
  }

  async function adicionar(iface) {
    setBusy(true);
    try {
      await api.addLink(iface.name, novoLabel[iface.name] || null);
      setDisponiveis((atual) => (atual || []).filter((i) => i.name !== iface.name));
      await load();
    } catch (err) {
      Alert.alert('Erro', err.message || 'Falha ao cadastrar');
    } finally {
      setBusy(false);
    }
  }

  function remover(link) {
    Alert.alert('Parar de vigiar', `Deixar de monitorar ${link.label || link.name}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Parar',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.removeLink(link.name);
            await load();
          } catch (err) {
            Alert.alert('Erro', err.message || 'Falha ao remover');
          }
        },
      },
    ]);
  }

  if (loading && !links.length) {
    return (
      <View style={styles.screen}>
        <LoadingState />
      </View>
    );
  }

  const caidos = links.filter((l) => !l.up).length;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.conteudo}
      data={links}
      keyExtractor={(l) => l.name}
      renderItem={({ item }) => <LinkCard link={item} onRemover={remover} />}
      ListHeaderComponent={
        <>
          <ErrorBanner message={error} />
          <StaleBanner savedAt={staleAt} />
          {links.length > 0 ? (
            <Text style={styles.resumo}>
              {caidos === 0
                ? `${links.length} ${links.length === 1 ? 'link vigiado' : 'links vigiados'}, todos de pé`
                : `${caidos} de ${links.length} ${links.length === 1 ? 'link' : 'links'} fora do ar`}
            </Text>
          ) : null}
        </>
      }
      ListEmptyComponent={
        <EmptyState
          title="Nenhum link vigiado ainda"
          hint="Cadastre as interfaces de transporte do CCR (uplink, fibra de POP, rádio de torre) para ser avisado na hora em que uma delas cair."
        />
      }
      ListFooterComponent={
        <View>
          {disponiveis == null ? (
            <PrimaryButton
              label={busy ? 'Lendo o CCR...' : 'Cadastrar link'}
              onPress={abrirCadastro}
              disabled={busy}
            />
          ) : (
            <View style={styles.cadastro}>
              <View style={styles.cadastroTopo}>
                <Text style={styles.cadastroTitulo}>Interfaces do CCR</Text>
                <Pressable onPress={() => setDisponiveis(null)} hitSlop={10}>
                  <Ionicons name="close" size={20} color={colors.inkSoft} />
                </Pressable>
              </View>
              <Text style={styles.cadastroAjuda}>
                Escolha só as de transporte. As PPPoE de cliente já ficam de fora da lista.
              </Text>
              {disponiveis.length === 0 ? (
                <Text style={styles.muted}>Nenhuma interface nova pra cadastrar.</Text>
              ) : (
                disponiveis.map((i) => (
                  <View key={i.name} style={styles.ifaceLinha}>
                    <View style={styles.ifaceInfo}>
                      <Text style={styles.ifaceNome}>{i.name}</Text>
                      <Text style={styles.ifaceMeta}>
                        {i.type}
                        {i.running ? ' · de pé' : ' · caída'}
                        {i.linkDowns ? ` · ${i.linkDowns} quedas no CCR` : ''}
                      </Text>
                      <TextInput
                        style={styles.ifaceInput}
                        placeholder="apelido (ex: Uplink Vivo, Torre Norte)"
                        placeholderTextColor={colors.inkFaint}
                        value={novoLabel[i.name] || ''}
                        onChangeText={(v) => setNovoLabel((a) => ({ ...a, [i.name]: v }))}
                      />
                    </View>
                    <Pressable
                      onPress={() => adicionar(i)}
                      disabled={busy}
                      style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.6 }]}
                    >
                      <Ionicons name="add" size={20} color={colors.accent} />
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          )}

          {eventos.length > 0 ? (
            <View style={styles.historico}>
              <Text style={styles.historicoTitulo}>Últimos eventos</Text>
              {eventos.map((ev) => (
                <EventoLinha key={ev.id} ev={ev} />
              ))}
            </View>
          ) : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  conteudo: { padding: 12, paddingBottom: 28 },
  resumo: { color: colors.inkSoft, fontSize: 12, fontWeight: '650', marginBottom: 10 },

  card: {
    backgroundColor: colors.surface2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    marginBottom: 8,
  },
  cardCaido: { borderColor: 'rgba(220,38,38,0.35)' },
  cardTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  nome: { color: colors.ink, fontSize: 14, fontWeight: '750' },
  iface: { color: colors.inkFaint, fontSize: 11, fontFamily: 'monospace', marginTop: 1 },
  rodape: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  meta: { color: colors.inkSoft, fontSize: 11.5 },
  quedas: { color: colors.amber, fontSize: 11.5, fontWeight: '700' },

  cadastro: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginTop: 4,
  },
  cadastroTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cadastroTitulo: { color: colors.ink, fontSize: 14, fontWeight: '750' },
  cadastroAjuda: { color: colors.inkFaint, fontSize: 11.5, marginTop: 4, marginBottom: 12, lineHeight: 16 },
  muted: { color: colors.inkFaint, fontSize: 12 },
  ifaceLinha: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  ifaceInfo: { flex: 1 },
  ifaceNome: { color: colors.ink, fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  ifaceMeta: { color: colors.inkFaint, fontSize: 11, marginTop: 1 },
  ifaceInput: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.ink,
    fontSize: 13,
    marginTop: 7,
  },
  addBtn: {
    backgroundColor: colors.accentBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 8,
    marginTop: 2,
  },

  historico: { marginTop: 18 },
  historicoTitulo: { color: colors.ink, fontSize: 13, fontWeight: '750', marginBottom: 10 },
  evento: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 6 },
  eventoDot: { width: 7, height: 7, borderRadius: 4 },
  eventoTexto: { flex: 1 },
  eventoNome: { color: colors.ink, fontSize: 12.5 },
  eventoTempo: { color: colors.inkFaint, fontSize: 10.5, marginTop: 1 },
});
