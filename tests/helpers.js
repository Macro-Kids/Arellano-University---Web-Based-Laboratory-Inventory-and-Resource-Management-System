// -----------------------------------------------------------------------------
// tests/helpers.js — boots the REAL app on a random port with a throw-away
// database (seeded with the demo data) and gives tests a cookie+CSRF-aware client.
// Import this file FIRST in every test file (it sets env vars before config loads).
// -----------------------------------------------------------------------------
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aulab-test-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(dir, 'test.sqlite');
process.env.BACKUP_DIR = path.join(dir, 'backups');
process.env.LOG_DIR = path.join(dir, 'logs');
process.env.SEED_DEMO = '1';
process.env.SHOW_DEMO_LOGINS = '1';
process.env.BACKUP_ENABLED = '0';
process.env.LOGIN_MAX_FAILURES = '5';

const { prepareDatabase } = await import('../server/index.js');
const { createApp } = await import('../server/app.js');
const { getDb, closeDb } = await import('../server/db/connection.js');
const { checkIntegrity } = await import('../server/db/integrity.js');
const { throttle } = await import('../server/modules/auth/service.js');

export const PASSWORD = 'Demo@2026';
export { getDb, checkIntegrity, throttle };

export async function startServer() {
  prepareDatabase();
  const app = createApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    db: getDb(),
    async stop() { await new Promise((r) => server.close(r)); closeDb(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

export class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = ''; }
  async request(method, url, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.csrf && method !== 'GET') headers['X-CSRF-Token'] = this.csrf;
    const res = await fetch(this.base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) { const [pair] = c.split(';'); if (pair.startsWith('aulab_sid=')) this.cookie = pair.endsWith('=') ? '' : pair; }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* csv etc */ }
    return { status: res.status, body: json, text, headers: res.headers, data: json?.data, error: json?.error, meta: json?.meta };
  }
  get(url) { return this.request('GET', url); }
  post(url, body = {}) { return this.request('POST', url, body); }
  patch(url, body = {}) { return this.request('PATCH', url, body); }
  async login(username, password = PASSWORD) {
    const r = await this.request('POST', '/api/auth/login', { identifier: username, password });
    if (r.status === 200) this.csrf = r.data.csrfToken;
    return r;
  }
}
export async function as(base, username) { const c = new Client(base); const r = await c.login(username); if (r.status !== 200) throw new Error(`login ${username} failed: ${JSON.stringify(r.body)}`); return c; }

/** Fail the test if the database invariants are broken. */
export function assertConsistent(assert, db) {
  const r = checkIntegrity(db);
  assert.equal(r.ok, true, 'integrity problems:\n' + r.issues.map((i) => ` - ${i.message}`).join('\n'));
}
export const idOf = (db, table, col, where, ...p) => db.prepare(`SELECT ${col} id FROM ${table} WHERE ${where}`).get(...p)?.id;
export const itemId = (db, name) => idOf(db, 'Inventory_Item', 'item_id', 'item_name = ?', name);
export const assetId = (db, tag) => idOf(db, 'Asset', 'asset_id', 'asset_tag = ?', tag);
export const labId = (db, name) => idOf(db, 'Laboratory', 'laboratory_id', 'name = ?', name);
export const tomorrow = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 2); return d.toISOString().slice(0, 10); };
