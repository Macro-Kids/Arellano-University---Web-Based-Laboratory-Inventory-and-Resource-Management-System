// -----------------------------------------------------------------------------
// pages/inventory.js — UC-004/005/007: list, search, filter, detail, create/edit,
// stock movements, archive. All data comes from /api/inventory (server-side search,
// filter, sort and pagination).
// -----------------------------------------------------------------------------
import { esc, fmtDate, fmtDateTime, num, qty } from '../core/format.js';
import { icon } from '../core/icons.js';
import { registerPage, current } from '../core/router.js';
import { onClick, onInput, onChange, onSubmit } from '../core/events.js';
import { inventoryApi } from '../services/index.js';
import { badge, stockBadge, pager, sortTh, emptyState, loading, setHtml, field, formShell, modalHtml, drawerHtml, openLayer, closeLayer, replaceLayer, topLayer, submitForm, confirmDialog, toast, kv, errorBanner } from '../core/ui.js';
import { state, can, activeLabs, labs, wsParams } from '../core/state.js';
import { P } from '../core/permissions.js';
import { CONDITIONS, ITEM_TYPES, STOCK_OUT_REASONS } from '../core/constants.js';
import { categories } from '../core/lookups.js';
import { refreshBadges } from '../components/shell.js';

const view = { search: '', itemType: '', availability: '', categoryId: '', status: 'active', sort: 'name', dir: 'asc', page: 1 };
const params = () => ({ ...wsParams(), search: view.search, itemType: view.itemType, availability: view.availability, categoryId: view.categoryId, status: view.status, sort: view.sort, dir: view.dir, page: view.page, pageSize: 20 });
const multiLab = () => labs().length > 1;

function row(i) {
  const bar = Math.min(100, Math.round((i.quantity / Math.max(i.minimumStock * 2, 1)) * 100));
  const avail = i.itemType === 'Equipment' ? `<small>${num(i.availableQuantity)} available${i.attentionCount ? ` · ${i.attentionCount} need attention` : ''}</small>` : '';
  return `<tr class="clickable" data-action="inventory:open" data-id="${i.id}"><td><code>${esc(i.code)}</code></td>
    <td><div class="item-cell"><span class="item-icon" title="${i.itemType}">${i.itemType === 'Consumable' ? 'C' : 'E'}</span><div><strong>${esc(i.name)}</strong><small>${esc(i.description || i.location || '')}</small></div></div></td>
    <td>${esc(i.categoryName)}</td>${multiLab() ? `<td>${esc(i.laboratoryName)}</td>` : ''}
    <td class="num"><strong>${num(i.quantity)}</strong> <small style="display:inline">${esc(i.unit)}</small>${avail}<div class="stock-mini"><i style="width:${bar}%"></i></div></td>
    <td>${i.condition ? badge(i.condition) : '—'}</td>
    <td>${i.status === 'Archived' ? badge('Archived') : stockBadge(i.stockState) || badge('Active')}</td>
    <td><div class="table-actions">${i.status === 'Active' && can(P.STOCK_MOVE) ? `<button class="btn btn-small btn-quiet" data-action="inventory:move" data-id="${i.id}">Stock</button>` : ''}${can(P.INVENTORY_UPDATE) && i.status === 'Active' ? `<button class="btn btn-small btn-quiet" data-action="inventory:edit" data-id="${i.id}">Edit</button>` : ''}</div></td></tr>`;
}

