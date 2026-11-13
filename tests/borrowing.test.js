import { startServer, as, assertConsistent, itemId, labId, assetId, tomorrow } from './helpers.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let s, coord, staff, anna, carla, paulo, admin, sci, tle;
before(async () => {
  s = await startServer();
  [coord, staff, anna, carla, paulo, admin] = await Promise.all(['msantos', 'rvillanueva', 'areyes', 'clim', 'pdizon', 'admin'].map((u) => as(s.base, u)));
  sci = labId(s.db, 'Science Laboratory'); tle = labId(s.db, 'TLE Laboratory');
});
after(async () => { assertConsistent(assert, s.db); await s.stop(); });

const mkReq = (client, o = {}) => client.post('/api/borrowing', { laboratoryId: sci, purpose: 'Biology practical', expectedReturnDate: tomorrow(), items: [{ itemId: itemId(s.db, 'Digital Compound Microscope'), quantity: 2 }], ...o });
const itemQty = (name) => s.db.prepare('SELECT quantity q FROM Inventory_Item WHERE item_name = ?').get(name).q;
const assetStatus = (tag) => s.db.prepare('SELECT status FROM Asset WHERE asset_tag = ?').get(tag).status;

test('teacher creates a request: Pending, correct code, own requester, lab-scoped (UC-008)', async () => {
  const r = await mkReq(anna);
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'Pending');
  assert.match(r.data.code, /^BR-\d{4}-\d{4}$/);
  assert.equal(r.data.requesterName, 'Anna Reyes');
  assert.equal(r.data.items[0].quantity, 2);
});

test('request validation: past date, over-requesting, duplicates, wrong lab, empty list', async () => {
  const mic = itemId(s.db, 'Digital Compound Microscope');
  assert.ok((await mkReq(anna, { expectedReturnDate: '2020-01-01' })).error.fields.expectedReturnDate);
  assert.ok((await mkReq(anna, { items: [{ itemId: mic, quantity: 500 }] })).error.fields['items.0.quantity']);
  assert.ok((await mkReq(anna, { items: [{ itemId: mic, quantity: 1 }, { itemId: mic, quantity: 1 }] })).error.fields['items.1.itemId']);
  assert.ok((await mkReq(anna, { items: [{ itemId: itemId(s.db, 'Soldering Iron 60W'), quantity: 1 }] })).error.fields['items.0.itemId'], 'TLE item in Science request');
  assert.ok((await mkReq(anna, { items: [] })).error.fields.items);
  assert.ok((await mkReq(anna, { items: [{ itemId: mic, quantity: 1.5 }] })).error.fields['items.0.quantity'], 'equipment in whole units');
  assert.equal((await mkReq(anna, { laboratoryId: tle })).status, 403, 'Science teacher cannot request from TLE (BR-011)');
});

test('teachers only see their own requests; coordinators see their laboratories (BR-012)', async () => {
  const mine = (await anna.get('/api/borrowing')).data;
  assert.ok(mine.length > 0 && mine.every((r) => r.requesterName === 'Anna Reyes'));
  const theirs = (await carla.get('/api/borrowing')).data;
  assert.ok(theirs.every((r) => r.requesterName === 'Carla Lim'));
  const otherReq = mine[0].id;
  assert.equal((await carla.get(`/api/borrowing/${otherReq}`)).status, 404);
  assert.ok((await coord.get('/api/borrowing?pageSize=100')).data.length >= mine.length);
});

