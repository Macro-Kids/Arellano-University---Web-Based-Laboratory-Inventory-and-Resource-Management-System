// -----------------------------------------------------------------------------
// pages/requests.js — UC-008 create, UC-009 approve/reject, UC-010 release,
// UC-011 return. The page only SENDS what the user entered; every rule
// (availability, approval before release, return ≤ released …) is enforced by the server.
// -----------------------------------------------------------------------------
import { esc, fmtDate, fmtDateTime, num, qty, todayStr, addDaysStr } from '../core/format.js';
import { icon } from '../core/icons.js';
import { registerPage, current, renderRoute } from '../core/router.js';
import { onClick, onInput, onChange, onSubmit } from '../core/events.js';
import { borrowingApi, inventoryApi, usersApi } from '../services/index.js';
import { badge, pager, emptyState, loading, field, formShell, modalHtml, drawerHtml, openLayer, closeLayer, replaceLayer, submitForm, confirmDialog, toast, kv, errorBanner, readForm } from '../core/ui.js';
import { state, can, activeLabs, wsParams } from '../core/state.js';
import { P } from '../core/permissions.js';
import { REQUEST_STATUSES } from '../core/constants.js';
import { refreshBadges } from '../components/shell.js';

const view = { status: 'All', search: '', page: 1 };
const isStaff = () => can(P.BORROW_VIEW_ALL);
const params = () => ({ ...wsParams(), status: view.status === 'All' ? '' : view.status, search: view.search, page: view.page, pageSize: 15 });

function actionButtons(r, size = 'btn-small') {
  const own = r.requesterId === state.me.id;
  const b = [];
  if (r.status === 'Pending' && can(P.BORROW_APPROVE)) b.push(`<button class="btn ${size} btn-primary" data-action="requests:approve" data-id="${r.id}">Approve</button><button class="btn ${size} btn-quiet" data-action="requests:reject" data-id="${r.id}">Reject</button>`);
  if (r.status === 'Approved' && can(P.BORROW_RELEASE)) b.push(`<button class="btn ${size} btn-primary" data-action="requests:release" data-id="${r.id}">Release</button>`);
  if (['Released', 'Overdue'].includes(r.status) && can(P.BORROW_RETURN)) b.push(`<button class="btn ${size} btn-primary" data-action="requests:return" data-id="${r.id}">Process return</button>`);
  if (['Released', 'Overdue'].includes(r.status) && own && can(P.BORROW_CONFIRM_RETURN) && !r.returnConfirmedAt) b.push(`<button class="btn ${size} btn-quiet" data-action="requests:confirm-return" data-id="${r.id}">I’m returning these</button>`);
  if (['Pending', 'Approved'].includes(r.status) && (own || can(P.BORROW_CANCEL_ANY))) b.push(`<button class="btn ${size} btn-danger-outline" data-action="requests:cancel" data-id="${r.id}">Cancel</button>`);
  return b.join('');
}

function listHtml({ rows, meta }) {
  const counts = meta.statusCounts || {};
  const total = Object.values(counts).reduce((a, n) => a + n, 0);
  const tabs = ['All', ...REQUEST_STATUSES.filter((s) => s !== 'Cancelled' || counts.Cancelled)];
  return `<div class="tabs panel">${tabs.map((s) => `<button class="tab ${view.status === s ? 'active' : ''}" data-action="requests:tab" data-status="${s}">${s}<b>${s === 'All' ? total : counts[s] || 0}</b></button>`).join('')}</div>
  <section class="panel table-panel"><div class="panel-head"><div><p class="eyebrow">${isStaff() ? 'Borrowing desk' : 'My borrowing'}</p><h2>${view.status === 'All' ? (isStaff() ? 'Request queue' : 'My requests') : `${view.status} requests`}</h2></div><div class="filter-note">${icon('clipboard')} Every decision is logged</div></div>
  <div class="request-list">${rows.map((r) => `<div class="request-row"><div class="request-id"><code>${esc(r.code)}</code><span>${fmtDate(r.requestDate.slice(0, 10))}</span></div>
    <div class="request-main"><strong>${esc(r.requesterName)}</strong><p>${esc(r.purpose)}</p><small>${esc(r.itemsSummary || '')} · ${esc(r.laboratoryName)}</small></div>
    <div class="request-return"><span>Expected return</span><strong>${fmtDate(r.expectedReturnDate)}</strong>${r.awaitingReturnProcessing ? '<span class="tag-note">Borrower is returning</span>' : ''}</div><div>${badge(r.status)}</div>
    <div class="request-actions">${actionButtons(r)}<button class="btn btn-small btn-quiet" data-action="requests:open" data-id="${r.id}">Details</button></div></div>`).join('')
    || emptyState('clipboard', 'Nothing in this queue', isStaff() ? 'New requests from teachers will appear here.' : 'Start a request when you need equipment or supplies.', can(P.BORROW_CREATE) ? `<button class="btn btn-primary" data-action="requests:new">${icon('plus')}New request</button>` : '')}</div>${pager(meta, 'requests:page')}</section>`;
}
async function reload() {
  const host = document.getElementById('req-results'); if (!host) return;
  try { host.innerHTML = listHtml(await borrowingApi.list(params())); } catch (err) { host.innerHTML = errorBanner(err, 'requests:reload'); }
}

