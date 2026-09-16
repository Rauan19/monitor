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

const WEB_SESSION_MS = () => config.auth.sessionHours * 60 * 60 * 1000;
const APP_SESSION_MS = () => config.auth.appSessionDays * 24 * 60 * 60 * 1000;

// "d" guarda a duracao original da sessao dentro do token, pra renovacao saber
// se renova por 12h (painel) ou 30 dias (app). Tokens antigos, emitidos antes
// desse campo existir, caem no padrao do painel.
function createSessionToken(username, durationMs = WEB_SESSION_MS()) {
  return sign({ u: username, exp: Date.now() + durationMs, d: durationMs });
}

function setSessionCookie(res, token) {
  const maxAgeMs = WEB_SESSION_MS();
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
  const viaBearer = bearerToken(req);
  const viaCookie = parseCookies(req)[COOKIE_NAME];
  const token = viaBearer || viaCookie || req.query.token;
  const payload = verify(token);
  if (!payload) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.user = payload.u;

  // Renovacao deslizante. Antes o token expirava num horario fixo contado do
  // login, usasse o app ou nao: logou de manha, caia a noite no meio do uso.
  // Agora, passada metade da validade, qualquer requisicao autenticada devolve
  // um token novo com a validade cheia. Quem usa nao expira; so expira quem
  // ficou parado o periodo inteiro.
  const duracao = Number(payload.d) || WEB_SESSION_MS();
  const restante = payload.exp - Date.now();
  if (restante < duracao / 2) {
    const novo = createSessionToken(payload.u, duracao);
    if (viaBearer) {
      // O app le esse header em toda resposta e troca o token guardado.
      res.setHeader('X-Session-Token', novo);
      res.setHeader('Access-Control-Expose-Headers', 'X-Session-Token');
    } else if (viaCookie) {
      setSessionCookie(res, novo);
    }
  }
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

  // O app pede sessao longa mandando client: 'app'. O painel continua com a
  // sessao curta do cookie.
  const ehApp = req.body?.client === 'app';
  const token = createSessionToken(config.auth.user, ehApp ? APP_SESSION_MS() : WEB_SESSION_MS());
  if (!ehApp) setSessionCookie(res, token);
  // O token também volta no corpo pro app mobile, que não guarda cookies HttpOnly.
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
