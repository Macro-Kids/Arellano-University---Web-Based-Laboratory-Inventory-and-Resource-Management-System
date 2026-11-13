import { startServer, as, assertConsistent, itemId, labId, assetId, getDb } from './helpers.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

let s, coord, staff, teacher, admin, tleCoord, sci, tle;
before(async () => {
  s = await startServer();
  [coord, staff, teacher, admin, tleCoord] = await Promise.all(['msantos', 'rvillanueva', 'areyes', 'admin', 'ecruz'].map((u) => as(s.base, u)));
  sci = labId(s.db, 'Science Laboratory'); tle = labId(s.db, 'TLE Laboratory');
});
after(async () => { assertConsistent(assert, s.db); await s.stop(); });
const st = (tag) => s.db.prepare('SELECT status, "condition" c FROM Asset WHERE asset_tag = ?').get(tag);

test('maintenance: logging takes the asset offline; completing restores it with a new condition (UC-012)', async () => {
  const id = assetId(s.db, 'MIC-006');
  const m = await staff.post('/api/maintenance', { assetId: id, reportedIssue: 'Focus knob stuck', responsiblePerson: 'R. Villanueva' });
  assert.equal(m.status, 201); assert.equal(st('MIC-006').status, 'Under Maintenance');
  assert.equal((await staff.post('/api/maintenance', { assetId: id, reportedIssue: 'again', responsiblePerson: 'x' })).status, 422, 'one open record per asset');
  assert.equal((await staff.post(`/api/assets/${id}/state`, { status: 'Available', reason: 'skip it' })).status, 422, 'cannot bypass maintenance by hand');
  const prog = await staff.patch(`/api/maintenance/${m.data.id}`, { status: 'In Progress', responsiblePerson: 'Vendor', maintenanceAction: 'Ordered part' });
  assert.equal(prog.data.status, 'In Progress');
  const bad = await staff.post(`/api/maintenance/${m.data.id}/complete`, { maintenanceAction: 'Failed repair', resultCondition: 'Non-functional', resultStatus: 'Available' });
  assert.equal(bad.status, 422);
  const done = await staff.post(`/api/maintenance/${m.data.id}/complete`, { maintenanceAction: 'Replaced focus assembly', resultCondition: 'Good', resultStatus: 'Available' });
  assert.equal(done.data.status, 'Completed'); assert.ok(done.data.dateCompleted);
  assert.deepEqual(st('MIC-006'), { status: 'Available', c: 'Good' });
  assert.equal((await staff.patch(`/api/maintenance/${m.data.id}`, { status: 'Open', responsiblePerson: 'x' })).status, 422, 'completed is final');
  const hist = (await coord.get(`/api/assets/${id}`)).data.history;
  assert.equal(hist.maintenance.length, 1); assert.ok(hist.audit.length >= 3);
  assert.equal((await teacher.post('/api/maintenance', { assetId: id, reportedIssue: 'x y z', responsiblePerson: 'x' })).status, 403);
  assert.equal((await tleCoord.post('/api/maintenance', { assetId: id, reportedIssue: 'x y z', responsiblePerson: 'x' })).status, 403, 'other lab');
});

