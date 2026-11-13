import { startServer, Client, as, getDb, throttle, PASSWORD } from './helpers.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let s;
before(async () => { s = await startServer(); });
after(async () => { await s.stop(); });

test('login succeeds with username or email and sets an HttpOnly, SameSite cookie', async () => {
  const c = new Client(s.base);
  const r = await c.login('msantos');
  assert.equal(r.status, 200);
  assert.equal(r.data.user.roleName, 'Laboratory Coordinator');
  assert.ok(r.data.csrfToken.length > 20);
  const cookie = r.headers.getSetCookie().find((x) => x.startsWith('aulab_sid='));
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i);
  const c2 = new Client(s.base);
  assert.equal((await c2.login('maria.santos@arellano.edu.ph')).status, 200);
});

test('wrong password and unknown user give the same generic 401 (no user enumeration)', async () => {
  const c = new Client(s.base);
  const a = await c.login('msantos', 'nope-nope1');
  const b = await c.login('ghost-user', 'nope-nope1');
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.equal(a.error.message, b.error.message);
  assert.equal(a.error.code, 'UNAUTHENTICATED');
});

test('passwords are stored hashed, never in plain text (SR-001)', () => {
  const rows = getDb().prepare('SELECT password_hash h FROM "User"').all();
  for (const { h } of rows) assert.ok(h.startsWith('scrypt$') || h === '!disabled', 'unexpected hash format');
  assert.ok(!rows.some((r) => r.h.includes(PASSWORD)));
});

test('protected endpoints need a session; state changes need the CSRF token', async () => {
  const anon = new Client(s.base);
  assert.equal((await anon.get('/api/inventory')).status, 401);
  const c = await as(s.base, 'msantos');
  assert.equal((await c.get('/api/auth/me')).status, 200);
  const noToken = await fetch(`${s.base}/api/auth/logout`, { method: 'POST', headers: { Cookie: c.cookie } });
  assert.equal(noToken.status, 403);
  const crossSite = await fetch(`${s.base}/api/auth/logout`, { method: 'POST', headers: { Cookie: c.cookie, Origin: 'https://evil.example', 'X-CSRF-Token': c.csrf } });
  assert.equal(crossSite.status, 403);
});

test('logout ends the session server-side', async () => {
  const c = await as(s.base, 'areyes');
  const cookie = c.cookie;
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  const res = await fetch(`${s.base}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 401);
});

test('brute-force throttle locks an identifier after repeated failures (429)', async () => {
  throttle.clear();
  const c = new Client(s.base);
  for (let i = 0; i < 5; i++) assert.equal((await c.login('clim', 'wrong-pass1')).status, 401);
  const blocked = await c.login('clim', PASSWORD);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.error.code, 'RATE_LIMITED');
  throttle.clear();
});

test('a deactivated account cannot sign in, and an active session ends immediately', async () => {
  const admin = await as(s.base, 'admin');
  const victim = await as(s.base, 'ngarcia');
  const uid = getDb().prepare(`SELECT user_id id FROM "User" WHERE username='ngarcia'`).get().id;
  assert.equal((await admin.post(`/api/users/${uid}/status`, { status: 'Inactive' })).status, 200);
  assert.equal((await victim.get('/api/auth/me')).status, 401);
  const again = await new Client(s.base).login('ngarcia');
  assert.equal(again.status, 403);
  await admin.post(`/api/users/${uid}/status`, { status: 'Active' });
});

test('role-based access is enforced on the server (SR-002)', async () => {
  const teacher = await as(s.base, 'areyes');
  assert.equal((await teacher.get('/api/users')).status, 403);
  assert.equal((await teacher.get('/api/audit')).status, 403);
  assert.equal((await teacher.get('/api/reports/inventory')).status, 403);
  assert.equal((await teacher.get('/api/system/diagnostics')).status, 403);
  assert.equal((await teacher.post('/api/inventory', {})).status, 403);
  const coord = await as(s.base, 'msantos');
  assert.equal((await coord.get('/api/users')).status, 403);
  assert.equal((await coord.get('/api/system/integrity')).status, 403);
  const admin = await as(s.base, 'admin');
  assert.equal((await admin.get('/api/users')).status, 200);
  assert.equal((await admin.post('/api/inventory', {})).status, 403, 'administrators do not edit stock (SRS 5.1)');
});

test('change password: verifies current, enforces strength, signs out other sessions', async () => {
  const a = await as(s.base, 'pdizon');
  const b = await as(s.base, 'pdizon');
  const weak = await a.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'short' });
  assert.equal(weak.status, 400); assert.ok(weak.error.fields.newPassword);
  const wrong = await a.post('/api/auth/change-password', { currentPassword: 'x', newPassword: 'Brand-New-9' });
  assert.equal(wrong.status, 400); assert.ok(wrong.error.fields.currentPassword);
  assert.equal((await a.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Brand-New-9' })).status, 200);
  assert.equal((await b.get('/api/auth/me')).status, 401, 'other device signed out');
  assert.equal((await a.get('/api/auth/me')).status, 200, 'current device stays signed in');
  assert.equal((await new Client(s.base).login('pdizon', 'Brand-New-9')).status, 200);
  assert.equal((await new Client(s.base).login('pdizon', PASSWORD)).status, 401);
});

test('validation errors are field-level and friendly (UR-002); bad JSON and unknown routes are clean', async () => {
  const c = await as(s.base, 'msantos');
  const r = await c.post('/api/inventory', { name: '', quantity: -3 });
  assert.equal(r.status, 400); assert.equal(r.error.code, 'VALIDATION_ERROR');
  assert.equal(r.error.fields.name, 'Item name is required.');
  assert.ok(r.error.requestId);
  const bad = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(bad.status, 400); assert.equal((await bad.json()).error.code, 'BAD_JSON');
  assert.equal((await c.get('/api/nope')).status, 404);
});
