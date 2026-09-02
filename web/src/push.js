import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { firebaseApp } from './firebase';
import { api } from './api';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';
const STORAGE_KEY = 'monitor_push_token';

export function isWebPushSupported() {
  return 'serviceWorker' in navigator && 'Notification' in window;
}

export function isWebPushEnabled() {
  return !!localStorage.getItem(STORAGE_KEY);
}

export async function enableWebPush() {
  if (!isWebPushSupported()) {
    return { ok: false, error: 'Esse navegador não suporta notificações' };
  }
  if (!VAPID_KEY) {
    return { ok: false, error: 'Chave VAPID não configurada (VITE_FIREBASE_VAPID_KEY)' };
  }
  if (!(await isSupported())) {
    return { ok: false, error: 'Firebase Messaging não é suportado nesse navegador' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, error: 'Permissão de notificação negada' };
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    const messaging = getMessaging(firebaseApp);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return { ok: false, error: 'Não foi possível gerar o token de notificação' };

    await api.registerPushToken(token);
    localStorage.setItem(STORAGE_KEY, token);

    onMessage(messaging, (payload) => {
      const { title, body } = payload.notification || {};
      new Notification(title || 'Monitor MikroTik', { body });
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'Falha ao ativar notificações' };
  }
}

export async function disableWebPush() {
  const token = localStorage.getItem(STORAGE_KEY);
  if (token) {
    try {
      await api.unregisterPushToken(token);
    } catch {
      // best-effort
    }
    localStorage.removeItem(STORAGE_KEY);
  }
}