test('full lifecycle with specific assets: approve → release → return (UC-009/010/011)', async () => {
  const mic = itemId(s.db, 'Digital Compound Microscope');
  const req = (await mkReq(anna, { items: [{ itemId: mic, quantity: 2 }] })).data;

  // cannot release before approval (BR-006)
  assert.equal((await coord.post(`/api/borrowing/${req.id}/release`, { items: [{ requestItemId: req.items[0].id, assetIds: [assetId(s.db, 'MIC-004')] }] })).status, 422);
  // teacher cannot approve; approver cannot approve their own
  assert.equal((await anna.post(`/api/borrowing/${req.id}/approve`, {})).status, 403);
  const ownReq = (await mkReq(coord, { requesterId: undefined })).data;
  assert.match((await coord.post(`/api/borrowing/${ownReq.id}/approve`, {})).error.message, /own request/);
  await coord.post(`/api/borrowing/${ownReq.id}/cancel`, { reason: 'test' });

  const appr = await staff.post(`/api/borrowing/${req.id}/approve`, { reason: 'OK' });
  assert.equal(appr.data.status, 'Approved'); assert.equal(appr.data.approverName, 'Ramon Villanueva');

  // release plan suggests available units only
  const plan = (await coord.get(`/api/borrowing/${req.id}/release-plan`)).data;
  assert.equal(plan[0].suggestedAssetIds.length, 2);
  assert.ok(!plan[0].assets.some((a) => ['MIC-001', 'MIC-002', 'MIC-003'].includes(a.tag)), 'borrowed / maintenance units not offered');

  // BR-005: unit under maintenance cannot be released; Borrowed one neither
  const rel = (ids) => coord.post(`/api/borrowing/${req.id}/release`, { items: [{ requestItemId: req.items[0].id, assetIds: ids }] });
  assert.match((await rel([assetId(s.db, 'MIC-003'), assetId(s.db, 'MIC-004')])).error.message, /under maintenance/);
  assert.match((await rel([assetId(s.db, 'MIC-001')])).error.message, /borrowed/);
  assert.equal((await rel([])).status, 422, 'nothing selected');
  assert.equal(assetStatus('MIC-004'), 'Available', 'failed release changed nothing');

  const ok = await rel([assetId(s.db, 'MIC-004'), assetId(s.db, 'MIC-005')]);
  assert.equal(ok.status, 200); assert.equal(ok.data.status, 'Released');
  assert.equal(assetStatus('MIC-004'), 'Borrowed');
  assert.equal(ok.data.outstanding.length, 2);
  const held = (await coord.get(`/api/assets/${assetId(s.db, 'MIC-004')}`)).data.heldBy;
  assert.equal(held.borrower, 'Anna Reyes'); assert.equal(held.requestCode, undefined); assert.equal(held.requestId, req.id);
  assert.equal((await coord.post(`/api/borrowing/${req.id}/release`, { items: [] })).status, 400);

  // teacher tells the lab she is returning
  assert.equal((await anna.post(`/api/borrowing/${req.id}/confirm-return`)).data.awaitingReturnProcessing, true);
  assert.equal((await anna.post(`/api/borrowing/${req.id}/confirm-return`)).status, 409);

  // return: more than released is refused; one good, one damaged
  const l1 = ok.data.outstanding[0], l2 = ok.data.outstanding[1];
  const tooMuch = await coord.post(`/api/borrowing/${req.id}/return`, { items: [{ itemId: mic, assetId: l1.assetId, returned: 2 }] });
  assert.equal(tooMuch.status, 422);
  const ret = await coord.post(`/api/borrowing/${req.id}/return`, { items: [
    { itemId: mic, assetId: l1.assetId, returned: 1, condition: 'Good' },
    { itemId: mic, assetId: l2.assetId, returned: 1, damaged: 1, condition: 'Damaged', remarks: 'Cracked eyepiece' },
  ] });
  assert.equal(ret.status, 200); assert.equal(ret.data.status, 'Returned');
  assert.equal(assetStatus(l1.assetTag), 'Available');
  assert.equal(assetStatus(l2.assetTag), 'Damaged');
  const dmg = (await coord.get(`/api/damage-loss?type=Damage&assetId=${l2.assetId}`)).data;
  assert.equal(dmg.length, 1); assert.match(dmg[0].description, /returned damaged/i);
  assert.equal((await coord.post(`/api/borrowing/${req.id}/return`, { items: [{ itemId: mic, assetId: l1.assetId, returned: 1 }] })).status, 422, 'already returned');
  assertConsistent(assert, s.db);
});

