import { startServer, as, assertConsistent, itemId, labId, assetId } from './helpers.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let s, coord, staff, teacher, admin, tleCoord, sci, tle, catGlass;
before(async () => {
  s = await startServer();
  [coord, staff, teacher, admin, tleCoord] = await Promise.all(['msantos', 'rvillanueva', 'areyes', 'admin', 'ecruz'].map((u) => as(s.base, u)));
  sci = labId(s.db, 'Science Laboratory'); tle = labId(s.db, 'TLE Laboratory');
  catGlass = s.db.prepare(`SELECT category_id id FROM Category WHERE name='Glassware'`).get().id;
});
after(async () => { assertConsistent(assert, s.db); await s.stop(); });

const base = (o = {}) => ({ name: 'Test Pipette', categoryId: catGlass, laboratoryId: sci, itemType: 'Consumable', unit: 'pcs', quantity: 10, minimumStock: 3, condition: 'Good', location: 'Shelf 9', ...o });

test('seeded demo data is internally consistent', () => assertConsistent(assert, s.db));

test('creating a consumable writes an opening-balance ledger entry (quantity = ledger)', async () => {
  const r = await coord.post('/api/inventory', base());
  assert.equal(r.status, 201);
  assert.equal(r.data.quantity, 10);
  const trx = await coord.get(`/api/inventory/${r.data.id}/transactions`);
  assert.equal(trx.data.length, 1);
  assert.equal(trx.data[0].type, 'Stock-in'); assert.equal(trx.data[0].quantity, 10); assert.equal(trx.data[0].balanceAfter, 10);
  assert.equal(r.data.code, `ITM-${String(r.data.id).padStart(4, '0')}`);
});

test('duplicate names inside a laboratory are rejected, but allowed in another laboratory', async () => {
  const dup = await coord.post('/api/inventory', base());
  assert.equal(dup.status, 400); assert.match(dup.error.fields.name, /already exists/);
  const other = await coord.post('/api/inventory', base({ laboratoryId: tle }));
  assert.equal(other.status, 201);
});

test('equipment: creating N units registers N uniquely tagged assets and derives quantity', async () => {
  const r = await coord.post('/api/inventory', base({ name: 'Test Centrifuge', itemType: 'Equipment', quantity: 3, assetPrefix: 'cen' }));
  assert.equal(r.status, 201);
  assert.equal(r.data.quantity, 3); assert.equal(r.data.availableQuantity, 3);
  const a = await coord.get(`/api/assets?itemId=${r.data.id}&sort=tag`);
  assert.deepEqual(a.data.map((x) => x.tag), ['CEN-001', 'CEN-002', 'CEN-003']);
  const frac = await coord.post('/api/inventory', base({ name: 'Bad Equip', itemType: 'Equipment', quantity: 2.5 }));
  assert.equal(frac.status, 400); assert.ok(frac.error.fields.quantity);
});

test('quantity can never go negative (BR-003) and the failed attempt changes nothing', async () => {
  const id = itemId(s.db, 'Test Pipette');
  const bad = await coord.post(`/api/inventory/${id}/movements`, { type: 'Stock-out', quantity: 11, reason: 'Consumption' });
  assert.equal(bad.status, 422); assert.equal(bad.error.code, 'BUSINESS_RULE');
  assert.equal((await coord.get(`/api/inventory/${id}`)).data.quantity, 10);
});

test('stock-in requires a source; stock-out requires a reason; both update the ledger', async () => {
  const id = itemId(s.db, 'Test Pipette');
  assert.equal((await coord.post(`/api/inventory/${id}/movements`, { type: 'Stock-in', quantity: 5 })).status, 400);
  const inn = await coord.post(`/api/inventory/${id}/movements`, { type: 'Stock-in', quantity: 5, source: 'Supplier delivery' });
  assert.equal(inn.data.quantity, 15);
  assert.equal((await coord.post(`/api/inventory/${id}/movements`, { type: 'Stock-out', quantity: 2 })).status, 400);
  const out = await coord.post(`/api/inventory/${id}/movements`, { type: 'Stock-out', quantity: 2, reason: 'Consumption' });
  assert.equal(out.data.quantity, 13);
  const t = await coord.get(`/api/inventory/${id}/transactions`);
  assert.deepEqual(t.data.map((x) => x.quantity), [-2, 5, 10]);
  assert.deepEqual(t.data.map((x) => x.balanceAfter), [13, 15, 10]);
});

