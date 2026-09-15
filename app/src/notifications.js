import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from './api';
import { getStoredPushToken, setStoredPushToken } from './storage';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Situacao atual da permissao, sem abrir nenhum dialogo. */
export async function getPermissionStatus() {
  if (!Device.isDevice) return { status: 'emulador', podePedir: false, concedida: false };
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  return { status, podePedir: canAskAgain, concedida: status === 'granted' };
}

/**
 * Pede permissao, pega o Expo push token e registra no servidor.
 *
 * Devolve um resultado descritivo em vez de token-ou-null, porque cada motivo
 * de falha pede uma acao diferente do usuario: permissao negada de forma
 * definitiva so se resolve nos ajustes do Android, projectId faltando so se
 * resolve rebuildando, e servidor fora do ar e so tentar de novo depois. Antes
 * tudo isso virava um "nao foi possivel ativar (veja o console)", que nao ajuda
 * ninguem que esta com o celular na mao.
 */
export async function registerForPushNotifications({ pedirPermissao = true } = {}) {
  if (Platform.OS === 'android') {
    // O canal tem que existir antes de qualquer notificacao chegar, senao o
    // Android usa o padrao e ignora importancia/vibracao configuradas aqui.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Alertas do Monitor',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#5b8def',
    });
  }

  if (!Device.isDevice) {
    return { ok: false, motivo: 'emulador' };
  }

  const { status: atual, canAskAgain } = await Notifications.getPermissionsAsync();
  let status = atual;

  if (status !== 'granted') {
    // Nao insiste quando o Android ja fechou a porta: chamar
    // requestPermissionsAsync nesse estado nao abre dialogo nenhum e devolve
    // 'denied' na hora, o que pareceria um bug pro usuario ("apertei e nao
    // aconteceu nada"). Nesse caso o caminho e os ajustes do sistema.
    if (!canAskAgain) {
      return { ok: false, motivo: 'negada-definitivo' };
    }
    if (!pedirPermissao) {
      return { ok: false, motivo: 'nao-concedida-ainda' };
    }
    const pedido = await Notifications.requestPermissionsAsync();
    status = pedido.status;
    if (status !== 'granted') {
      return { ok: false, motivo: pedido.canAskAgain ? 'negada' : 'negada-definitivo' };
    }
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    return { ok: false, motivo: 'sem-projectid' };
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const previous = await getStoredPushToken();
    if (previous !== token) {
      await api.registerPushToken(token, Platform.OS);
      await setStoredPushToken(token);
    }
    return { ok: true, token };
  } catch (err) {
    return { ok: false, motivo: 'falha-registro', erro: err?.message || String(err) };
  }
}

/** Abre a tela de ajustes do proprio app, onde da pra reativar a permissao. */
export async function abrirAjustesDoSistema() {
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}

/**
 * Pede pro servidor mandar um push de teste só pra este aparelho. Serve pra
 * conferir a corrente toda (credencial do Firebase, token, permissão do
 * Android) sem esperar uma queda real acontecer.
 */
export async function sendTestPush() {
  const token = await getStoredPushToken();
  if (!token) return { ok: false, error: 'Ative as notificações primeiro' };
  try {
    await api.testPushToken(token);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'Falha ao enviar teste' };
  }
}

export async function unregisterPushNotifications() {
  const token = await getStoredPushToken();
  if (!token) return;
  try {
    await api.unregisterPushToken(token);
  } catch {
    // best-effort
  }
  await setStoredPushToken(null);
}