test('partial return keeps the request open; missing units become Lost and shrink owned stock', async () => {
  const mic = itemId(s.db, 'Digital Compound Microscope');
  const before = itemQty('Digital Compound Microscope');
  const req = (await mkReq(carla, { items: [{ itemId: mic, quantity: 3 }] })).data;
  await coord.post(`/api/borrowing/${req.id}/approve`, {});
  const plan = (await coord.get(`/api/borrowing/${req.id}/release-plan`)).data[0];
  const rel = await coord.post(`/api/borrowing/${req.id}/release`, { items: [{ requestItemId: req.items[0].id, assetIds: plan.suggestedAssetIds }] });
  const [a, b, c] = rel.data.outstanding;
  const part = await coord.post(`/api/borrowing/${req.id}/return`, { items: [{ itemId: mic, assetId: a.assetId, returned: 1 }] });
  assert.equal(part.data.status, 'Released', 'still open');
  assert.equal(part.data.outstanding.length, 2);
  const fin = await coord.post(`/api/borrowing/${req.id}/return`, { remarks: 'one never came back', items: [
    { itemId: mic, assetId: b.assetId, returned: 1 }, { itemId: mic, assetId: c.assetId, missing: 1 } ] });
  assert.equal(fin.data.status, 'Returned');
  assert.equal(assetStatus(c.assetTag), 'Lost');
  assert.equal(itemQty('Digital Compound Microscope'), before - 1, 'lost unit leaves owned quantity');
  const last = (await coord.get(`/api/inventory/${mic}/transactions`)).data[0];
  assert.equal(last.type, 'Stock-out'); assert.equal(last.reason, 'Loss');
  assert.equal((await coord.get(`/api/damage-loss?type=Loss`)).data.length, 1);
  assertConsistent(assert, s.db);
});

test('consumables / bulk items: release deducts stock, return restocks undamaged units, damaged are written off', async () => {
  const gog = itemId(s.db, 'Safety Goggles');
  const start = itemQty('Safety Goggles');
  const req = (await mkReq(anna, { items: [{ itemId: gog, quantity: 10 }] })).data;
  await coord.post(`/api/borrowing/${req.id}/approve`, {});
  const over = await coord.post(`/api/borrowing/${req.id}/release`, { items: [{ requestItemId: req.items[0].id, quantity: 11 }] });
  assert.equal(over.status, 400, 'cannot release more than requested');
  const rel = await coord.post(`/api/borrowing/${req.id}/release`, { items: [{ requestItemId: req.items[0].id, quantity: 10 }] });
  assert.equal(itemQty('Safety Goggles'), start - 10);
  const detail = (await coord.get(`/api/inventory/${gog}`)).data;
  assert.equal(detail.onLoanQuantity, 10);
  const ret = await coord.post(`/api/borrowing/${req.id}/return`, { items: [{ itemId: gog, returned: 8, damaged: 1, missing: 2 }] });
  assert.equal(ret.data.status, 'Returned');
  assert.equal(itemQty('Safety Goggles'), start - 10 + 7, '8 returned − 1 damaged = 7 restocked');
  assert.equal((await coord.get(`/api/inventory/${gog}`)).data.onLoanQuantity, 0);
  const records = (await coord.get(`/api/damage-loss?pageSize=50`)).data.filter((d) => d.itemId === gog);
  assert.deepEqual(records.map((d) => [d.recordType, d.quantity]).sort(), [['Damage', 1], ['Loss', 2]]);
  assertConsistent(assert, s.db);
});

test('reject needs a reason; cancel works for owner; terminal states are final', async () => {
  const r1 = (await mkReq(anna)).data;
  assert.ok((await coord.post(`/api/borrowing/${r1.id}/reject`, {})).error.fields.reason);
  const rej = await coord.post(`/api/borrowing/${r1.id}/reject`, { reason: 'Not available for requested date' });
  assert.equal(rej.data.status, 'Rejected'); assert.equal(rej.data.approvalReason, 'Not available for requested date');
  assert.equal((await coord.post(`/api/borrowing/${r1.id}/approve`, {})).status, 422);
  assert.equal((await anna.post(`/api/borrowing/${r1.id}/cancel`, {})).status, 422);
  const r2 = (await mkReq(anna)).data;
  assert.equal((await carla.post(`/api/borrowing/${r2.id}/cancel`, {})).status, 404, 'another teacher cannot cancel it');
  assert.equal((await anna.post(`/api/borrowing/${r2.id}/cancel`, { reason: 'plans changed' })).data.status, 'Cancelled');
});

