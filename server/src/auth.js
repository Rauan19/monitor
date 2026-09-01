import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from './config.js';

const COOKIE_NAME = 'mksess';

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function sign(payload) {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', config.auth.secret).update(json).digest('base64url');
  return `${json}.${hmac}`;
}

function verify(token) {
  if (!token) return null;
  const [json, hmac] = token.split('.');
  if (!json || !hmac) return null;

  const expected = crypto.createHmac('sha256', config.auth.secret).update(json).digest('base64url');
  if (!safeEqual(hmac, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(json, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return [part.trim(), ''];
      return [decodeURIComponent(part.slice(0, idx).trim()), decodeURIComponent(part.slice(idx + 1).trim())];
    })
  );
}

function createSessionToken(username) {
  const maxAgeMs = config.auth.sessionHours * 60 * 60 * 1000;
  return sign({ u: username, exp: Date.now() + maxAgeMs });
}

function setSessionCookie(res, token) {
  const maxAgeMs = config.auth.sessionHours * 60 * 60 * 1000;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}; SameSite=Lax${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

export function requireAuth(req, res, next) {
  // ?token= existe só pra abrir o relatório imprimível no navegador externo do celular
  // (o app mobile não tem cookie de sessão, só o Bearer token).
  const token = bearerToken(req) || parseCookies(req)[COOKIE_NAME] || req.query.token;
  const payload = verify(token);
  if (!payload) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.user = payload.u;
  next();
}

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const validUser = safeEqual(username || '', config.auth.user);
  const validPassword = safeEqual(password || '', config.auth.password);

  if (!validUser || !validPassword) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }

  const token = createSessionToken(config.auth.user);
  setSessionCookie(res, token);
  // O token também volta no corpo pro app mobile, que não guarda cookies HttpOnly —
  // ele manda de volta via header "Authorization: Bearer <token>".
  res.json({ ok: true, user: config.auth.user, token });
});

authRouter.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
