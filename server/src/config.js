import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3001),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 10000),
  systemPollIntervalMs: Number(process.env.SYSTEM_POLL_INTERVAL_MS || 60000),
  retentionDays: Number(process.env.RETENTION_DAYS || 30),
  dbPath: process.env.DB_PATH || path.join(__dirname, '../data/monitor.db'),
  webhookUrl: process.env.WEBHOOK_URL || '',
  webhookNotifyClients: String(process.env.WEBHOOK_NOTIFY_CLIENTS || '').toLowerCase() === 'true',
  outageAlert: {
    threshold: Number(process.env.OUTAGE_ALERT_THRESHOLD || 3),
    windowMinutes: Number(process.env.OUTAGE_ALERT_WINDOW_MINUTES || 5),
    cooldownMinutes: Number(process.env.OUTAGE_ALERT_COOLDOWN_MINUTES || 30),
  },
  mikrotik: {
    host: process.env.MIKROTIK_HOST || '192.168.88.1',
    port: Number(process.env.MIKROTIK_PORT || 8728),
    user: process.env.MIKROTIK_USER || 'monitor',
    password: process.env.MIKROTIK_PASSWORD || '',
    timeout: Number(process.env.MIKROTIK_TIMEOUT_MS || 15000),
  },
  auth: {
    user: process.env.AUTH_USER || 'admin',
    password: process.env.AUTH_PASSWORD || '',
    secret: process.env.AUTH_SECRET || '',
    sessionHours: Number(process.env.AUTH_SESSION_HOURS || 12),
  },
};
