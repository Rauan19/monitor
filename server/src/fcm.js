import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleAuth } from 'google-auth-library';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_PATH = path.join(__dirname, '../firebase-adminsdk-key.json');

let auth = null;
let projectId = null;

function getAuth() {
  if (auth) return auth;
  if (!fs.existsSync(KEY_PATH)) return null;

  const credentials = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  projectId = credentials.project_id;
  auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });
  return auth;
}

/**
 * Manda push pra um token de navegador (web push) via FCM v1 direto —
 * o app mobile usa a API do Expo (push.js), a web fala direto com o FCM.
 */
export async function sendFcmWebPush(token, { title, body, data }) {
  const googleAuth = getAuth();
  if (!googleAuth) return { ok: false, error: 'not-configured' };

  const client = await googleAuth.getClient();
  const { token: accessToken } = await client.getAccessToken();

  const message = {
    message: {
      token,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
      webpush: {
        fcm_options: { link: '/' },
        notification: { icon: '/icon.png' },
      },
    },
  };

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });

  if (res.ok) return { ok: true };

  const errJson = await res.json().catch(() => null);
  const status = errJson?.error?.status;
  const invalid = status === 'NOT_FOUND' || status === 'INVALID_ARGUMENT' || status === 'UNREGISTERED';
  return { ok: false, error: status || `http_${res.status}`, invalid };
}