registerPage({
  id: 'requests', title: () => (isStaff() ? 'Borrowing requests' : 'My requests'), eyebrow: () => (isStaff() ? 'Workflow control' : 'Borrowing'), perm: [P.BORROW_CREATE, P.BORROW_VIEW_ALL],
  subtitle: () => (isStaff() ? 'Approve, release and check in — every step is traceable.' : 'Track what you asked for, what is approved, and what is due back.'),
  actions: () => (can(P.BORROW_CREATE) ? `<button class="btn btn-primary" data-action="requests:new">${icon('plus')}New request</button>` : ''),
  async render({ query }) {
    if (query.status) { view.status = query.status; view.page = 1; }
    const data = await borrowingApi.list(params());
    return `<div class="toolbar panel"><div class="search-field">${icon('search')}<input data-on-input="requests:search" placeholder="Search request ID, person, purpose, item…" aria-label="Search requests" value="${esc(view.search)}"></div></div><div id="req-results">${listHtml(data)}</div>`;
  },
  mount({ query }) { if (query.open) openDetail(Number(query.open)); },
});
onInput('requests:search', (el) => { view.search = el.value.trim(); view.page = 1; reload(); });
onClick('requests:tab', (el) => { view.status = el.dataset.status; view.page = 1; reload(); });
onClick('requests:page', (el) => { view.page = Number(el.dataset.page); reload(); });
onClick('requests:reload', reload);

/** Refresh every place that shows requests after a change. */
async function afterChange(id) {
  const drawer = document.querySelector(`[data-layer][data-request="${id}"]`);
  if (current().id === 'requests') await reload(); else if (current().id === 'dashboard') await renderRoute();
  if (drawer) await paintDetail(drawer, id);
  await refreshBadges();
}

