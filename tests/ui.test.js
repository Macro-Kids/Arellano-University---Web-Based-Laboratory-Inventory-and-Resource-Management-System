// -----------------------------------------------------------------------------
// ui.test.js — loads the REAL front-end modules (public/js) into jsdom, pointed at
// the REAL server, and drives them like a user: sign in, visit every page, create
// an inventory item, run a borrowing request through approve → release → return.
// -----------------------------------------------------------------------------
import { startServer, assertConsistent, itemId } from './helpers.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

let s, dom, win, doc;
const consoleErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, timeout = 4000) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for: ${what}\nBODY: ${doc.getElementById('app').textContent.replace(/\s+/g, ' ').slice(0, 400)}\nOVERLAY: ${doc.getElementById('overlay').textContent.replace(/\s+/g, ' ').slice(0, 300)}\nFORM-ERROR: ${[...doc.querySelectorAll('.form-error')].map((e) => e.textContent).join(' | ')}\nFIELD-ERRORS: ${[...doc.querySelectorAll('[data-error-for]')].filter((e) => e.textContent).map((e) => e.dataset.errorFor + '=' + e.textContent).join(' | ')}\nTOAST: ${doc.querySelector('.toast-region')?.textContent}`);
    await sleep(25);
  }
}
const $ = (sel, root = doc) => root.querySelector(sel);
const $$ = (sel, root = doc) => [...root.querySelectorAll(sel)];
const text = (root = doc.getElementById('app')) => root.textContent.replace(/\s+/g, ' ');
const setValue = (el, v, evt = 'input') => { el.value = v; el.dispatchEvent(new win.Event(evt, { bubbles: true })); };
const submit = (form) => form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
const clickBtn = (label, root = doc) => { const b = $$('button, a', root).find((x) => x.textContent.trim() === label || x.textContent.trim().startsWith(label)); assert.ok(b, `button "${label}" not found`); b.click(); return b; };
async function go(hash, expectText) { win.location.hash = hash; await waitFor(() => !$('.loading-block') && text().includes(expectText), `page ${hash} to show "${expectText}"`); }
async function signIn(username) {
  await waitFor(() => $('form[data-form="auth:login"]'), 'login form');
  const f = $('form[data-form="auth:login"]'); setValue(f.elements.identifier, username); setValue(f.elements.password, 'Demo@2026'); submit(f);
  await waitFor(() => $('#page-body') && !$('.loading-block'), 'shell after sign-in');
}
const signOut = async () => { $('[data-action="shell:profile-menu"]').click(); await waitFor(() => $('[data-action="auth:sign-out"]'), 'profile menu'); $('[data-action="auth:sign-out"]').click(); await waitFor(() => $('form[data-form="auth:login"]'), 'login after sign-out'); };
const toastText = () => text($('.toast-region'));

before(async () => {
  s = await startServer();
  const html = fs.readFileSync(path.resolve('public/index.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '');
  dom = new JSDOM(html, { url: `${s.base}/`, pretendToBeVisual: true });
  win = dom.window; doc = win.document;
  win.scrollTo = () => {};
  const jar = {};
  const realFetch = globalThis.fetch;
  Object.assign(globalThis, {
    window: win, document: doc, location: win.location, history: win.history, localStorage: win.localStorage,
    MutationObserver: win.MutationObserver, CSS: { escape: (x) => String(x).replace(/["\\[\].:#]/g, '\\$&') }, __AULAB_NO_AUTOBOOT: true,
    fetch: async (url, opts = {}) => {
      const headers = { ...(opts.headers || {}) };
      if (jar.c) headers.Cookie = jar.c;
      const res = await realFetch(url.startsWith('/') ? s.base + url : url, { ...opts, headers });
      for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); jar.c = pair.endsWith('=') ? '' : pair; }
      return res;
    },
  });
  const origError = console.error; console.error = (...a) => { consoleErrors.push(a.map(String).join(' ').slice(0, 300)); };
  before.origError = origError;
  const { boot } = await import('../public/js/main.js');
  await boot();
});
after(async () => { console.error = before.origError; win.close(); assertConsistent(assert, s.db); await s.stop(); });

test('shows the sign-in screen with demo accounts; wrong password shows an error, no crash', async () => {
  await waitFor(() => $('form[data-form="auth:login"]'), 'login');
  await waitFor(() => $$('.demo-chip').length >= 5, 'demo chips');
  const f = $('form[data-form="auth:login"]'); setValue(f.elements.identifier, 'msantos'); setValue(f.elements.password, 'wrong-pass1'); submit(f);
  await waitFor(() => $('.form-error').textContent.includes('Incorrect username or password'), 'error message');
  $$('.demo-chip').find((c) => c.dataset.u === 'msantos').click();
  assert.equal(f.elements.identifier.value, 'msantos');
});

test('coordinator: sign in → role-based dashboard with live numbers and workspace switcher', async () => {
  const f = $('form[data-form="auth:login"]'); submit(f);
  await waitFor(() => text().includes('Laboratory overview') && $('.metric-card'), 'dashboard');
  const t = text();
  assert.match(t, /Cataloged items/); assert.match(t, /Laboratory readiness/); assert.match(t, /Science Laboratory/); assert.match(t, /Maria Santos/);
  assert.ok($$('.nav-item').some((n) => n.textContent.includes('Audit trail')), 'coordinator sees audit nav');
  assert.ok(!$$('.nav-item').some((n) => n.textContent.includes('Users & access')), 'but not user admin');
  assert.ok($('#bell-count') && !$('#bell-count').hidden, 'notification badge populated');
  $('[data-action="shell:lab-menu"]').click();
  await waitFor(() => $('.lab-menu'), 'lab menu');
  clickBtn('Science Laboratory', $('.lab-menu'));
  await waitFor(() => $('.lab-switcher strong').textContent === 'Science Laboratory', 'switcher label');
  await waitFor(() => !$('.loading-block') && $('.metric-card'), 'dashboard re-rendered');
  $('[data-action="shell:lab-menu"]').click(); await waitFor(() => $('.lab-menu'), 'menu');
  clickBtn('All my laboratories', $('.lab-menu'));
  await waitFor(() => $('.lab-switcher strong').textContent === 'All laboratories', 'back to all');
});

test('every page renders for the coordinator without an error banner', async () => {
  for (const [hash, marker] of [['#/inventory', 'Stock register'], ['#/requests', 'Request queue'], ['#/assets', 'Tracked assets'], ['#/maintenance', 'Maintenance history'], ['#/reports', 'Inventory report'], ['#/audit', 'A record of every decision'], ['#/settings', 'Reference data'], ['#/dashboard', 'Keep the labs moving']]) {
    await go(hash, marker);
    assert.ok(!$('.err-banner'), `${hash} shows an error: ${$('.err-banner')?.textContent}`);
  }
  assert.ok(text().length > 100);
});

test('inventory: server-side search, detail drawer with ledger, and creating an item through the form', async () => {
  await go('#/inventory', 'Stock register');
  await waitFor(() => $$('tbody tr.clickable').length >= 10, 'rows');
  setValue($('#inv-search'), 'micro');
  await waitFor(() => $$('tbody tr.clickable').length === 1 && text().includes('Digital Compound Microscope'), 'search result');
  $('tbody tr.clickable').click();
  await waitFor(() => text($('#overlay')).includes('Stock movement history') && text($('#overlay')).includes('Units by status'), 'drawer');
  assert.match(text($('#overlay')), /MIC-/ === null ? /./ : /Units owned/);
  $('[data-action="ui:close"]', $('#overlay')).click();
  assert.equal($$('#overlay [data-layer]').length, 0);

  setValue($('#inv-search'), '');
  await waitFor(() => $$('tbody tr.clickable').length >= 10, 'rows restored');
  clickBtn('Add inventory');
  const form = await waitFor(() => $('form[data-form="inventory:save"]'), 'item form');
  setValue(form.elements.name, 'UI Test Pipette'); setValue(form.elements.itemType, 'Consumable', 'change'); setValue(form.elements.unit, 'pcs'); setValue(form.elements.quantity, '25'); setValue(form.elements.minimumStock, '5'); setValue(form.elements.location, 'Shelf UI');
  submit(form);
  await waitFor(() => toastText().includes('UI Test Pipette added'), 'success toast');
  assert.equal($$('#overlay [data-layer]').length, 0, 'form closed');
  setValue($('#inv-search'), 'UI Test');
  await waitFor(() => $$('tbody tr.clickable').length === 1, 'new item listed');
  const id = itemId(s.db, 'UI Test Pipette');
  assert.equal(s.db.prepare('SELECT quantity q FROM Inventory_Item WHERE item_id=?').get(id).q, 25);

  // validation errors land on the right fields
  clickBtn('Add inventory');
  const f2 = await waitFor(() => $('form[data-form="inventory:save"]'), 'form again');
  submit(f2);
  await waitFor(() => $('[data-error-for="name"]').textContent.includes('Item name is required'), 'field error');
  assert.ok($('.form-error').textContent.includes('highlighted'));
  $('[data-action="ui:close"]', $('#overlay')).click();
});

test('stock movement from the UI updates the ledger and shows the new balance', async () => {
  const id = itemId(s.db, 'UI Test Pipette');
  $('[data-action="inventory:move"]').click();
  const form = await waitFor(() => $('form[data-form="inventory:move-save"]'), 'move form');
  setValue(form.elements.type, 'Stock-out', 'change');
  setValue(form.elements.quantity, '30'); setValue(form.elements.reason, 'Consumption'); submit(form);
  await waitFor(() => $('[data-error-for]') && $('.form-error').textContent.length > 0, 'negative stock refused');
  assert.match($('.form-error').textContent, /Only 25|cannot remove|never be negative/i);
  setValue(form.elements.quantity, '5'); submit(form);
  await waitFor(() => toastText().includes('now has 20'), 'toast with new balance');
  assert.equal(s.db.prepare('SELECT quantity q FROM Inventory_Item WHERE item_id=?').get(id).q, 20);
});

test('borrowing workflow through the UI: teacher requests → coordinator approves, releases assets, processes return', async () => {
  await signOut(); await signIn('areyes');
  assert.ok(text().includes('My overview'), 'teacher dashboard');
  assert.ok(!$$('.nav-item').some((n) => /Audit|Users|Reports/.test(n.textContent)), 'teacher nav is limited');
  await go('#/requests', 'My requests');
  clickBtn('New request');
  const f = await waitFor(() => $('form[data-form="requests:save"]'), 'request form');
  const sel = $('[data-line] select');
  const mic = [...sel.options].find((o) => o.textContent.startsWith('Digital Compound Microscope'));
  setValue(sel, mic.value, 'change'); setValue($('[data-line] input'), '2'); setValue(f.elements.purpose, 'UI test biology practical'); submit(f);
  await waitFor(() => toastText().includes('submitted'), 'submitted toast');
  await waitFor(() => text().includes('UI test biology practical'), 'request in list');
  assert.ok(text().includes('Pending'));
  const reqId = s.db.prepare(`SELECT MAX(request_id) id FROM Borrowing_Request`).get().id;

  await signOut(); await signIn('msantos');
  await go('#/requests?status=Pending', 'Pending requests');
  await waitFor(() => $(`[data-action="requests:approve"][data-id="${reqId}"]`), 'approve button');
  $(`[data-action="requests:approve"][data-id="${reqId}"]`).click();
  await waitFor(() => $('.confirm-modal'), 'confirm dialog'); $('[data-ok]').click();
  await waitFor(() => toastText().includes('approved'), 'approved toast');
  assert.equal(s.db.prepare('SELECT status s FROM Borrowing_Request WHERE request_id=?').get(reqId).s, 'Approved');

  await go('#/requests?status=Approved', 'Approved requests');
  await waitFor(() => $(`[data-action="requests:release"][data-id="${reqId}"]`), 'release button');
  $(`[data-action="requests:release"][data-id="${reqId}"]`).click();
  const rf = await waitFor(() => $('form[data-form="requests:release-save"]'), 'release form');
  assert.equal($$('.asset-pick input:checked', rf).length, 2, 'two units preselected');
  assert.ok(!text($('#overlay')).includes('MIC-001'), 'borrowed unit not offered');
  submit(rf);
  await waitFor(() => toastText().includes('items released'), 'released toast');
  assert.equal(s.db.prepare(`SELECT COUNT(*) n FROM Asset WHERE status='Borrowed'`).get().n >= 4, true);

  await go('#/requests?status=Released', 'Released requests');
  $(`[data-action="requests:return"][data-id="${reqId}"]`).click();
  const ret = await waitFor(() => $('form[data-form="requests:return-save"]'), 'return form');
  const outcomes = $$('[data-role="outcome"]', ret);
  assert.equal(outcomes.length, 2);
  setValue(outcomes[1], 'damaged', 'change');
  submit(ret);
  await waitFor(() => toastText().includes('fully returned'), 'returned toast');
  assert.equal(s.db.prepare('SELECT status s FROM Borrowing_Request WHERE request_id=?').get(reqId).s, 'Returned');
  assert.equal(s.db.prepare(`SELECT COUNT(*) n FROM Damage_Loss_Record WHERE description LIKE 'Returned damaged%'`).get().n, 1);
  await waitFor(() => !$('.loading-block'), 'idle');
});

test('administrator pages: users, settings system panel, integrity check, backup', async () => {
  await signOut(); await signIn('admin');
  assert.ok(text().includes('Laboratory overview') || text().includes('overview'));
  await go('#/users', 'Access control');
  await waitFor(() => $$('tbody tr').length >= 8, 'user rows');
  await go('#/settings', 'System, backups');
  await waitFor(() => $('#system-panel .stat-row'), 'system panel');
  $('[data-action="settings:integrity"]').click();
  await waitFor(() => text($('#integrity-result')).includes('Data is consistent'), 'integrity ok');
  $('[data-action="settings:backup"]').click();
  await waitFor(() => toastText().includes('created and verified'), 'backup toast');
  await go('#/audit', 'Append-only record');
  await waitFor(() => $$('.audit-row').length > 10, 'audit rows');
  await go('#/reports', 'Inventory report');
  await waitFor(() => $$('#report-body tbody tr').length > 5, 'report rows');
  $$('.report-card').find((c) => c.dataset.type === 'movements').click();
  await waitFor(() => text().includes('Stock-in (units)'), 'movement report');
});

test('session expiry returns to the sign-in screen with a message (no dead UI)', async () => {
  s.db.prepare('DELETE FROM Session').run();
  win.location.hash = '#/inventory';
  await waitFor(() => $('form[data-form="auth:login"]') && $('.form-error').textContent.includes('expired'), 'expired message');
});

test('no unexpected errors were logged to the browser console during the whole session', () => {
  assert.deepEqual(consoleErrors.filter((e) => !/Not implemented|expired|401/.test(e)), []);
});

test('regression: UI "today" follows the server business timezone, not the browser clock', async () => {
  const { todayStr, setBusinessTimezone } = await import('../public/js/core/format.js');
  const instant = new Date('2026-11-10T20:00:00Z');               // 20:00 UTC = 04:00 next day in Manila
  setBusinessTimezone('Asia/Manila'); assert.equal(todayStr(instant), '2026-11-11');
  setBusinessTimezone('UTC');         assert.equal(todayStr(instant), '2026-11-10');
  setBusinessTimezone('Asia/Manila');
});
