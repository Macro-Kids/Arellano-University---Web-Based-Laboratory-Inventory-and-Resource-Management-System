// -----------------------------------------------------------------------------
// backup.js — BRR-001: regular backups, retention, verification, recovery.
//   createBackup()   online, consistent copy (SQLite backup API, safe while serving)
//   verifyBackup()   opens the copy read-only, runs integrity_check, counts core rows
//   pruneBackups()   keeps the newest N (config.backup.retention)
//   startBackupScheduler()  daily (config.backup.intervalHours); also on startup if none today
// Restore: stop the app, then `npm run db:restore -- <file>` (see docs/OPERATIONS.md).
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { createLogger } from '../lib/logger.js';
import { getDb, openDatabase } from './connection.js';

const log = createLogger('backup');
const NAME = /^aulab-\d{8}-\d{6}\.sqlite$/;

export function verifyBackup(file) {
  let db;
  try {
    db = openDatabase(file, { readonly: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    const items = db.prepare('SELECT COUNT(*) n FROM Inventory_Item').get().n;
    const users = db.prepare('SELECT COUNT(*) n FROM "User"').get().n;
    return { verified: integrity === 'ok', integrity, items, users };
  } catch (err) {
    return { verified: false, integrity: String(err.message), items: 0, users: 0 };
  } finally { db?.close(); }
}

export function listBackups() {
  if (!fs.existsSync(config.backupDir)) return [];
  return fs.readdirSync(config.backupDir).filter((f) => NAME.test(f)).sort().reverse().map((name) => {
    const st = fs.statSync(path.join(config.backupDir, name));
    return { name, size: st.size, createdAt: st.mtime.toISOString() };
  });
}
export const backupPath = (name) => (NAME.test(name) ? path.join(config.backupDir, name) : null);

export async function createBackup(reason = 'manual') {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})(\d{6})$/, '$1-$2');
  const name = `aulab-${stamp}.sqlite`;
  const dest = path.join(config.backupDir, name);
  await getDb().backup(dest);
  const check = verifyBackup(dest);
  const removed = pruneBackups();
  log.info('backup created', { name, reason, ...check, pruned: removed.length });
  if (!check.verified) log.error('BACKUP FAILED VERIFICATION', { name, integrity: check.integrity });
  return { name, size: fs.statSync(dest).size, createdAt: new Date().toISOString(), ...check };
}
export function pruneBackups(keep = config.backup.retention) {
  const old = listBackups().slice(keep);
  for (const b of old) fs.rmSync(path.join(config.backupDir, b.name), { force: true });
  return old;
}

let timer = null;
export function startBackupScheduler() {
  if (!config.backup.enabled || timer) return;
  const run = (reason) => createBackup(reason).catch((err) => log.error('scheduled backup failed', { err }));
  const latest = listBackups()[0];
  if (!latest || Date.now() - Date.parse(latest.createdAt) > config.backup.intervalHours * 3600e3) run('startup');
  timer = setInterval(() => run('scheduled'), config.backup.intervalHours * 3600e3);
  timer.unref();
}
export function stopBackupScheduler() { if (timer) clearInterval(timer); timer = null; }