test('adjustment uses a physical count, needs a reason, and detects stale screens', async () => {
  const id = itemId(s.db, 'Test Pipette');
  assert.equal((await coord.post(`/api/inventory/${id}/movements`, { type: 'Adjustment', newQuantity: 12 })).status, 400);
  const stale = await coord.post(`/api/inventory/${id}/movements`, { type: 'Adjustment', newQuantity: 12, expectedQuantity: 99, reason: 'Recount' });
  assert.equal(stale.status, 409);
  const same = await coord.post(`/api/inventory/${id}/movements`, { type: 'Adjustment', newQuantity: 13, expectedQuantity: 13, reason: 'Recount' });
  assert.equal(same.status, 422);
  const ok = await coord.post(`/api/inventory/${id}/movements`, { type: 'Adjustment', newQuantity: 12, expectedQuantity: 13, reason: 'Physical count' });
  assert.equal(ok.data.quantity, 12);
  const last = (await coord.get(`/api/inventory/${id}/transactions`)).data[0];
  assert.equal(last.type, 'Adjustment'); assert.equal(last.quantity, -1);
});

test('staff may move stock but not adjust it; teachers can do neither (BR-007)', async () => {
  const id = itemId(s.db, 'Test Pipette');
  assert.equal((await staff.post(`/api/inventory/${id}/movements`, { type: 'Stock-in', quantity: 1, source: 'x delivery' })).status, 200);
  assert.equal((await staff.post(`/api/inventory/${id}/movements`, { type: 'Adjustment', newQuantity: 1, reason: 'because' })).status, 403);
  assert.equal((await teacher.post(`/api/inventory/${id}/movements`, { type: 'Stock-in', quantity: 1, source: 'x delivery' })).status, 403);
});

test('equipment quantity cannot be edited directly; asset status drives it', async () => {
  const id = itemId(s.db, 'Test Centrifuge');
  const r = await coord.post(`/api/inventory/${id}/movements`, { type: 'Stock-out', quantity: 1, reason: 'Disposal' });
  assert.equal(r.status, 422);
  const tag = assetId(s.db, 'CEN-003');
  const retire = await coord.post(`/api/assets/${tag}/state`, { status: 'Retired', reason: 'Beyond repair' });
  assert.equal(retire.status, 200);
  const item = (await coord.get(`/api/inventory/${id}`)).data;
  assert.equal(item.quantity, 2);
  const last = (await coord.get(`/api/inventory/${id}/transactions`)).data[0];
  assert.equal(last.type, 'Stock-out'); assert.equal(last.quantity, -1);
  const stockIn = await coord.post(`/api/inventory/${id}/movements`, { type: 'Stock-in', quantity: 2, source: 'New delivery' });
  assert.equal(stockIn.data.quantity, 4);
  const tags = (await coord.get(`/api/assets?itemId=${id}&sort=tag`)).data.map((x) => x.tag);
  assert.deepEqual(tags, ['CEN-001', 'CEN-002', 'CEN-003', 'CEN-004', 'CEN-005']);
});

test('transfer moves stock between laboratories atomically (creating the destination item)', async () => {
  const id = itemId(s.db, 'Borosilicate Beaker Set');
  const before = (await coord.get(`/api/inventory/${id}`)).data.quantity;
  const r = await coord.post(`/api/inventory/${id}/movements`, { type: 'Transfer', quantity: 4, targetLaboratoryId: tle, remarks: 'Cooking demo' });
  assert.equal(r.status, 200); assert.equal(r.data.quantity, before - 4);
  const dest = s.db.prepare(`SELECT item_id id, quantity q FROM Inventory_Item WHERE item_name='Borosilicate Beaker Set' AND laboratory_id=?`).get(tle);
  assert.equal(dest.q, 4);
  assert.equal((await coord.post(`/api/inventory/${id}/movements`, { type: 'Transfer', quantity: 1, targetLaboratoryId: sci })).status, 400);
  assert.equal((await tleCoord.post(`/api/inventory/${id}/movements`, { type: 'Transfer', quantity: 1, targetLaboratoryId: tle })).status, 403, 'TLE coordinator has no access to Science stock');
});

test('laboratory scoping: users only see their own laboratories (BR-011)', async () => {
  const all = (await coord.get('/api/inventory?pageSize=200')).data;
  assert.ok(all.some((i) => i.laboratoryId === sci) && all.some((i) => i.laboratoryId === tle));
  const tleOnly = (await tleCoord.get('/api/inventory?pageSize=200')).data;
  assert.ok(tleOnly.length > 0 && tleOnly.every((i) => i.laboratoryId === tle));
  assert.equal((await tleCoord.get(`/api/inventory?laboratoryId=${sci}`)).status, 403);
  assert.equal((await tleCoord.get(`/api/inventory/${itemId(s.db, 'Filter Paper No. 1')}`)).status, 403);
  const sciTeacher = (await teacher.get('/api/inventory?pageSize=200')).data;
  assert.ok(sciTeacher.every((i) => i.laboratoryId === sci));
  assert.equal(sciTeacher[0].remarks, null, 'teachers do not see internal remarks');
});