// ---- detail drawer ------------------------------------------------------------------------------------------------------
function detailBody(r) {
  const outstanding = r.outstanding.length ? `<h3>Still out (${r.outstanding.length})</h3><table class="mini-table"><thead><tr><th>Item</th><th>Outstanding</th></tr></thead><tbody>${r.outstanding.map((l) => `<tr><td>${esc(l.assetTag ? `${l.itemName} · ${l.assetTag}` : l.itemName)}</td><td>${num(l.outstanding)} ${esc(l.unit)}</td></tr>`).join('')}</tbody></table>` : '';
  return `<div class="drawer-actions">${actionButtons(r, 'btn-small')}</div>
    ${r.status === 'Overdue' ? `<p class="form-note warn">This request is overdue — items were due back on ${fmtDate(r.expectedReturnDate)}.</p>` : ''}
    ${r.awaitingReturnProcessing ? `<p class="form-note">The borrower confirmed on ${esc(fmtDateTime(r.returnConfirmedAt))} that they are returning these items.</p>` : ''}
    <h3>Request</h3>${kv([['Request', `<code>${esc(r.code)}</code>`], ['Status', badge(r.status)], ['Requester', esc(r.requesterName)], ['Laboratory', esc(r.laboratoryName)], ['Purpose', esc(r.purpose)], ['Submitted', fmtDateTime(r.requestDate)], ['Expected return', fmtDate(r.expectedReturnDate)],
      ['Decision', r.approverName ? `${esc(r.approverName)} · ${fmtDateTime(r.approvalDate)}` : null], ['Decision note', esc(r.approvalReason || '')], ['Remarks', esc(r.remarks || '')]])}
    <h3>Items requested</h3><table class="mini-table"><thead><tr><th>Item</th><th>Requested</th>${['Pending', 'Approved'].includes(r.status) ? '<th>Available now</th>' : ''}</tr></thead><tbody>${r.items.map((i) => `<tr><td>${esc(i.itemName)}</td><td>${num(i.quantity)} ${esc(i.unit)}</td>${['Pending', 'Approved'].includes(r.status) ? `<td class="${i.availableQuantity < i.quantity ? 'trend-down' : ''}">${num(i.availableQuantity)}</td>` : ''}</tr>`).join('')}</tbody></table>
    ${r.releaseItems.length ? `<h3>Released</h3><table class="mini-table"><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody>${r.releaseItems.map((i) => `<tr><td>${esc(i.assetTag ? `${i.itemName} · ${i.assetTag}` : i.itemName)}</td><td>${num(i.quantityReleased)} ${esc(i.unit)}</td></tr>`).join('')}</tbody></table><p class="muted-small">Released ${r.releases.map((x) => `${fmtDateTime(x.releaseDate)} by ${esc(x.releasedBy)}`).join('; ')}</p>` : ''}
    ${outstanding}
    ${r.returnItems.length ? `<h3>Returns</h3><table class="mini-table"><thead><tr><th>Item</th><th>Returned</th><th>Damaged</th><th>Missing</th></tr></thead><tbody>${r.returnItems.map((i) => `<tr><td>${esc(i.assetTag ? `${i.itemName} · ${i.assetTag}` : i.itemName)}</td><td>${num(i.quantityReturned)}</td><td>${num(i.damagedQuantity)}</td><td>${num(i.missingQuantity)}</td></tr>`).join('')}</tbody></table>` : ''}
    <h3>Timeline</h3><ul class="timeline">${r.timeline.map((a) => `<li><strong>${esc(a.action)}</strong><small>${esc(a.userName)} · ${esc(fmtDateTime(a.timestamp))}${a.reason ? ` · “${esc(a.reason)}”` : ''}</small></li>`).join('')}</ul>`;
}
async function openDetail(id) {
  const el = openLayer(drawerHtml({ eyebrow: 'Borrowing request', title: 'Loading…', body: loading() }));
  el.dataset.request = id;
  await paintDetail(el, id);
}
async function paintDetail(el, id) {
  try {
    const r = await borrowingApi.get(id);
    const next = replaceLayer(el, drawerHtml({ eyebrow: r.code, title: r.purpose, subtitle: `${esc(r.requesterName)} · ${esc(r.laboratoryName)}`, body: detailBody(r) }));
    next.dataset.request = id;
  } catch (err) { el.querySelector('.drawer-body').innerHTML = errorBanner(err, 'ui:close'); }
}
onClick('requests:open', (el) => openDetail(Number(el.dataset.id)));

// ---- simple decisions ---------------------------------------------------------------------------------------------------------
onClick('requests:approve', async (el) => {
  const id = Number(el.dataset.id);
  const ok = await confirmDialog({ title: 'Approve this request?', message: 'The requester will be notified. Items are released separately at the laboratory.', label: 'Approve', danger: false, reasonLabel: 'Note (optional)' });
  if (!ok) return;
  const r = await borrowingApi.approve(id, ok.reason);
  toast(`${r.code} approved.`);
  r.warnings?.forEach((w) => toast(`Heads-up — ${w}`, 'info'));
  await afterChange(id);
});
onClick('requests:reject', async (el) => {
  const id = Number(el.dataset.id);
  const ok = await confirmDialog({ title: 'Reject this request?', message: 'The requester will see your reason.', label: 'Reject request', reasonLabel: 'Reason for rejection', reasonRequired: true, reasonPlaceholder: 'e.g. Not available for requested date' });
  if (!ok) return;
  await borrowingApi.reject(id, ok.reason); toast('Request rejected.'); await afterChange(id);
});
onClick('requests:cancel', async (el) => {
  const id = Number(el.dataset.id);
  const ok = await confirmDialog({ title: 'Cancel this request?', message: 'This cannot be undone.', label: 'Cancel request', reasonLabel: 'Reason (optional)' });
  if (!ok) return;
  await borrowingApi.cancel(id, ok.reason); toast('Request cancelled.'); await afterChange(id);
});
onClick('requests:confirm-return', async (el) => {
  const id = Number(el.dataset.id);
  const ok = await confirmDialog({ title: 'Tell the laboratory you are returning?', message: 'Laboratory staff will check the items in when you bring them back.', label: 'Yes, I’m returning them', danger: false });
  if (!ok) return;
  await borrowingApi.confirmReturn(id); toast('The laboratory has been notified.'); await afterChange(id);
});

