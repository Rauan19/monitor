import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors, radius } from '../theme';
import { useAuth } from '../context/AuthContext';
import {
  abrirAjustesDoSistema,
  getPermissionStatus,
  registerForPushNotifications,
  sendTestPush,
  unregisterPushNotifications,
} from '../notifications';
import { Badge, Card, KeyValue } from '../components/common';
import PrimaryButton from '../components/PrimaryButton';

// Cada motivo de falha tem uma acao diferente do lado do usuario. Deixar tudo
// como "nao foi possivel ativar" nao ajuda quem esta com o celular na mao.
const MOTIVOS = {
  negada: {
    texto: 'Permissao negada. Toque em "Ativar notificacoes" e aceite o pedido do Android.',
    ajustes: false,
  },
  'negada-definitivo': {
    texto:
      'O Android nao vai mais perguntar, porque a permissao foi negada antes. ' +
      'Libere em Ajustes do sistema > Notificacoes e volte aqui.',
    ajustes: true,
  },
  'nao-concedida-ainda': { texto: 'Notificacoes ainda nao estao ativadas neste aparelho.', ajustes: false },
  emulador: {
    texto: 'Push so funciona em aparelho de verdade. Em emulador o Android nao entrega notificacao.',
    ajustes: false,
  },
  'sem-projectid': {
    texto: 'Build sem projectId do EAS. Precisa gerar um build novo com "eas build".',
    ajustes: false,
  },
  'falha-registro': {
    texto: 'Permissao concedida, mas o servidor nao respondeu ao registrar o aparelho. Tente de novo.',
    ajustes: false,
  },
};

export default function SettingsScreen() {
  const navigation = useNavigation();
  const { serverUrl, updateServerUrl, user, logout } = useAuth();
  const [url, setUrl] = useState(serverUrl);
  const [saving, setSaving] = useState(false);
  const [pushStatus, setPushStatus] = useState('');
  const [permissao, setPermissao] = useState(null);
  const [pushBusy, setPushBusy] = useState(false);

  // Le a permissao real do sistema ao abrir a tela, sem abrir dialogo. Sem isso
  // a tela nao tinha como saber se as notificacoes estao de fato ativas: o
  // usuario podia ter desligado nos ajustes do Android e o app nem notava.
  const lerPermissao = useCallback(async () => {
    setPermissao(await getPermissionStatus());
  }, []);

  useFocusEffect(
    useCallback(() => {
      lerPermissao();
    }, [lerPermissao])
  );

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
    setPushBusy(true);
    setPushStatus('Registrando…');
    try {
      const res = await registerForPushNotifications();
      if (res.ok) {
        setPushStatus('Notificações ativadas neste aparelho');
      } else {
        const m = MOTIVOS[res.motivo];
        setPushStatus(m ? m.texto : res.erro || 'Não foi possível ativar');
      }
      await lerPermissao();
    } finally {
      setPushBusy(false);
    }
  }

  async function handleAbrirAjustes() {
    const ok = await abrirAjustesDoSistema();
    if (!ok) {
      Alert.alert('Ajustes', 'Abra os ajustes do Android, procure o MonitorZcnet e libere as notificações.');
    }
  }

  async function handleDisablePush() {
    await unregisterPushNotifications();
    setPushStatus('Aparelho removido. Não vai mais receber alertas.');
  }

  async function handleTestPush() {
    setPushBusy(true);
    setPushStatus('Enviando teste…');
    try {
      const res = await sendTestPush();
      setPushStatus(res.ok ? 'Push de teste enviado, deve chegar em alguns segundos' : res.error);
    } finally {
      setPushBusy(false);
    }
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

      <Card title="OLTs e portas">
        <Text style={styles.muted}>Cadastre OLTs (nome + qtd de portas), nomeie cada porta e teste porta (calibração).</Text>
        <PrimaryButton label="Gerenciar OLTs e portas" onPress={() => navigation.navigate('Olts')} />
      </Card>

      <Card title="Notificações push">
        <View style={styles.permLinha}>
          <Text style={styles.muted}>Permissão do Android</Text>
          <Badge
            label={
              permissao == null
                ? '…'
                : permissao.concedida
                  ? 'Liberada'
                  : permissao.status === 'emulador'
                    ? 'Emulador'
                    : permissao.podePedir
                      ? 'Não pedida'
                      : 'Negada'
            }
            tone={permissao?.concedida ? 'ok' : permissao?.podePedir === false && permissao?.status !== 'emulador' ? 'warn' : 'amber'}
          />
        </View>

        <Text style={styles.muted}>
          Avisa quando o CCR cai/volta e quando vários clientes da mesma porta ou região caem juntos.
        </Text>
        {pushStatus ? <Text style={styles.status}>{pushStatus}</Text> : null}

        {!permissao?.concedida ? (
          <PrimaryButton
            label={pushBusy ? 'Aguarde…' : 'Ativar notificações'}
            onPress={handleRegisterPush}
            disabled={pushBusy}
          />
        ) : null}

        {/* Quando o Android nao pergunta mais, o unico caminho e os ajustes do
            sistema. Sem este botao a permissao negada era um beco sem saida. */}
        {permissao && !permissao.concedida && !permissao.podePedir && permissao.status !== 'emulador' ? (
          <PrimaryButton label="Abrir ajustes do sistema" onPress={handleAbrirAjustes} />
        ) : null}

        {permissao?.concedida ? (
          <>
            <PrimaryButton
              label={pushBusy ? 'Aguarde…' : 'Enviar push de teste'}
              onPress={handleTestPush}
              disabled={pushBusy}
            />
            <PrimaryButton label="Desativar neste aparelho" onPress={handleDisablePush} tone="danger" />
          </>
        ) : null}
      </Card>

      <View style={{ height: 8 }} />
      <PrimaryButton label="Sair" onPress={logout} tone="danger" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  permLinha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  screen: { flex: 1, backgroundColor: colors.bg },
  label: { color: colors.inkFaint, fontSize: 11, fontWeight: '650', marginBottom: 4 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 9, color: colors.ink, fontSize: 13 },
  muted: { color: colors.inkFaint, fontSize: 12, marginBottom: 6 },
  status: { color: colors.accent, fontSize: 12, marginBottom: 6, fontWeight: '650' },
});
