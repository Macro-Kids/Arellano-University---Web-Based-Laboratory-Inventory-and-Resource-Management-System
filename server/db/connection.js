// -----------------------------------------------------------------------------
// connection.js — single SQLite connection for the process (better-sqlite3 is
// synchronous, so one connection + transactions gives us serialised, atomic
// writes with no race conditions — exactly what DIR-001/DIR-002 need).
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('db');
let db = null;

export function openDatabase(file = config.dbPath, { readonly = false } = {}) {
  if (file !== ':memory:' && !readonly) fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file, {
    readonly,
    // DEBUG_SQL=1 prints every statement — invaluable when a query misbehaves.
    verbose: config.debugSql ? (sql) => log.debug('sql', { sql: String(sql).replace(/\s+/g, ' ').slice(0, 300) }) : undefined,
  });
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
  if (!readonly && file !== ':memory:') {
    conn.pragma('journal_mode = WAL');
    conn.pragma('synchronous = NORMAL');
  }
  return conn;
}

/** The shared connection used by every repository. */
export function getDb() {
  if (!db) {
    db = openDatabase();
    log.info('database opened', { file: config.dbPath });
  }
  return db;
}
export function closeDb() {
  if (db) { db.close(); db = null; log.info('database closed'); }
}
/** Run fn inside a transaction on the shared connection (nests safely via savepoints). */
export const inTransaction = (fn) => getDb().transaction(fn)();
