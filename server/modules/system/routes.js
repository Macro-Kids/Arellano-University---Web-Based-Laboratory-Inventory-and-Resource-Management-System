// -----------------------------------------------------------------------------
// system/routes.js — health, meta, diagnostics, integrity, backups, client error log.
//   /health and /meta are public (no data). Everything else needs a permission.
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import { Router } from 'express';
import { config } from '../../config.js';
import { getDb } from '../../db/connection.js';
import { createBackup, listBackups, backupPath, verifyBackup } from '../../db/backup.js';
import { checkIntegrity } from '../../db/integrity.js';
import { listMigrations } from '../../db/migrate.js';
import { createLogger, recentProblems } from '../../lib/logger.js';
import { send, created } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { z, parse, str, optStr } from '../../lib/validate.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { P } from '../auth/permissions.js';
import { recordAudit } from '../audit/record.js';

export const router = Router();
const log = createLogger('client');
const startedAt = new Date();

router.get('/health', (_req, res) => {
  let dbOk = false;
  try { dbOk = getDb().prepare('SELECT 1 x').get().x === 1; } catch { /* reported below */ }
  res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ok' : 'degraded', database: dbOk ? 'ok' : 'unreachable', uptimeSeconds: Math.round(process.uptime()), version: config.version });
});
router.get('/meta', (_req, res) => send(res, { name: config.appName, version: config.version, demo: config.showDemoLogins, timezone: config.timezone }));

// Front-end errors are shipped here so they appear in the same log as server errors.
const clientLogSchema = z.object({ message: str('message', { max: 500 }), stack: optStr('stack', { max: 3000 }), url: optStr('url', { max: 300 }), context: optStr('context', { max: 300 }) });
router.post('/client-log', requireAuth, (req, res) => {
  const body = parse(clientLogSchema, req.body);
  log.warn('browser error', { ...body, user: req.ctx.user.username, rid: req.ctx.requestId });
  send(res, { ok: true });
});

router.use(requirePermission(P.SYSTEM_MANAGE));

router.get('/diagnostics', (_req, res) => {
  const db = getDb();
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all()
    .map((t) => ({ table: t.name, rows: db.prepare(`SELECT COUNT(*) n FROM "${t.name}"`).get().n }));
  const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  send(res, {
    app: { name: config.appName, version: config.version, env: config.nodeEnv, node: process.version, startedAt, uptimeSeconds: Math.round(process.uptime()), timezone: config.timezone, logLevel: config.logLevel },
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    database: { file: config.dbPath, sizeBytes: size(config.dbPath), walBytes: size(`${config.dbPath}-wal`), sqlite: db.prepare('select sqlite_version() v').get().v,
      migrations: { applied: db.prepare('SELECT version, name, applied_at appliedAt FROM schema_migrations ORDER BY version').all(), available: listMigrations().length }, tables },
    sessions: db.prepare('SELECT COUNT(*) n FROM Session WHERE expires_at > ?').get(new Date().toISOString()).n,
    backups: { dir: config.backupDir, enabled: config.backup.enabled, retention: config.backup.retention, latest: listBackups()[0] ?? null },
    recentProblems: recentProblems().slice(0, 30),
  });
});
router.get('/integrity', (req, res) => {
  const result = checkIntegrity(getDb());
  log.info('integrity check run', { ok: result.ok, issues: result.issues.length, user: req.ctx.user.username });
  send(res, result);
});
router.get('/backups', (_req, res) => send(res, listBackups()));
router.post('/backups', async (req, res) => {
  const b = await createBackup(`manual by ${req.ctx.user.username}`);
  recordAudit(req.ctx, { action: 'Backup created', entity: 'System', next: { file: b.name, verified: b.verified } });
  created(res, b);
});
router.get('/backups/:name/verify', (req, res) => {
  const p = backupPath(req.params.name);
  if (!p || !fs.existsSync(p)) throw notFound('Backup');
  send(res, verifyBackup(p));
});
router.get('/backups/:name/download', (req, res) => {
  const p = backupPath(req.params.name);
  if (!p || !fs.existsSync(p)) throw notFound('Backup');
  recordAudit(req.ctx, { action: 'Backup downloaded', entity: 'System', next: { file: req.params.name } });
  res.download(p, req.params.name);
});
