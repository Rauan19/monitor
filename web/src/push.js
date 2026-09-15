import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { firebaseApp } from './firebase';
import { api } from './api';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';
const STORAGE_KEY = 'monitor_push_token';

let foregroundAttached = false;

export function isWebPushSupported() {
  return 'serviceWorker' in navigator && 'Notification' in window;
}

export function isWebPushEnabled() {
  return !!localStorage.getItem(STORAGE_KEY);
}

/**
 * Mostra a notificação quando ela chega com a aba em foco. Nesse caso o
 * service worker NÃO dispara `onBackgroundMessage`, então sem isso o push
 * chegaria e ninguém veria. Idempotente: só registra o listener uma vez.
 */
function attachForegroundHandler(messaging) {
  if (foregroundAttached) return;
  foregroundAttached = true;
  onMessage(messaging, (payload) => {
    const { title, body } = payload.notification || {};
    new Notification(title || 'Monitor MikroTik', { body });
  });
}

/**
 * Religa o handler de foreground depois de um reload da página, pra quem já
 * tinha ativado as notificações antes. Sem isso o `onMessage` só valia na
 * sessão em que o usuário clicou em "Ativar notificações".
 */
export async function initWebPush() {
  if (!isWebPushEnabled() || !isWebPushSupported()) return;
  if (Notification.permission !== 'granted') return;
  if (!(await isSupported())) return;

  try {
    attachForegroundHandler(getMessaging(firebaseApp));
  } catch {
    // best-effort: se falhar, o push em background ainda funciona pelo sw.js
  }
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

    attachForegroundHandler(messaging);

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

/** Pede pro servidor mandar um push de teste só pra este navegador. */
export async function sendTestPush() {
  const token = localStorage.getItem(STORAGE_KEY);
  if (!token) return { ok: false, error: 'Ative as notificações primeiro' };
  try {
    await api.testPushToken(token);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'Falha ao enviar teste' };
  }
}
