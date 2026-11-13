// -----------------------------------------------------------------------------
// migrate.js — applies server/db/migrations/NNN_name.sql in order, once each.
// To change the schema: add a NEW file (e.g. 002_add_something.sql). Never edit
// an applied migration. Each file runs in its own transaction: all or nothing.
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../lib/logger.js';

const log = createLogger('migrate');
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function listMigrations() {
  return fs.readdirSync(DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
    .map((f) => ({ version: Number.parseInt(f, 10), name: f, file: path.join(DIR, f) }));
}

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at DATETIME NOT NULL)`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const done = [];
  for (const m of listMigrations()) {
    if (applied.has(m.version)) continue;
    log.info('applying migration', { name: m.name });
    const sql = fs.readFileSync(m.file, 'utf8');
    try {
      db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)').run(m.version, m.name, new Date().toISOString());
      })();
      done.push(m.name);
    } catch (err) {
      log.error('migration failed — database left unchanged', { name: m.name, err });
      throw new Error(`Migration ${m.name} failed: ${err.message}`);
    }
  }
  return { applied: done, current: db.prepare('SELECT MAX(version) v FROM schema_migrations').get().v };
}
