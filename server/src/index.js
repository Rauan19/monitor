import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { startPoller, stopPoller } from './poller/index.js';
import { startSystemPoller, stopSystemPoller } from './poller/system.js';
import { apiRouter } from './routes/api.js';
import { mikrotik } from './mikrotik/client.js';
import { authRouter, requireAuth } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

getDb();

if (!config.auth.password || !config.auth.secret) {
  console.warn(
    '[auth] AUTH_PASSWORD e/ou AUTH_SECRET não definidos no .env — login ficará bloqueado até configurar.'
  );
}

app.use(cors());
app.use(express.json());
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', authRouter);
app.use('/api', requireAuth);
app.use('/api', apiRouter);

const webDist = path.join(__dirname, '../../web/dist');
app.use(express.static(webDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(webDist, 'index.html'), (err) => {
    if (err) next();
  });
});

const server = app.listen(config.port, config.host, () => {
  console.log(`[server] http://${config.host}:${config.port}`);
  startPoller();
  startSystemPoller();
});

async function shutdown() {
  console.log('[server] encerrando...');
  stopPoller();
  stopSystemPoller();
  await mikrotik.disconnect();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