// ---- new request ----------------------------------------------------------------------------------------------------------------------
let lookup = [];
const lineHtml = (i, sel = {}) => `<div class="line-row" data-line><div><select name="line-item" aria-label="Item">${lineOptions(sel.itemId)}</select><span class="field-error" data-error-for="items.${i}.itemId"></span></div>
  <div><input name="line-qty" type="number" min="0" step="any" value="${sel.quantity ?? 1}" aria-label="Quantity"><span class="field-error" data-error-for="items.${i}.quantity"></span></div>
  <button type="button" class="icon-btn" data-action="requests:line-remove" aria-label="Remove item">${icon('close')}</button></div>`;
const lineOptions = (selected) => `<option value="">Choose an item…</option>` + lookup.map((it) => `<option value="${it.id}" ${String(it.id) === String(selected) ? 'selected' : ''} ${it.availableQuantity <= 0 ? 'disabled' : ''}>${esc(it.name)} — ${num(it.availableQuantity)} ${esc(it.unit)} available</option>`).join('');
const renumber = (form) => form.querySelectorAll('[data-line]').forEach((row, i) => {
  const [a, b] = row.querySelectorAll('[data-error-for]'); a.dataset.errorFor = `items.${i}.itemId`; b.dataset.errorFor = `items.${i}.quantity`;
});

async function loadLabContext(form, labId) {
  lookup = await inventoryApi.lookup({ laboratoryId: labId });
  form.querySelectorAll('[data-line] select').forEach((s) => { const keep = s.value; s.innerHTML = lineOptions(keep); });
  const who = form.querySelector('[name="requesterId"]');
  if (who) {
    const list = await usersApi.requesters(labId);
    who.innerHTML = `<option value="">Myself (${esc(state.me.name)})</option>` + list.filter((u) => u.id !== state.me.id).map((u) => `<option value="${u.id}">${esc(u.name)} — ${esc(u.roleName.replace('Laboratory ', 'Lab '))}</option>`).join('');
  }
}
onClick('requests:new', async (el) => {
  const labsAvail = activeLabs();
  if (!labsAvail.length) { toast('You are not assigned to an operational laboratory.', 'info'); return; }
  const preLab = Number(el.dataset.lab) || Number(state.workspaceLab) || labsAvail[0].id;
  const preItem = Number(el.dataset.item) || '';
  lookup = await inventoryApi.lookup({ laboratoryId: preLab });
  const others = can(P.BORROW_CREATE_FOR_OTHERS);
  const body = formShell('requests:save', `<div class="form-grid">
    ${field({ name: 'laboratoryId', label: 'Laboratory', type: 'select', required: true, options: labsAvail.map((l) => ({ value: l.id, label: l.name })), value: preLab, attrs: 'data-on-change="requests:lab-change"', span2: !others })}
    ${others ? field({ name: 'requesterId', label: 'Requester', type: 'select', options: [{ value: '', label: `Myself (${state.me.name})` }], hint: 'File this request on behalf of a teacher.' }) : ''}
    ${field({ name: 'purpose', label: 'Purpose', type: 'textarea', rows: 2, required: true, span2: true, placeholder: 'Class, practical, or activity' })}
    ${field({ name: 'expectedReturnDate', label: 'Expected return date', type: 'date', required: true, value: addDaysStr(7), attrs: `min="${todayStr()}"` })}
    ${field({ name: 'remarks', label: 'Remarks (optional)' })}</div>
    <div><p class="muted-small" style="margin:0 0 6px;font-weight:700">Items requested *</p><div class="lines" id="req-lines">${lineHtml(0, { itemId: preItem })}</div><span class="field-error" data-error-for="items"></span>
    <button type="button" class="btn btn-small btn-quiet" style="margin-top:8px" data-action="requests:line-add">${icon('plus')}Add another item</button></div>`, { submit: 'Submit request', cls: 'form-stack' });
  const layer = openLayer(modalHtml({ eyebrow: 'Borrowing request', title: 'New request', subtitle: 'Requests are reviewed by the laboratory coordinator or staff.', body, size: 'wide' }));
  if (others) loadLabContext(layer.querySelector('form'), preLab).catch(() => {});
});
onChange('requests:lab-change', async (el) => {
  const form = el.closest('form');
  form.querySelector('#req-lines').innerHTML = lineHtml(0);
  await loadLabContext(form, Number(el.value));
});
onClick('requests:line-add', (el) => { const box = el.closest('form').querySelector('#req-lines'); box.insertAdjacentHTML('beforeend', lineHtml(box.children.length)); renumber(el.closest('form')); });
onClick('requests:line-remove', (el) => { const form = el.closest('form'); if (form.querySelectorAll('[data-line]').length > 1) { el.closest('[data-line]').remove(); renumber(form); } });
onSubmit('requests:save', (form) => submitForm(form, async (v) => {
  const items = [...form.querySelectorAll('[data-line]')].map((row) => ({ itemId: Number(row.querySelector('select').value) || undefined, quantity: row.querySelector('input').value === '' ? undefined : Number(row.querySelector('input').value) }));
  const r = await borrowingApi.create({ laboratoryId: v.laboratoryId, requesterId: v.requesterId || undefined, purpose: v.purpose, expectedReturnDate: v.expectedReturnDate, remarks: v.remarks, items: items.map((i) => (i.itemId ? i : { ...i, itemId: 0 })) });
  closeLayer(form.closest('[data-layer]'));
  toast(`Request ${r.code} submitted.`);
  if (current().id === 'requests') await afterChange(r.id); else location.hash = '#/requests';
}));

