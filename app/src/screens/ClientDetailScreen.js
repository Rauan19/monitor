import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { colors, radius } from '../theme';
import { api } from '../api';
import { Badge, ErrorBanner, KeyValue, LoadingState } from '../components/common';
import PrimaryButton from '../components/PrimaryButton';
import MiniBars from '../components/MiniBars';
import { formatBps, formatDate } from '../format';

function Chip({ label, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[chipStyles.chip, active && chipStyles.chipActive]}>
      <Text style={[chipStyles.chipText, active && chipStyles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    marginRight: 6,
    marginBottom: 6,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.inkSoft, fontSize: 12, fontWeight: '650' },
  chipTextActive: { color: '#061024' },
});

export default function ClientDetailScreen() {
  const insets = useSafeAreaInsets();
  const route = useRoute();
  const navigation = useNavigation();
  const { sessionKey } = route.params;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [alias, setAlias] = useState('');
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [street, setStreet] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [port, setPort] = useState('');
  const [oltId, setOltId] = useState(null);
  const [olts, setOlts] = useState([]);
  const [saving, setSaving] = useState(false);
  // Coordenada guardada como texto pra poder ser digitada a mao tambem, nao so
  // capturada por GPS (as vezes o tecnico ja tem a coordenada de outro lugar).
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [gps, setGps] = useState({ ocupado: false, erro: '' });

  const load = useCallback(async () => {
    try {
      const [res, oltsRes] = await Promise.all([api.clientDetail(sessionKey), api.listOlts()]);
      setData(res);
      setOlts(oltsRes.olts || []);
      const s = res.session;
      setAlias(s.alias || '');
      setRegion(s.loc_region || '');
      setCity(s.loc_city || '');
      setStreet(s.loc_street || '');
      setNeighborhood(s.loc_neighborhood || '');
      setPort(s.ont_port ? String(s.ont_port) : '');
      setOltId(s.olt_id || null);
      setLat(s.lat != null ? String(s.lat) : '');
      setLng(s.lng != null ? String(s.lng) : '');
      setError('');
    } catch (err) {
      setError(err.message || 'Falha ao carregar cliente');
    } finally {
      setLoading(false);
    }
  }, [sessionKey]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const oltPortCount = oltId ? olts.find((o) => o.id === Number(oltId))?.port_count || 8 : 8;

  /**
   * Pega a coordenada do aparelho. Aqui o app leva vantagem sobre o painel web:
   * quem esta instalando esta na casa do cliente com o celular na mao, entao a
   * coordenada sai certa. So preenche os campos, nao salva sozinho, pra dar
   * chance de conferir antes.
   */
  async function handleGps() {
    setGps({ ocupado: true, erro: '' });
    try {
      const atual = await Location.getForegroundPermissionsAsync();
      let status = atual.status;
      if (status !== 'granted') {
        // Mesmo caso da permissao de notificacao: quando o Android fecha a
        // porta, pedir de novo nao abre dialogo, so devolve 'denied'.
        if (!atual.canAskAgain) {
          setGps({
            ocupado: false,
            erro: 'Permissao de localizacao negada. Libere em Ajustes do sistema.',
          });
          return;
        }
        const pedido = await Location.requestForegroundPermissionsAsync();
        status = pedido.status;
      }
      if (status !== 'granted') {
        setGps({ ocupado: false, erro: 'Sem permissao de localizacao.' });
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setLat(pos.coords.latitude.toFixed(6));
      setLng(pos.coords.longitude.toFixed(6));
      const precisao = pos.coords.accuracy != null ? ` (precisao ~${Math.round(pos.coords.accuracy)}m)` : '';
      setGps({ ocupado: false, erro: '' });
      Alert.alert(
        'Localizacao capturada',
        `Coordenada preenchida${precisao}. Confira e toque em Salvar pra gravar no cliente.`
      );
    } catch (err) {
      setGps({ ocupado: false, erro: err?.message || 'Nao foi possivel pegar a localizacao' });
    }
  }

  function handleLimparCoord() {
    setLat('');
    setLng('');
  }

  /** Abre a coordenada no app de mapas do celular, pra conferir ou navegar. */
  function handleAbrirNoMapa() {
    const la = lat.trim();
    const lo = lng.trim();
    if (!la || !lo) return;
    const nome = encodeURIComponent(alias || data?.session?.name || 'Cliente');
    Linking.openURL(`geo:${la},${lo}?q=${la},${lo}(${nome})`).catch(() => {
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${la},${lo}`).catch(() => {});
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.setAlias(sessionKey, alias);
      // lat/lng vao juntos ou nao vao: o servidor so mexe nas colunas quando
      // recebe os dois, entao mandar um sem o outro nao faria nada. Campo vazio
      // vira null de proposito, pra dar pra apagar uma coordenada errada.
      const temCoord = lat.trim() !== '' && lng.trim() !== '';
      const semCoord = lat.trim() === '' && lng.trim() === '';
      await api.setLocation(sessionKey, {
        region,
        city,
        street,
        neighborhood,
        ...(temCoord ? { lat: Number(lat), lng: Number(lng) } : {}),
        ...(semCoord ? { lat: null, lng: null } : {}),
      });
      await api.setClientOlt(sessionKey, oltId || null);
      await api.setPort(sessionKey, port ? Number(port) : null);
      await load();
      Alert.alert('Salvo', 'Dados do cliente atualizados.');
    } catch (err) {
      Alert.alert('Erro', err.message || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    Alert.alert('Remover cliente', 'Remover da lista? Ele só volta a aparecer se reconectar.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.removeClient(sessionKey);
            navigation.goBack();
          } catch (err) {
            Alert.alert('Erro', err.message || 'Não foi possível remover');
          }
        },
      },
    ]);
  }

  if (loading) return <LoadingState />;

  const session = data?.session;
  const online = session ? Number(session.is_online) === 1 : false;
  const bwData = (data?.bandwidth || []).map((b) => ({ value: (b.down_bps || 0) + (b.up_bps || 0) }));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 12, paddingBottom: 12 + insets.bottom }}>
      <ErrorBanner message={error} />
      {session && (
        <>
          <View style={styles.headRow}>
            <Badge label={online ? 'Online' : 'Offline'} tone={online ? 'ok' : 'warn'} />
            {data.sla && <Text style={styles.uptime}>Uptime 30d: {data.sla.uptimePct}%</Text>}
          </View>

          <View style={styles.card}>
            <KeyValue label="Usuário PPP" value={session.name} />
            <KeyValue label="IP" value={session.address} />
            <KeyValue label="MAC" value={session.caller_id} />
            <KeyValue label="Perfil" value={session.profile} />
            <KeyValue label="Uptime PPP" value={session.uptime} />
            <KeyValue
              label="Porta"
              value={
                session.ont_port
                  ? session.port_label
                    ? `${session.ont_port} · ${session.port_label}`
                    : String(session.ont_port)
                  : null
              }
            />
            {data.live && (
              <KeyValue label="Velocidade agora" value={`${formatBps(data.live.downBps)} / ${formatBps(data.live.upBps)}`} />
            )}
          </View>

          <Text style={styles.sectionTitle}>Banda (24h)</Text>
          <View style={styles.card}>
            <MiniBars data={bwData} color={colors.cyan} />
          </View>

          <Text style={styles.sectionTitle}>Editar cliente</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Apelido</Text>
            <TextInput style={styles.input} value={alias} onChangeText={setAlias} placeholder={session.name} placeholderTextColor={colors.inkFaint} />

            <Text style={styles.label}>Região</Text>
            <TextInput style={styles.input} value={region} onChangeText={setRegion} placeholderTextColor={colors.inkFaint} />

            <Text style={styles.label}>Bairro</Text>
            <TextInput style={styles.input} value={neighborhood} onChangeText={setNeighborhood} placeholderTextColor={colors.inkFaint} />

            <Text style={styles.label}>Cidade</Text>
            <TextInput style={styles.input} value={city} onChangeText={setCity} placeholderTextColor={colors.inkFaint} />

            <Text style={styles.label}>Rua</Text>
            <TextInput style={styles.input} value={street} onChangeText={setStreet} placeholderTextColor={colors.inkFaint} />

            <Text style={styles.label}>Coordenada</Text>
            <View style={styles.coordRow}>
              <TextInput
                style={[styles.input, styles.coordInput]}
                value={lat}
                onChangeText={setLat}
                placeholder="latitude"
                placeholderTextColor={colors.inkFaint}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
              />
              <TextInput
                style={[styles.input, styles.coordInput]}
                value={lng}
                onChangeText={setLng}
                placeholder="longitude"
                placeholderTextColor={colors.inkFaint}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
              />
            </View>
            <PrimaryButton
              label={gps.ocupado ? 'Pegando localizacao...' : lat || lng ? 'Atualizar pelo GPS' : 'Usar minha localizacao (GPS)'}
              onPress={handleGps}
              disabled={gps.ocupado}
            />
            {lat.trim() && lng.trim() ? (
              <View style={styles.coordAcoes}>
                <Pressable onPress={handleAbrirNoMapa} hitSlop={8}>
                  <Text style={styles.link}>Abrir no mapa</Text>
                </Pressable>
                <Pressable onPress={handleLimparCoord} hitSlop={8}>
                  <Text style={styles.linkDanger}>Limpar coordenada</Text>
                </Pressable>
              </View>
            ) : null}
            {gps.erro ? <Text style={styles.gpsErro}>{gps.erro}</Text> : null}

            <Text style={styles.label}>OLT</Text>
            <View style={styles.chipRow}>
              <Chip
                label="Sem OLT"
                active={!oltId}
                onPress={() => {
                  setOltId(null);
                  setPort('');
                }}
              />
              {olts.map((o) => (
                <Chip
                  key={o.id}
                  label={o.name}
                  active={Number(oltId) === o.id}
                  onPress={() => {
                    setOltId(o.id);
                    setPort('');
                  }}
                />
              ))}
            </View>

            <Text style={styles.label}>Porta</Text>
            <View style={styles.chipRow}>
              {Array.from({ length: oltPortCount }, (_, i) => i + 1).map((p) => (
                <Chip key={p} label={String(p)} active={Number(port) === p} onPress={() => setPort(String(p))} />
              ))}
            </View>

            <PrimaryButton label={saving ? 'Salvando…' : 'Salvar'} onPress={handleSave} disabled={saving} />
            {!online && <PrimaryButton label="Remover cliente" onPress={handleRemove} tone="danger" />}
          </View>

          <Text style={styles.sectionTitle}>Eventos recentes</Text>
          <View style={styles.card}>
            {(data.events || []).length ? (
              data.events.map((ev) => (
                <View key={ev.id} style={styles.eventRow}>
                  <Badge label={ev.event_type === 'disconnected' ? 'Caiu' : 'Conectou'} tone={ev.event_type === 'disconnected' ? 'warn' : 'ok'} />
                  <Text style={styles.eventDate}>{formatDate(ev.created_at)}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.muted}>Sem eventos registrados ainda.</Text>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  coordRow: { flexDirection: 'row', gap: 8 },
  coordInput: { flex: 1 },
  coordAcoes: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 2 },
  link: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  linkDanger: { color: colors.bad, fontSize: 12, fontWeight: '700' },
  gpsErro: { color: colors.bad, fontSize: 12, marginTop: 6 },
  screen: { flex: 1, backgroundColor: colors.bg },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  uptime: { color: colors.inkSoft, fontSize: 12, fontWeight: '650' },
  card: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 14 },
  sectionTitle: { color: colors.inkSoft, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  label: { color: colors.inkFaint, fontSize: 11, fontWeight: '650', marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 9, color: colors.ink, fontSize: 13 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  eventRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line },
  eventDate: { color: colors.inkFaint, fontSize: 12 },
  muted: { color: colors.inkFaint, fontSize: 13 },
});
