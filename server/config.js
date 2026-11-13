// -----------------------------------------------------------------------------
// config.js — the ONLY place that reads process.env.
// Every other module imports `config`. To change behaviour, set an env var or
// edit .env (see .env.example). Nothing here has side effects except loading .env.
// -----------------------------------------------------------------------------
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env if present (Node >= 20.12). Real environment variables always win.
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env file — fine */ }

const env = process.env;
const bool = (v, dflt) => (v === undefined || v === '' ? dflt : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const int = (v, dflt) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : dflt; };
const abs = (p, dflt) => (p ? path.resolve(ROOT, p) : dflt);

const nodeEnv = env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

export const config = Object.freeze({
  root: ROOT,
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  appName: 'AU·LAB Laboratory Inventory',
  version: '1.0.0',

  host: env.HOST || '0.0.0.0',
  port: int(env.PORT, 3000),
  publicDir: path.join(ROOT, 'public'),
  trustProxy: bool(env.TRUST_PROXY, false), // set true when running behind HTTPS reverse proxy

  dbPath: abs(env.DB_PATH, path.join(ROOT, 'data', 'aulab.sqlite')),
  backupDir: abs(env.BACKUP_DIR, path.join(ROOT, 'data', 'backups')),
  logDir: abs(env.LOG_DIR, path.join(ROOT, 'logs')),

  logLevel: env.LOG_LEVEL || (isProd ? 'info' : 'debug'), // error | warn | info | debug
  logToFile: bool(env.LOG_TO_FILE, !nodeEnv.startsWith('test')),
  debugSql: bool(env.DEBUG_SQL, false), // log every SQL statement (very verbose)

  timezone: env.APP_TIMEZONE || 'Asia/Manila',

  session: {
    cookieName: 'aulab_sid',
    ttlHours: int(env.SESSION_TTL_HOURS, 12),
    cookieSecure: bool(env.COOKIE_SECURE, isProd),
  },
  login: {
    maxFailures: int(env.LOGIN_MAX_FAILURES, 5),
    windowMinutes: int(env.LOGIN_WINDOW_MINUTES, 15),
  },

  // First-run data. In production only the admin account is created.
  seedDemo: bool(env.SEED_DEMO, !isProd),
  showDemoLogins: bool(env.SHOW_DEMO_LOGINS, !isProd),
  demoPassword: env.DEMO_PASSWORD || 'Demo@2026',
  adminUsername: env.ADMIN_USERNAME || 'admin',
  adminInitialPassword: env.ADMIN_INITIAL_PASSWORD || '', // empty => generated and printed once

  backup: {
    enabled: bool(env.BACKUP_ENABLED, !nodeEnv.startsWith('test')),
    intervalHours: int(env.BACKUP_INTERVAL_HOURS, 24),
    retention: int(env.BACKUP_RETENTION, 14),
  },
});