// ---- release (UC-010) ------------------------------------------------------------------------------------------------------------------------
onClick('requests:release', async (el) => {
  const id = Number(el.dataset.id);
  const [r, plan] = await Promise.all([borrowingApi.get(id), borrowingApi.releasePlan(id)]);
  const lines = plan.map((it) => it.itemType === 'Equipment'
    ? `<div class="release-line" data-req-item="${it.id}" data-type="Equipment"><header><strong>${esc(it.itemName)}</strong><span>Requested ${num(it.quantity)} · ${it.assets.length} available</span></header>
        ${it.shortfall ? `<p class="form-note warn">Only ${it.assets.length} unit(s) are available — ${it.shortfall} short. You can release fewer.</p>` : ''}
        <div class="asset-pick">${it.assets.map((a) => `<label><input type="checkbox" value="${a.id}" ${it.suggestedAssetIds.includes(a.id) ? 'checked' : ''}>${esc(a.tag)}<small class="muted-small">${esc(a.condition)}</small></label>`).join('') || '<span class="muted-small">No units available.</span>'}</div></div>`
    : `<div class="release-line" data-req-item="${it.id}" data-type="Consumable"><header><strong>${esc(it.itemName)}</strong><span>Requested ${num(it.quantity)} ${esc(it.unit)} · ${num(it.availableQuantity)} on hand</span></header>
        ${field({ name: `qty-${it.id}`, label: `Quantity to release (${it.unit})`, type: 'number', value: Math.min(it.quantity, it.availableQuantity), attrs: `min="0" max="${it.quantity}" step="any"` })}</div>`).join('');
  const body = formShell('requests:release-save', `<p class="form-note">Choose the exact units leaving the laboratory. Units under maintenance, damaged or already borrowed are not offered.</p><div class="lines">${lines}</div>${field({ name: 'remarks', label: 'Release remarks (optional)', type: 'textarea', rows: 2 })}`, { submit: 'Confirm release', data: `data-id="${id}"` });
  openLayer(modalHtml({ eyebrow: r.code, title: 'Release items', subtitle: `To ${esc(r.requesterName)} · due back ${fmtDate(r.expectedReturnDate)}`, body, size: 'wide' }));
});
onSubmit('requests:release-save', (form) => submitForm(form, async (v) => {
  const id = Number(form.dataset.id);
  const items = [...form.querySelectorAll('[data-req-item]')].map((row) => row.dataset.type === 'Equipment'
    ? { requestItemId: Number(row.dataset.reqItem), assetIds: [...row.querySelectorAll('input:checked')].map((c) => Number(c.value)) }
    : { requestItemId: Number(row.dataset.reqItem), quantity: Number(row.querySelector('input').value || 0) });
  const r = await borrowingApi.release(id, { remarks: v.remarks, items });
  closeLayer(form.closest('[data-layer]')); toast(`${r.code}: items released.`); await afterChange(id);
}));