test('damage / loss of an asset: Damage → Damaged, Loss → Lost + ledger stock-out; borrowed units refused (UC-012)', async () => {
  const mic = itemId(s.db, 'Digital Compound Microscope');
  const before = (await coord.get(`/api/inventory/${mic}`)).data.quantity;
  const d = await staff.post('/api/damage-loss', { assetId: assetId(s.db, 'MIC-007'), recordType: 'Damage', description: 'Dropped lens', currentCondition: 'Damaged' });
  assert.equal(d.status, 201); assert.deepEqual(st('MIC-007'), { status: 'Damaged', c: 'Damaged' });
  assert.equal((await staff.post(`/api/assets/${assetId(s.db, 'MIC-007')}/state`, { status: 'Available', reason: 'looks fine' })).status, 422, 'damaged cannot become Available');
  const l = await staff.post('/api/damage-loss', { assetId: assetId(s.db, 'MIC-008'), recordType: 'Loss', description: 'Missing after fieldtrip' });
  assert.equal(l.status, 201); assert.equal(st('MIC-008').status, 'Lost');
  assert.equal((await coord.get(`/api/inventory/${mic}`)).data.quantity, before - 1);
  assert.equal((await staff.post('/api/damage-loss', { assetId: assetId(s.db, 'MIC-001'), recordType: 'Loss', description: 'borrowed unit' })).status, 422);
  assert.equal((await staff.post('/api/damage-loss', { recordType: 'Loss', description: 'nothing selected' })).status, 400);
  // found again
  assert.equal((await coord.post(`/api/assets/${assetId(s.db, 'MIC-008')}/state`, { status: 'Under Inspection', reason: 'Found in storage' })).status, 200);
  assert.equal((await coord.get(`/api/inventory/${mic}`)).data.quantity, before);
});

test('bulk damage via stock-out reason Damage creates a record and deducts stock', async () => {
  const gl = itemId(s.db, 'Borosilicate Beaker Set');
  const q = (await coord.get(`/api/inventory/${gl}`)).data.quantity;
  const r = await coord.post(`/api/inventory/${gl}/movements`, { type: 'Stock-out', quantity: 2, reason: 'Damage', remarks: 'Cracked during cleaning' });
  assert.equal(r.data.quantity, q - 2);
  assert.ok((await coord.get('/api/damage-loss?type=Damage')).data.some((x) => x.itemId === gl && x.quantity === 2));
});

test('asset register: unique tags (BR-002), serial numbers, only for equipment', async () => {
  const mic = itemId(s.db, 'Digital Compound Microscope');
  const dup = await coord.post('/api/assets', { itemId: mic, assetTag: 'mic-001' });
  assert.equal(dup.status, 400); assert.match(dup.error.fields.assetTag, /already exists/);
  const ok = await coord.post('/api/assets', { itemId: mic, assetTag: 'MIC-900', serialNumber: 'SN-9', condition: 'Excellent' });
  assert.equal(ok.status, 201); assert.equal(ok.data.serialNumber, 'SN-9');
  assert.equal((await coord.post('/api/assets', { itemId: itemId(s.db, 'Safety Goggles') })).status, 400, 'consumables have no assets');
  assert.equal((await staff.post('/api/assets', { itemId: mic })).status, 403, 'staff cannot register assets');
  const auto = await coord.post('/api/assets', { itemId: mic });
  assert.match(auto.data.tag, /^MIC-9\d\d$|^MIC-\d{3}$/);
  assert.equal((await coord.post(`/api/assets/${ok.data.id}/state`, { status: 'Borrowed', reason: 'cheating' })).status, 422);
  assert.equal((await coord.post(`/api/assets/${ok.data.id}/state`, { status: 'Retired' })).status, 400, 'reason required');
});

test('reports: four types as JSON and CSV, scoped, with CSV-injection protection (UC-013)', async () => {
  for (const t of ['inventory', 'borrowing', 'equipment', 'movements']) {
    const r = await coord.get(`/api/reports/${t}`);
    assert.equal(r.status, 200, t); assert.ok(r.data.columns.length > 3 && r.data.rows.length > 0, t);
    const csv = await coord.get(`/api/reports/${t}?format=csv`);
    assert.match(csv.headers.get('content-type'), /text\/csv/); assert.ok(csv.text.split('\r\n').length > 2);
  }
  assert.ok((await tleCoord.get('/api/reports/inventory')).data.rows.every((r) => r.laboratory === 'TLE Laboratory'));
  assert.equal((await tleCoord.get(`/api/reports/inventory?laboratoryId=${sci}`)).status, 403);
  assert.equal((await teacher.get('/api/reports/inventory')).status, 403);
  assert.equal((await coord.get('/api/reports/bogus')).status, 404);
  const mov = (await coord.get(`/api/reports/movements?type=Stock-in&from=2000-01-01&to=2100-01-01`)).data;
  assert.ok(mov.rows.every((r) => r.type === 'Stock-in'));
  await coord.post('/api/inventory', { name: '=HYPERLINK("http://evil")', categoryId: 1, laboratoryId: sci, itemType: 'Consumable', unit: 'u', quantity: 1, minimumStock: 0, location: 'x' });
  const csv = (await coord.get('/api/reports/inventory?format=csv')).text;
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"")"`), 'formula cell neutralised');
});

