import { Platform } from 'react-native';
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

/**
 * Pede permissão, pega o Expo push token e registra no servidor.
 * Se não tiver projectId (EAS) configurado ainda, ou não for um device físico, não faz nada.
 */
export async function registerForPushNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Alertas do Monitor',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#5b8def',
    });
  }

  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    console.warn('[push] extra.eas.projectId não configurado — rode "eas init" antes de buildar.');
    return null;
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const previous = await getStoredPushToken();
    if (previous !== token) {
      await api.registerPushToken(token, Platform.OS);
      await setStoredPushToken(token);
    }
    return token;
  } catch (err) {
    console.warn('[push] falha ao registrar token:', err?.message || err);
    return null;
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