// ---- return (UC-011) -----------------------------------------------------------------------------------------------------------------------------
const GOOD = ['Excellent', 'Good', 'Fair'], BAD = ['Damaged', 'Non-functional'];
const condOptions = (list, sel) => list.map((c) => `<option ${c === sel ? 'selected' : ''}>${c}</option>`).join('');
onClick('requests:return', async (el) => {
  const id = Number(el.dataset.id);
  const r = await borrowingApi.get(id);
  const lines = r.outstanding.map((l, i) => l.assetId
    ? `<div class="return-line" data-line-key="${l.key}" data-item="${l.itemId}" data-asset="${l.assetId}"><header><strong>${esc(l.itemName)} · ${esc(l.assetTag)}</strong><span class="muted-small">1 unit outstanding</span></header>
        <div class="return-grid"><label class="field"><span>Outcome</span><select data-role="outcome" data-on-change="requests:outcome"><option value="returned">Returned — good condition</option><option value="damaged">Returned — damaged</option><option value="missing">Not returned (missing)</option><option value="skip">Not checked in yet</option></select></label>
        <label class="field"><span>Condition</span><select data-role="condition">${condOptions(GOOD, 'Good')}</select></label></div></div>`
    : `<div class="return-line" data-line-key="${l.key}" data-item="${l.itemId}"><header><strong>${esc(l.itemName)}</strong><span class="muted-small">${num(l.outstanding)} ${esc(l.unit)} outstanding</span></header>
        <div class="return-grid"><label class="field"><span>Returned</span><input data-role="returned" type="number" min="0" max="${l.outstanding}" step="any" value="${l.outstanding}"></label>
        <label class="field"><span>…of which damaged</span><input data-role="damaged" type="number" min="0" step="any" value="0"></label>
        <label class="field"><span>Missing</span><input data-role="missing" type="number" min="0" max="${l.outstanding}" step="any" value="0"></label></div>
        <span class="field-hint">Undamaged returns go back into stock; damaged and missing quantities are written off and recorded.</span></div>`).join('');
  const body = formShell('requests:return-save', `<div class="lines">${lines}</div><div class="form-grid">${field({ name: 'returnDate', label: 'Return date', type: 'date', value: todayStr(), attrs: `max="${todayStr()}"` })}${field({ name: 'remarks', label: 'Remarks (optional)' })}</div>`, { submit: 'Record return', data: `data-id="${id}"` });
  openLayer(modalHtml({ eyebrow: r.code, title: 'Process return', subtitle: `From ${esc(r.requesterName)}. Anything not returned stays open on the request.`, body, size: 'wide' }));
});
onChange('requests:outcome', (el) => {
  const cond = el.closest('.return-line').querySelector('[data-role="condition"]');
  cond.disabled = ['missing', 'skip'].includes(el.value);
  cond.innerHTML = condOptions(el.value === 'damaged' ? BAD : GOOD, el.value === 'damaged' ? 'Damaged' : 'Good');
});
onSubmit('requests:return-save', (form) => submitForm(form, async (v) => {
  const id = Number(form.dataset.id);
  const items = [];
  for (const row of form.querySelectorAll('.return-line')) {
    const base = { itemId: Number(row.dataset.item), ...(row.dataset.asset ? { assetId: Number(row.dataset.asset) } : {}) };
    if (row.dataset.asset) {
      const o = row.querySelector('[data-role="outcome"]').value;
      if (o === 'skip') continue;
      items.push({ ...base, returned: o === 'missing' ? 0 : 1, damaged: o === 'damaged' ? 1 : 0, missing: o === 'missing' ? 1 : 0, condition: o === 'missing' ? undefined : row.querySelector('[data-role="condition"]').value });
    } else {
      const g = (k) => Number(row.querySelector(`[data-role="${k}"]`).value || 0);
      if (g('returned') + g('missing') > 0) items.push({ ...base, returned: g('returned'), damaged: g('damaged'), missing: g('missing') });
    }
  }
  const r = await borrowingApi.processReturn(id, { returnDate: v.returnDate, remarks: v.remarks, items });
  closeLayer(form.closest('[data-layer]'));
  toast(r.status === 'Returned' ? `${r.code} fully returned.` : `Return recorded. ${r.outstanding.length} line(s) still outstanding.`);
  await afterChange(id);
}));
export { openDetail as openRequestDetail };