test('audit trail: scoped, filterable, exportable, and records before/after (UC-014)', async () => {
  const all = await admin.get('/api/audit?pageSize=100');
  assert.ok(all.meta.total > 20 && all.data[0].summary !== undefined);
  assert.ok(all.data.every((a, i, arr) => i === 0 || arr[i - 1].id > a.id), 'newest first');
  const logins = (await admin.get('/api/audit?action=Login')).data;
  assert.ok(logins.length > 0 && logins.every((a) => a.action === 'Login'));
  assert.ok((await tleCoord.get('/api/audit?pageSize=200')).data.every((a) => a.laboratoryId === tle || a.laboratoryId === null || a.userName === 'Elena Cruz'));
  const adj = (await coord.get('/api/audit?search=Stock')).data;
  assert.ok(adj.length > 0);
  const csv = await admin.get('/api/audit/export.csv');
  assert.match(csv.headers.get('content-disposition'), /au-lab-audit\.csv/);
  assert.equal((await teacher.get('/api/audit')).status, 403);
  assert.equal((await admin.patch('/api/audit/1', {})).status, 404, 'no write API exists');
  const facets = (await admin.get('/api/audit/facets')).data;
  assert.ok(facets.entities.includes('Borrowing Request') && facets.actions.includes('Request approved'));
});

test('dashboards are role-based and scoped (UC-015)', async () => {
  const c = (await coord.get('/api/dashboard')).data;
  assert.equal(c.kind, 'laboratory'); assert.equal(c.readiness.length, 2);
  assert.ok(c.metrics.pendingRequests >= 1 && c.metrics.overdueReturns >= 1 && c.metrics.lowStock >= 2);
  assert.ok(c.attention.some((a) => a.type === 'overdue') && c.recentActivity.length > 0);
  const one = (await coord.get(`/api/dashboard?laboratoryId=${tle}`)).data;
  assert.equal(one.readiness.length, 1); assert.ok(one.metrics.totalItems < c.metrics.totalItems);
  assert.equal((await tleCoord.get(`/api/dashboard?laboratoryId=${sci}`)).status, 403);
  const a = (await admin.get('/api/dashboard')).data;
  assert.equal(a.kind, 'school'); assert.equal(a.metrics.totalItems, c.metrics.totalItems);
  const t = (await teacher.get('/api/dashboard')).data;
  assert.equal(t.kind, 'personal'); assert.ok(t.metrics.myOpen >= 0); assert.equal(t.readiness, undefined);
});

test('user administration: create, temp password, role/lab rules, last-admin protection (UC-002)', async () => {
  const sciId = sci;
  const bad = await admin.post('/api/users', { username: 'new.teacher', firstName: 'New', lastName: 'Teacher', roleId: 4, laboratoryIds: [] });
  assert.equal(bad.status, 400); assert.ok(bad.error.fields.laboratoryIds);
  const mk = await admin.post('/api/users', { username: 'new.teacher', firstName: 'New', lastName: 'Teacher', email: 'n@t.ph', roleId: 4, laboratoryIds: [sciId] });
  assert.equal(mk.status, 201); assert.ok(mk.data.temporaryPassword.length >= 12);
  assert.equal((await admin.post('/api/users', { username: 'NEW.teacher', firstName: 'A', lastName: 'B', roleId: 4, laboratoryIds: [sciId] })).status, 400, 'username unique, case-insensitive');
  const fresh = await as(s.base, 'new.teacher').catch(() => null);
  assert.equal(fresh, null, 'temp password differs from demo password');
  const { Client } = await import('./helpers.js');
  const c = new Client(s.base);
  assert.equal((await c.login('new.teacher', mk.data.temporaryPassword)).status, 200);
  const reset = await admin.post(`/api/users/${mk.data.user.id}/reset-password`, { password: 'Chosen-Pass-77' });
  assert.equal(reset.status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 401, 'old sessions ended');
  assert.equal((await new Client(s.base).login('new.teacher', 'Chosen-Pass-77')).status, 200);
  const adminId = s.db.prepare(`SELECT user_id id FROM "User" WHERE username='admin'`).get().id;
  assert.match((await admin.post(`/api/users/${adminId}/status`, { status: 'Inactive' })).error.message, /own account|At least one/);
  assert.equal((await admin.patch(`/api/users/${adminId}`, { firstName: 'R', lastName: 'B', roleId: 2, laboratoryIds: [sciId] })).status, 422, 'last admin cannot be demoted');
  const list = await admin.get('/api/users?search=teacher&status=Active');
  assert.ok(list.data.some((u) => u.username === 'new.teacher') && !list.data.some((u) => u.username === 'system'));
  assert.equal(JSON.stringify(list.body).includes('password'), false, 'no password material in API output');
});