function resultsHtml({ rows, meta }) {
  const cols = multiLab() ? 8 : 7;
  return `<div class="panel-head"><div><p class="eyebrow">Stock register</p><h2>${view.status === 'archived' ? 'Archived inventory' : 'All inventory'}</h2></div><span class="panel-meta">${meta.total} record${meta.total === 1 ? '' : 's'}</span></div>
  <div class="table-wrap"><table><thead><tr>${sortTh('Item ID', 'code', view, 'inventory:sort')}${sortTh('Item', 'name', view, 'inventory:sort')}${sortTh('Category', 'category', view, 'inventory:sort')}${multiLab() ? sortTh('Laboratory', 'laboratory', view, 'inventory:sort') : ''}${sortTh('On hand', 'quantity', view, 'inventory:sort')}${sortTh('Condition', 'condition', view, 'inventory:sort')}<th>Status</th><th></th></tr></thead>
  <tbody>${rows.map(row).join('') || `<tr><td colspan="${cols}">${emptyState('box', 'No inventory matches', 'Try a different search or reset your filters.', `<button class="btn btn-quiet" data-action="inventory:reset">Reset filters</button>`)}</td></tr>`}</tbody></table></div>${pager(meta, 'inventory:page')}`;
}
async function refreshResults() {
  const host = document.getElementById('inv-results'); if (!host) return;
  try { host.innerHTML = resultsHtml(await inventoryApi.list(params())); }
  catch (err) { host.innerHTML = errorBanner(err, 'inventory:reload'); }
}
const reload = () => refreshResults();

