import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius } from '../theme';
import { useAuth } from '../context/AuthContext';
import { registerForPushNotifications, unregisterPushNotifications } from '../notifications';
import { Card, KeyValue } from '../components/common';
import PrimaryButton from '../components/PrimaryButton';

export default function SettingsScreen() {
  const { serverUrl, updateServerUrl, user, logout } = useAuth();
  const [url, setUrl] = useState(serverUrl);
  const [saving, setSaving] = useState(false);
  const [pushStatus, setPushStatus] = useState('');

  async function handleSaveUrl() {
    setSaving(true);
    try {
      await updateServerUrl(url);
      Alert.alert('Salvo', 'Endereço do servidor atualizado.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRegisterPush() {
    setPushStatus('Registrando…');
    const token = await registerForPushNotifications();
    setPushStatus(token ? 'Notificações ativadas ✓' : 'Não foi possível ativar (veja o console)');
  }

  async function handleDisablePush() {
    await unregisterPushNotifications();
    setPushStatus('Notificações desativadas');
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 12 }}>
      <Card title="Conta">
        <KeyValue label="Usuário" value={user} />
      </Card>

      <Card title="Servidor">
        <Text style={styles.label}>Endereço da API</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.0.10:3001"
          placeholderTextColor={colors.inkFaint}
        />
        <PrimaryButton label={saving ? 'Salvando…' : 'Salvar endereço'} onPress={handleSaveUrl} disabled={saving} />
      </Card>

      <Card title="Notificações push">
        <Text style={styles.muted}>
          Avisa quando o CCR cai/volta e quando vários clientes da mesma porta ou região caem juntos.
        </Text>
        {pushStatus ? <Text style={styles.status}>{pushStatus}</Text> : null}
        <PrimaryButton label="Ativar notificações" onPress={handleRegisterPush} />
        <PrimaryButton label="Desativar neste aparelho" onPress={handleDisablePush} tone="danger" />
      </Card>

      <View style={{ height: 8 }} />
      <PrimaryButton label="Sair" onPress={logout} tone="danger" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  label: { color: colors.inkFaint, fontSize: 11, fontWeight: '650', marginBottom: 4 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 9, color: colors.ink, fontSize: 13 },
  muted: { color: colors.inkFaint, fontSize: 12, marginBottom: 6 },
  status: { color: colors.accent, fontSize: 12, marginBottom: 6, fontWeight: '650' },
});