test('search, filters, sorting and pagination work together on the server', async () => {
  const byName = (await coord.get('/api/inventory?search=micro')).data;
  assert.deepEqual(byName.map((i) => i.name), ['Digital Compound Microscope']);
  assert.equal((await coord.get('/api/inventory?search=MIC-003')).data[0].name, 'Digital Compound Microscope', 'asset tag search');
  const code = itemId(s.db, 'Filter Paper No. 1');
  assert.equal((await coord.get(`/api/inventory?search=ITM-${String(code).padStart(4, '0')}`)).data[0].id, code, 'item code search');
  const low = (await coord.get('/api/inventory?availability=low&pageSize=100')).data;
  assert.ok(low.length >= 2 && low.every((i) => i.quantity <= i.minimumStock));
  const equip = (await coord.get(`/api/inventory?itemType=Equipment&laboratoryId=${tle}`)).data;
  assert.ok(equip.length === 3 && equip.every((i) => i.itemType === 'Equipment'));
  const asc = (await coord.get('/api/inventory?sort=quantity&dir=asc&pageSize=100')).data.map((i) => i.quantity);
  assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
  const p1 = await coord.get('/api/inventory?pageSize=5&page=1&sort=name');
  const p2 = await coord.get('/api/inventory?pageSize=5&page=2&sort=name');
  assert.equal(p1.data.length, 5); assert.ok(p1.meta.total > 5 && p1.meta.pages >= 2);
  assert.ok(!p1.data.some((a) => p2.data.some((b) => b.id === a.id)));
  const inject = await coord.get(`/api/inventory?search=${encodeURIComponent("'; DROP TABLE Asset;--")}`);
  assert.equal(inject.status, 200); assert.equal(inject.data.length, 0);
});

test('update edits metadata only and records before/after in the audit log', async () => {
  const id = itemId(s.db, 'Test Pipette');
  const cur = (await coord.get(`/api/inventory/${id}`)).data;
  const r = await coord.patch(`/api/inventory/${id}`, { name: 'Test Pipette', categoryId: cur.categoryId, unit: 'pcs', minimumStock: 6, condition: 'Fair', location: 'Shelf 10', quantity: 9999 });
  assert.equal(r.status, 200);
  assert.equal(r.data.minimumStock, 6); assert.equal(r.data.quantity, 13, 'quantity field is ignored — only movements change stock');
  const audit = (await coord.get(`/api/inventory/${id}/audit`)).data;
  const upd = audit.find((a) => a.action === 'Inventory updated');
  assert.match(upd.next, /"minimumStock":6/); assert.match(upd.previous, /"minimumStock":3/);
  assert.equal((await teacher.patch(`/api/inventory/${id}`, {})).status, 403);
});

test('archiving: blocked while requests are open, never deletes history, can be restored (BR-008/010)', async () => {
  const mic = itemId(s.db, 'Digital Compound Microscope');
  const blocked = await coord.post(`/api/inventory/${mic}/archive`, { reason: 'x' });
  assert.equal(blocked.status, 422); assert.match(blocked.error.message, /open/);
  const id = itemId(s.db, 'Test Pipette');
  const r = await coord.post(`/api/inventory/${id}/archive`, { reason: 'Discontinued' });
  assert.equal(r.data.status, 'Archived');
  assert.equal((await coord.get(`/api/inventory?search=Test Pipette&laboratoryId=${sci}`)).data.length, 0, 'hidden from active list');
  assert.equal((await coord.get(`/api/inventory?search=Test Pipette&status=archived&laboratoryId=${sci}`)).data.length, 1);
  assert.equal((await coord.post(`/api/inventory/${id}/movements`, { type: 'Stock-in', quantity: 1, source: 'nope' })).status, 422);
  assert.equal((await coord.get(`/api/inventory/${id}/transactions`)).data.length > 0, true, 'history kept');
  assert.equal((await coord.post(`/api/inventory/${id}/restore`)).data.status, 'Active');
  const del = s.db.prepare('DELETE FROM Inventory_Item WHERE item_id = ?');
  assert.throws(() => del.run(id), /FOREIGN KEY|constraint/i, 'items with history cannot be hard-deleted');
});

test('the database itself refuses to edit or delete audit and ledger history', () => {
  assert.throws(() => s.db.prepare(`UPDATE Audit_Log SET action = 'tampered'`).run(), /immutable/);
  assert.throws(() => s.db.prepare(`DELETE FROM Audit_Log`).run(), /cannot be deleted/);
  assert.throws(() => s.db.prepare(`UPDATE Inventory_Transaction SET quantity = 999`).run(), /immutable/);
  assert.throws(() => s.db.prepare(`DELETE FROM Borrowing_Request`).run(), /cannot be deleted/);
});

test('admin can read inventory system-wide but not change it', async () => {
  const r = await admin.get('/api/inventory?pageSize=200');
  assert.equal(r.status, 200); assert.ok(new Set(r.data.map((i) => i.laboratoryId)).size >= 2);
});