test('coordinator can file a request on behalf of a teacher; teachers cannot', async () => {
  const annaId = s.db.prepare(`SELECT user_id id FROM "User" WHERE username='areyes'`).get().id;
  const r = await mkReq(coord, { requesterId: annaId });
  assert.equal(r.status, 201); assert.equal(r.data.requesterName, 'Anna Reyes');
  const carlaId = s.db.prepare(`SELECT user_id id FROM "User" WHERE username='clim'`).get().id;
  const spoof = await mkReq(anna, { requesterId: carlaId });
  assert.equal(spoof.status, 403);
  const tleTeacher = s.db.prepare(`SELECT user_id id FROM "User" WHERE username='pdizon'`).get().id;
  assert.ok((await mkReq(coord, { requesterId: tleTeacher })).error.fields.requesterId, 'requester must belong to the lab');
  const list = (await coord.get(`/api/users/requesters?laboratoryId=${sci}`)).data;
  assert.ok(list.some((u) => u.name === 'Anna Reyes') && !list.some((u) => u.name === 'Paulo Dizon'));
});

test('overdue detection flips Released → Overdue after the due date (FR-015) and notifies', async () => {
  const gog = itemId(s.db, 'Safety Goggles');
  const req = (await mkReq(anna, { items: [{ itemId: gog, quantity: 1 }] })).data;
  await coord.post(`/api/borrowing/${req.id}/approve`, {});
  await coord.post(`/api/borrowing/${req.id}/release`, { items: [{ requestItemId: req.items[0].id, quantity: 1 }] });
  assert.equal((await anna.get(`/api/borrowing/${req.id}`)).data.status, 'Released');
  s.db.prepare(`UPDATE Borrowing_Request SET expected_return_date = '2020-01-01' WHERE request_id = ?`).run(req.id);
  const d = (await anna.get(`/api/borrowing/${req.id}`)).data;
  assert.equal(d.status, 'Overdue');
  assert.ok(d.timeline.some((t) => t.action === 'Request marked overdue' && t.userName === 'System Process'));
  assert.ok((await anna.get('/api/notifications')).data.some((n) => /overdue/.test(n.title)));
  assert.ok((await coord.get('/api/notifications')).data.some((n) => /overdue/.test(n.title)));
  const ret = await coord.post(`/api/borrowing/${req.id}/return`, { items: [{ itemId: gog, returned: 1 }] });
  assert.equal(ret.data.status, 'Returned');
});

test('deactivated users cannot be named as requester (FR-033); lab-less requesters are refused', async () => {
  const mend = s.db.prepare(`SELECT user_id id FROM "User" WHERE username='jmendoza'`).get().id;
  const r = await mkReq(coord, { laboratoryId: tle, requesterId: mend, items: [{ itemId: itemId(s.db, 'Soldering Iron 60W'), quantity: 1 }] });
  assert.equal(r.status, 422);
});

test('admin may view requests but cannot create or approve them', async () => {
  assert.equal((await admin.get('/api/borrowing')).status, 200);
  assert.equal((await mkReq(admin)).status, 403);
  const p = (await mkReq(anna)).data;
  assert.equal((await admin.post(`/api/borrowing/${p.id}/approve`, {})).status, 403);
});

test('a request mixing equipment and consumables from the TLE lab works end-to-end', async () => {
  const req = (await paulo.post('/api/borrowing', { laboratoryId: tle, purpose: 'Electronics', expectedReturnDate: tomorrow(), items: [
    { itemId: itemId(s.db, 'Soldering Iron 60W'), quantity: 2 }, { itemId: itemId(s.db, 'Safety Glasses'), quantity: 4 } ] })).data;
  const ecruz = await as(s.base, 'ecruz');
  await ecruz.post(`/api/borrowing/${req.id}/approve`, {});
  const plan = (await ecruz.get(`/api/borrowing/${req.id}/release-plan`)).data;
  const rel = await ecruz.post(`/api/borrowing/${req.id}/release`, { items: [
    { requestItemId: plan[0].id, assetIds: plan[0].suggestedAssetIds }, { requestItemId: plan[1].id, quantity: 4 } ] });
  assert.equal(rel.data.releaseItems.length, 3);
  assert.ok(!plan[0].assets.some((a) => a.tag === 'SOL-016'), 'damaged unit never offered');
  const ret = await ecruz.post(`/api/borrowing/${req.id}/return`, { items: rel.data.outstanding.map((l) => ({ itemId: l.itemId, assetId: l.assetId, returned: l.outstanding })) });
  assert.equal(ret.data.status, 'Returned');
  assertConsistent(assert, s.db);
});