test('laboratories and categories are manageable data (UC-003, FR-007)', async () => {
  const lab = await admin.post('/api/laboratories', { name: 'Agriculture Laboratory', type: 'Agriculture', location: 'Annex' });
  assert.equal(lab.status, 201); assert.equal(lab.data.code, `LAB-${String(lab.data.id).padStart(3, '0')}`);
  assert.equal((await admin.post('/api/laboratories', { name: 'agriculture laboratory', type: 'x' })).status, 400);
  assert.equal((await coord.post('/api/laboratories', { name: 'Nope', type: 'x' })).status, 403);
  assert.equal((await admin.patch(`/api/laboratories/${lab.data.id}`, { name: 'Agriculture Lab', type: 'Agriculture', status: 'Inactive' })).data.status, 'Inactive');
  assert.equal((await coord.get('/api/laboratories')).data.length, 2, 'coordinator sees only assigned labs');
  assert.ok((await admin.get('/api/laboratories')).data.length >= 3);
  const cat = await admin.post('/api/categories', { name: 'Optics' });
  assert.equal(cat.status, 201);
  assert.equal((await coord.post('/api/categories', { name: 'Other' })).status, 403);
  assert.equal((await admin.post('/api/categories', { name: 'optics' })).status, 400);
  assert.ok((await teacher.get('/api/categories')).data.some((c) => c.name === 'Optics'));
});

test('system: health is public; diagnostics, integrity and verified backups are admin-only', async () => {
  const health = await fetch(`${s.base}/api/system/health`);
  assert.equal((await health.json()).status, 'ok');
  assert.equal((await coord.get('/api/system/diagnostics')).status, 403);
  const diag = (await admin.get('/api/system/diagnostics')).data;
  assert.ok(diag.database.tables.length >= 18 && diag.database.migrations.applied.length === 1);
  const integ = (await admin.get('/api/system/integrity')).data;
  assert.equal(integ.ok, true, JSON.stringify(integ.issues));
  const b = await admin.post('/api/system/backups');
  assert.equal(b.status, 201); assert.equal(b.data.verified, true); assert.ok(b.data.items > 5);
  assert.equal((await admin.get('/api/system/backups')).data[0].name, b.data.name);
  assert.equal((await admin.get(`/api/system/backups/${b.data.name}/verify`)).data.verified, true);
  assert.equal((await admin.get('/api/system/backups/..%2F..%2Fetc%2Fpasswd/download')).status, 404, 'path traversal blocked');
  const dl = await fetch(`${s.base}/api/system/backups/${b.data.name}/download`, { headers: { Cookie: admin.cookie } });
  assert.equal(dl.status, 200); assert.ok((await dl.arrayBuffer()).byteLength > 10000);
  const logged = await coord.post('/api/system/client-log', { message: 'TypeError: boom', context: 'inventory page' });
  assert.equal(logged.status, 200);
});

test('everything that happened left a consistent database', () => assertConsistent(assert, getDb()));