async function toolbar() {
  const cats = await categories();
  const sel = (v, a) => (String(v) === String(a) ? 'selected' : '');
  return `<div class="toolbar panel"><div class="search-field">${icon('search')}<input id="inv-search" data-on-input="inventory:search" placeholder="Search name, ID, asset tag, location…" aria-label="Search inventory" value="${esc(view.search)}"></div>
    <select data-on-change="inventory:filter" data-key="itemType" aria-label="Item type"><option value="">All types</option><option value="Equipment" ${sel(view.itemType, 'Equipment')}>Equipment</option><option value="Consumable" ${sel(view.itemType, 'Consumable')}>Consumable / bulk</option></select>
    <select data-on-change="inventory:filter" data-key="availability" aria-label="Availability"><option value="">Any stock level</option><option value="available" ${sel(view.availability, 'available')}>Available now</option><option value="low" ${sel(view.availability, 'low')}>Low stock</option><option value="out" ${sel(view.availability, 'out')}>Out of stock</option></select>
    <select data-on-change="inventory:filter" data-key="categoryId" aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option value="${c.id}" ${sel(view.categoryId, c.id)}>${esc(c.name)}</option>`).join('')}</select>
    <button class="btn btn-quiet" data-action="inventory:toggle-archived">${view.status === 'archived' ? 'Show active' : 'Show archived'}</button></div>`;
}

registerPage({
  id: 'inventory', title: 'Inventory register', eyebrow: 'Stock intelligence', perm: P.INVENTORY_VIEW,
  subtitle: () => (can(P.INVENTORY_CREATE) ? 'Keep stock accurate, traceable, and ready for the next practical.' : 'Check what is available before you plan your practical.'),
  actions: () => (can(P.INVENTORY_CREATE) ? `<button class="btn btn-primary" data-action="inventory:new">${icon('plus')}Add inventory</button>` : ''),
  async render({ query }) {
    if (query.availability) view.availability = query.availability;
    if (query.search !== undefined) view.search = query.search;
    const [tb, data] = await Promise.all([toolbar(), inventoryApi.list(params())]);
    return `${tb}<section class="panel table-panel" id="inv-results">${resultsHtml(data)}</section>`;
  },
  mount({ query }) { if (query.open) openDetail(Number(query.open)); },
});

// ---- list interactions ---------------------------------------------------------------------------------
onInput('inventory:search', (el) => { view.search = el.value.trim(); view.page = 1; reload(); });
onChange('inventory:filter', (el) => { view[el.dataset.key] = el.value; view.page = 1; reload(); });
onClick('inventory:toggle-archived', (el) => { view.status = view.status === 'archived' ? 'active' : 'archived'; view.page = 1; el.textContent = view.status === 'archived' ? 'Show active' : 'Show archived'; reload(); });
onClick('inventory:sort', (el) => { const k = el.dataset.sort; view.dir = view.sort === k && view.dir === 'asc' ? 'desc' : 'asc'; view.sort = k; reload(); });
onClick('inventory:page', (el) => { view.page = Number(el.dataset.page); reload(); });
onClick('inventory:reload', reload);
onClick('inventory:reset', () => { Object.assign(view, { search: '', itemType: '', availability: '', categoryId: '', status: 'active', page: 1 }); import('../core/router.js').then((r) => r.renderRoute()); });

// ---- detail drawer --------------------------------------------------------------------------------------------------
async function detailBody(id) {
  const [item, trx, audit] = await Promise.all([inventoryApi.get(id), inventoryApi.transactions(id, { pageSize: 8 }), inventoryApi.audit(id).catch(() => [])]);
  const eq = item.itemType === 'Equipment';
  const counts = eq ? Object.entries(item.assetStatusCounts || {}).map(([s, n]) => `${badge(s)} <b>${n}</b>`).join(' &nbsp; ') : '';
  const actions = [];
  if (item.status === 'Active') {
    if (can(P.BORROW_CREATE)) actions.push(`<button class="btn btn-primary btn-small" data-action="requests:new" data-item="${item.id}" data-lab="${item.laboratoryId}">${icon('clipboard')}Request this item</button>`);
    if (can(P.STOCK_MOVE)) actions.push(`<button class="btn btn-quiet btn-small" data-action="inventory:move" data-id="${item.id}">Move stock</button>`);
    if (can(P.INVENTORY_UPDATE)) actions.push(`<button class="btn btn-quiet btn-small" data-action="inventory:edit" data-id="${item.id}">${icon('edit')}Edit</button>`);
    if (can(P.DAMAGE_RECORD) && !eq) actions.push(`<button class="btn btn-quiet btn-small" data-action="damage:new-item" data-id="${item.id}">Report damage / loss</button>`);
    if (eq && can(P.ASSETS_VIEW)) actions.push(`<a class="btn btn-quiet btn-small" href="#/assets?itemId=${item.id}" data-action="ui:close">${icon('scan')}View assets</a>`);
    if (can(P.INVENTORY_ARCHIVE)) actions.push(`<button class="btn btn-danger-outline btn-small" data-action="inventory:archive" data-id="${item.id}">${icon('archive')}Archive</button>`);
  } else if (can(P.INVENTORY_ARCHIVE)) actions.push(`<button class="btn btn-primary btn-small" data-action="inventory:restore" data-id="${item.id}">Restore item</button>`);
  return `<div class="stat-row"><div class="stat-box"><strong class="num">${num(item.quantity)}</strong><small>${eq ? 'Units owned' : 'On hand'} (${esc(item.unit)})</small></div>
      <div class="stat-box"><strong class="num">${num(item.availableQuantity)}</strong><small>Available now</small></div><div class="stat-box"><strong class="num">${num(item.onLoanQuantity)}</strong><small>Out on loan</small></div></div>
    ${item.stockState !== 'ok' && item.status === 'Active' ? `<p class="form-note warn" style="margin-top:12px">${item.stockState === 'out' ? 'Out of stock.' : `Low stock — at or below the minimum of ${num(item.minimumStock)} ${esc(item.unit)}.`}</p>` : ''}
    <div class="drawer-actions">${actions.join('')}</div>
    <h3>Details</h3>${kv([['Item ID', `<code>${esc(item.code)}</code>`], ['Type', item.itemType === 'Equipment' ? 'Equipment (tracked unit by unit)' : 'Consumable / bulk supply'], ['Category', esc(item.categoryName)], ['Laboratory', esc(item.laboratoryName)], ['Location', esc(item.location)], ['Minimum stock', `${num(item.minimumStock)} ${esc(item.unit)}`],
      ['Condition', item.condition ? badge(item.condition) : null], ['Status', badge(item.status)], ['Acquired', item.acquisitionDate ? fmtDate(item.acquisitionDate) : null], ['Source', esc(item.acquisitionSource || '')], ['Description', esc(item.description || '')], ['Remarks', esc(item.remarks || '')], eq ? ['Asset prefix', `<code>${esc(item.assetPrefix || '')}</code>`] : undefined])}
    ${eq ? `<h3>Units by status</h3><div class="chips">${counts || '<span class="muted-small">No units registered.</span>'}</div>` : ''}
    <h3>Stock movement history</h3>${trx.rows.length ? `<table class="mini-table"><thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Balance</th><th>Reason</th></tr></thead><tbody>${trx.rows.map((t) => `<tr><td>${esc(fmtDateTime(t.date))}</td><td>${badge(t.type)}</td><td class="num"><b>${t.quantity > 0 ? '+' : ''}${num(t.quantity)}</b></td><td class="num">${num(t.balanceAfter)}</td><td>${esc(t.reason)}<br><small class="muted-small">${esc(t.userName)}</small></td></tr>`).join('')}</tbody></table>${trx.meta.total > trx.rows.length ? `<p class="muted-small">Showing latest ${trx.rows.length} of ${trx.meta.total} movements.</p>` : ''}` : '<p class="muted-small">No movements recorded.</p>'}
    ${audit.length ? `<h3>Change history</h3><ul class="timeline">${audit.slice(0, 8).map((a) => `<li><strong>${esc(a.action)}</strong><small>${esc(a.userName)} · ${esc(fmtDateTime(a.timestamp))}${a.reason ? ` · ${esc(a.reason)}` : ''}</small></li>`).join('')}</ul>` : ''}`;
}
async function openDetail(id) {
  const el = openLayer(drawerHtml({ eyebrow: 'Inventory item', title: 'Loading…', body: loading() }));
  el.dataset.item = id;
  await paintDetail(el, id);
}
async function paintDetail(el, id) {
  try {
    const item = await inventoryApi.get(id);
    const body = await detailBody(id);
    const next = replaceLayer(el, drawerHtml({ eyebrow: item.code, title: item.name, subtitle: `${esc(item.laboratoryName)} · ${esc(item.categoryName)}`, body }));
    next.dataset.item = id; return next;
  } catch (err) { el.querySelector('.drawer-body').innerHTML = errorBanner(err, 'ui:close'); return el; }
}
/** Refresh whatever inventory view is open after a change. */
async function afterChange(id) {
  const drawer = document.querySelector(`[data-layer][data-item="${id}"]`);
  await Promise.all([reload(), drawer ? paintDetail(drawer, id) : null, refreshBadges()]);
}
onClick('inventory:open', (el) => { if (!window.getSelection()?.toString()) openDetail(Number(el.dataset.id)); });

// ---- create / edit ----------------------------------------------------------------------------------------------------------
async function itemForm(item) {
  const cats = await categories();
  const editing = !!item;
  const l = activeLabs();
  const eq = (item?.itemType ?? 'Equipment') === 'Equipment';
  const defaultLab = item?.laboratoryId ?? (state.workspaceLab || l[0]?.id);
  const body = formShell('inventory:save', `<div class="form-grid">
      ${field({ name: 'name', label: 'Item name', value: item?.name, required: true, span2: true, placeholder: 'e.g. Volumetric flask' })}
      ${editing ? `<div class="field"><span>Item type</span><input value="${esc(item.itemType)}" disabled></div><div class="field"><span>Laboratory</span><input value="${esc(item.laboratoryName)}" disabled></div>`
        : `${field({ name: 'itemType', label: 'Item type', type: 'select', options: ITEM_TYPES, value: 'Equipment', attrs: 'data-on-change="inventory:type-change"', span2: true })}
           ${field({ name: 'laboratoryId', label: 'Laboratory', type: 'select', required: true, options: l.map((x) => ({ value: x.id, label: x.name })), value: defaultLab })}`}
      ${field({ name: 'categoryId', label: 'Category', type: 'select', required: true, options: cats.map((c) => ({ value: c.id, label: c.name })), value: item?.categoryId })}
      ${field({ name: 'unit', label: 'Unit of measurement', value: item?.unit ?? 'unit', required: true })}
      ${editing ? `<div class="field"><span>Quantity</span><input value="${num(item.quantity)} ${esc(item.unit)}" disabled><span class="field-hint">Changed only through stock movements, so every change is recorded.</span></div>`
        : field({ name: 'quantity', label: 'Initial quantity', type: 'number', value: 1, required: true, attrs: 'min="0" step="any"', hint: '<span data-show-for="Equipment">Creates this many individually tagged assets.</span><span data-show-for="Consumable" hidden>Recorded as an opening-balance stock-in.</span>' })}
      ${field({ name: 'minimumStock', label: 'Minimum stock level', type: 'number', value: item?.minimumStock ?? 0, required: true, attrs: 'min="0" step="any"', hint: 'You are warned when stock reaches this level.' })}
      ${!editing || item.itemType === 'Consumable' ? field({ name: 'condition', label: editing ? 'Condition' : 'Condition of new stock', type: 'select', options: CONDITIONS, value: item?.condition ?? 'Good' }) : ''}
      ${!editing ? `<div data-show-for="Equipment" style="display:contents">${field({ name: 'assetPrefix', label: 'Asset ID prefix', placeholder: 'e.g. MIC', hint: 'Tags become MIC-001, MIC-002… Leave empty to derive from the name.', attrs: 'maxlength="6" style="text-transform:uppercase"' })}</div>` : ''}
      ${field({ name: 'location', label: 'Storage location', value: item?.location, required: true, span2: true, placeholder: 'e.g. Science Lab · Cabinet A' })}
      ${field({ name: 'acquisitionDate', label: 'Acquisition date', type: 'date', value: item?.acquisitionDate ?? '' })}
      ${field({ name: 'acquisitionSource', label: 'Acquisition source', value: item?.acquisitionSource ?? '' })}
      ${field({ name: 'description', label: 'Description', type: 'textarea', value: item?.description ?? '', span2: true, rows: 2 })}
      ${field({ name: 'remarks', label: 'Remarks', type: 'textarea', value: item?.remarks ?? '', span2: true, rows: 2 })}</div>`,
    { submit: editing ? 'Save changes' : 'Add item', data: `data-id="${item?.id ?? ''}"`, cls: '' });
  return modalHtml({ eyebrow: editing ? 'Edit record' : 'New record', title: editing ? 'Update inventory item' : 'Add inventory item', body, size: 'wide' });
}
onClick('inventory:new', async () => { openLayer(await itemForm(null)); });
onClick('inventory:edit', async (el) => { const item = await inventoryApi.get(Number(el.dataset.id)); openLayer(await itemForm(item)); });
onChange('inventory:type-change', (el) => {
  const form = el.closest('form');
  form.querySelectorAll('[data-show-for]').forEach((n) => { n.hidden = n.dataset.showFor !== el.value; });
  const q = form.querySelector('[name="quantity"]'); if (q) q.step = el.value === 'Equipment' ? '1' : 'any';
});
onSubmit('inventory:save', (form) => submitForm(form, async (v) => {
  const id = form.dataset.id;
  const saved = id ? await inventoryApi.update(Number(id), v) : await inventoryApi.create(v);
  closeLayer(form.closest('[data-layer]'));
  toast(id ? `${saved.name} updated.` : `${saved.name} added (${saved.code}).`);
  await afterChange(saved.id);
}));

// ---- stock movements (UC-005) -----------------------------------------------------------------------------------------------
async function moveForm(item) {
  const eq = item.itemType === 'Equipment';
  const types = eq ? ['Stock-in'] : ['Stock-in', 'Stock-out', ...(can(P.STOCK_ADJUST) ? ['Adjustment'] : []), 'Transfer'];
  const others = activeLabs().filter((x) => x.id !== item.laboratoryId);
  const typeLabels = { 'Stock-in': eq ? 'Register new units (stock-in)' : 'Stock-in (received)', 'Stock-out': 'Stock-out (used / removed)', Adjustment: 'Adjustment (physical count)', Transfer: 'Transfer to another laboratory' };
  const body = formShell('inventory:move-save', `<input type="hidden" name="expectedQuantity" value="${item.quantity}">
    ${field({ name: 'type', label: 'Movement type', type: 'select', options: types.map((t) => ({ value: t, label: typeLabels[t] })), attrs: 'data-on-change="inventory:move-type"' })}
    ${eq ? '<p class="form-note">Equipment is tracked unit by unit. To remove a unit, retire it or report it lost from the asset record.</p>' : ''}
    <div data-show-for="Stock-in Stock-out Transfer">${field({ name: 'quantity', label: eq ? 'Number of units' : 'Quantity', type: 'number', attrs: 'min="0" step="any"', required: true })}</div>
    <div data-show-for="Stock-in">${field({ name: 'source', label: 'Source or reason', placeholder: 'Supplier, donation, procurement…', required: true })}</div>
    <div data-show-for="Stock-out" hidden>${field({ name: 'reason', label: 'Reason', type: 'select', options: STOCK_OUT_REASONS, hint: 'Damage and Loss also create a damage/loss record.' })}</div>
    <div data-show-for="Adjustment" hidden>${field({ name: 'newQuantity', label: 'Physical count', type: 'number', value: item.quantity, attrs: 'min="0" step="any"', hint: `System quantity is ${num(item.quantity)} ${esc(item.unit)}. The difference is recorded.` })}${field({ name: 'adjReason', label: 'Reason for adjustment', placeholder: 'e.g. Quarterly stock count' })}</div>
    <div data-show-for="Transfer" hidden>${field({ name: 'targetLaboratoryId', label: 'Destination laboratory', type: 'select', options: others.length ? others.map((x) => ({ value: x.id, label: x.name })) : [{ value: '', label: 'No other laboratory available' }] })}</div>
    ${field({ name: 'remarks', label: 'Remarks (optional)', type: 'textarea', rows: 2 })}`, { submit: 'Record movement', data: `data-id="${item.id}"` });
  return modalHtml({ eyebrow: 'Inventory movement', title: `Move stock — ${item.name}`, subtitle: `Current balance: <strong>${num(item.quantity)} ${esc(item.unit)}</strong>`, body });
}
function syncMoveSections(form) {
  const t = form.querySelector('[name="type"]').value;
  form.querySelectorAll('[data-show-for]').forEach((n) => { n.hidden = !n.dataset.showFor.split(' ').includes(t); });
}
onClick('inventory:move', async (el) => { const item = await inventoryApi.get(Number(el.dataset.id)); const layer = openLayer(await moveForm(item)); syncMoveSections(layer.querySelector('form')); });
onChange('inventory:move-type', (el) => syncMoveSections(el.closest('form')));
onSubmit('inventory:move-save', (form) => submitForm(form, async (v) => {
  const id = Number(form.dataset.id);
  const body = { type: v.type, remarks: v.remarks, expectedQuantity: v.expectedQuantity };
  if (v.type === 'Stock-in') Object.assign(body, { quantity: v.quantity, source: v.source });
  if (v.type === 'Stock-out') Object.assign(body, { quantity: v.quantity, reason: v.reason });
  if (v.type === 'Adjustment') Object.assign(body, { newQuantity: v.newQuantity, reason: v.adjReason });
  if (v.type === 'Transfer') Object.assign(body, { quantity: v.quantity, targetLaboratoryId: v.targetLaboratoryId });
  if (v.type !== 'Adjustment') delete body.expectedQuantity;
  const item = await inventoryApi.move(id, body);
  closeLayer(form.closest('[data-layer]'));
  toast(`${v.type} recorded. ${item.name} now has ${num(item.quantity)} ${item.unit}.`);
  await afterChange(id);
}));

// ---- archive / restore ---------------------------------------------------------------------------------------------------------------
onClick('inventory:archive', async (el) => {
  const id = Number(el.dataset.id);
  const ok = await confirmDialog({ title: 'Archive this item?', message: 'It will disappear from active lists and can no longer be borrowed or changed. All history is kept and the item can be restored.', label: 'Archive item', reasonLabel: 'Reason (optional)' });
  if (!ok) return;
  await inventoryApi.archive(id, ok.reason);
  toast('Item archived.');
  await afterChange(id);
});
onClick('inventory:restore', async (el) => { const id = Number(el.dataset.id); await inventoryApi.restore(id); toast('Item restored.'); await afterChange(id); });
export { openDetail as openInventoryDetail, afterChange as afterInventoryChange };
