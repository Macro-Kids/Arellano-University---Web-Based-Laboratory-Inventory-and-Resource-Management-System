// -----------------------------------------------------------------------------
// pages/assets.js — UC-006 Manage Equipment and Assets (FR-011/012/013).
// Statuses that other workflows own (Borrowed, Under Maintenance, Damaged, Lost)
// cannot be set by hand here; the buttons route you to the right workflow instead.
// -----------------------------------------------------------------------------
import { esc, fmtDate, fmtDateTime } from '../core/format.js';
import { icon } from '../core/icons.js';
import { registerPage, renderRoute } from '../core/router.js';
import { onClick, onInput, onChange, onSubmit } from '../core/events.js';
import { assetsApi, inventoryApi } from '../services/index.js';
import { badge, pager, sortTh, emptyState, loading, field, formShell, modalHtml, drawerHtml, openLayer, closeLayer, replaceLayer, submitForm, toast, kv, errorBanner } from '../core/ui.js';
import { can, labs, activeLabs, wsParams } from '../core/state.js';
import { P } from '../core/permissions.js';
import { ASSET_STATUSES, CONDITIONS } from '../core/constants.js';
import { refreshBadges } from '../components/shell.js';

const view = { search: '', status: '', condition: '', itemId: '', sort: 'tag', dir: 'asc', page: 1 };
const params = () => ({ ...wsParams(), search: view.search, status: view.status, condition: view.condition, itemId: view.itemId, sort: view.sort, dir: view.dir, page: view.page, pageSize: 25 });
const multiLab = () => labs().length > 1;

function tableHtml({ rows, meta }) {
  return `<div class="panel-head"><div><p class="eyebrow">Serialized equipment</p><h2>Tracked assets</h2></div><span class="panel-meta">${meta.total} asset${meta.total === 1 ? '' : 's'} · condition checked at every return</span></div>
  <div class="table-wrap"><table><thead><tr>${sortTh('Asset ID', 'tag', view, 'assets:sort')}${sortTh('Item', 'item', view, 'assets:sort')}${multiLab() ? '<th>Laboratory</th>' : ''}<th>Serial</th>${sortTh('Status', 'status', view, 'assets:sort')}${sortTh('Condition', 'condition', view, 'assets:sort')}</tr></thead>
  <tbody>${rows.map((a) => `<tr class="clickable" data-action="assets:open" data-id="${a.id}"><td><code>${esc(a.tag)}</code></td><td><strong>${esc(a.itemName)}</strong><small class="table-sub">${esc(a.itemCode)}</small></td>${multiLab() ? `<td>${esc(a.laboratoryName)}</td>` : ''}<td><code>${esc(a.serialNumber || '—')}</code></td>
    <td>${badge(a.status)}${a.heldBy ? `<small class="table-sub">${esc(a.heldBy.borrower)} · due ${fmtDate(a.heldBy.expectedReturn)}</small>` : ''}</td><td>${badge(a.condition)}</td></tr>`).join('')
    || `<tr><td colspan="6">${emptyState('scan', 'No assets match', 'Try a different search or clear the filters.')}</td></tr>`}</tbody></table></div>${pager(meta, 'assets:page')}`;
}
async function reload() { const h = document.getElementById('asset-results'); if (!h) return; try { h.innerHTML = tableHtml(await assetsApi.list(params())); } catch (e) { h.innerHTML = errorBanner(e, 'assets:reload'); } }
onClick('assets:reload', reload);

registerPage({
  id: 'assets', title: 'Tracked assets', eyebrow: 'Equipment register', perm: P.ASSETS_VIEW,
  subtitle: 'Every unit has its own ID, status and history — so you always know who has it.',
  actions: () => (can(P.ASSETS_REGISTER) ? `<button class="btn btn-primary" data-action="assets:new">${icon('plus')}Register asset</button>` : ''),
  async render({ query }) {
    view.itemId = query.itemId || '';
    if (query.status) view.status = query.status;
    const data = await assetsApi.list(params());
    const filtered = view.itemId && data.rows[0] ? `<span class="badge" style="align-self:center">Item: ${esc(data.rows[0].itemName)} <a href="#/assets" data-action="assets:clear-item" style="margin-left:6px">✕</a></span>` : '';
    return `<div class="toolbar panel"><div class="search-field">${icon('search')}<input data-on-input="assets:search" placeholder="Search asset ID, serial, item…" aria-label="Search assets" value="${esc(view.search)}"></div>
      <select data-on-change="assets:filter" data-key="status" aria-label="Status"><option value="">All statuses</option>${ASSET_STATUSES.map((s) => `<option ${view.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select data-on-change="assets:filter" data-key="condition" aria-label="Condition"><option value="">Any condition</option>${CONDITIONS.map((s) => `<option ${view.condition === s ? 'selected' : ''}>${s}</option>`).join('')}</select>${filtered}</div>
      <section class="panel table-panel" id="asset-results">${tableHtml(data)}</section>`;
  },
  mount({ query }) { if (query.open) openDetail(Number(query.open)); },
});
onInput('assets:search', (el) => { view.search = el.value.trim(); view.page = 1; reload(); });
onChange('assets:filter', (el) => { view[el.dataset.key] = el.value; view.page = 1; reload(); });
onClick('assets:sort', (el) => { const k = el.dataset.sort; view.dir = view.sort === k && view.dir === 'asc' ? 'desc' : 'asc'; view.sort = k; reload(); });
onClick('assets:page', (el) => { view.page = Number(el.dataset.page); reload(); });
onClick('assets:clear-item', () => { view.itemId = ''; });

// ---- detail ----------------------------------------------------------------------------------------------------------------
function detail(a) {
  const h = a.history, acts = [];
  const movable = !['Borrowed', 'Lost'].includes(a.status);
  if (can(P.ASSETS_UPDATE) && a.status !== 'Borrowed') acts.push(`<button class="btn btn-primary btn-small" data-action="assets:state" data-id="${a.id}">Update status / condition</button>`);
  if (can(P.MAINTENANCE_MANAGE) && !['Borrowed', 'Lost', 'Retired', 'Under Maintenance'].includes(a.status)) acts.push(`<button class="btn btn-quiet btn-small" data-action="maintenance:new" data-asset="${a.id}">${icon('wrench')}Log maintenance</button>`);
  if (can(P.DAMAGE_RECORD) && !['Borrowed', 'Lost', 'Retired'].includes(a.status)) acts.push(`<button class="btn btn-quiet btn-small" data-action="damage:new-asset" data-id="${a.id}">Report damage / loss</button>`);
  if (can(P.ASSETS_UPDATE) && movable) acts.push(`<button class="btn btn-quiet btn-small" data-action="assets:edit" data-id="${a.id}">${icon('edit')}Edit details</button>`);
  return `<div class="drawer-actions">${acts.join('')}</div>
   ${a.heldBy ? `<p class="form-note warn"><b>${esc(a.heldBy.borrower)}</b> has this unit — borrowed ${fmtDate(a.heldBy.releaseDate?.slice(0, 10))}, due back <b>${fmtDate(a.heldBy.expectedReturn)}</b>. <a href="#/requests?open=${a.heldBy.requestId}" data-action="ui:close" style="color:var(--blue);font-weight:800">View request</a></p>` : ''}
   ${a.status === 'Under Maintenance' ? `<p class="form-note warn">Under maintenance — complete the record on the <a href="#/maintenance" data-action="ui:close" style="color:var(--blue);font-weight:800">Maintenance</a> page to put it back in service.</p>` : ''}
   <h3>Details</h3>${kv([['Asset ID', `<code>${esc(a.tag)}</code>`], ['Item', `${esc(a.itemName)} <small class="muted-small">${esc(a.itemCode)}</small>`], ['Laboratory', esc(a.laboratoryName)], ['Serial number', esc(a.serialNumber || '')], ['Status', badge(a.status)], ['Condition', badge(a.condition)], ['Registered', fmtDateTime(a.createdAt)], ['Remarks', esc(a.remarks || '')]])}
   <h3>Maintenance history</h3>${h.maintenance.length ? `<table class="mini-table"><thead><tr><th>Reported</th><th>Issue</th><th>Status</th></tr></thead><tbody>${h.maintenance.map((m) => `<tr><td>${fmtDate(m.dateReported.slice(0, 10))}</td><td>${esc(m.reportedIssue)}<br><small class="muted-small">${esc(m.action || '')}</small></td><td>${badge(m.status)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted-small">None recorded.</p>'}
   <h3>Damage & loss</h3>${h.damageLoss.length ? `<table class="mini-table"><tbody>${h.damageLoss.map((d) => `<tr><td>${badge(d.recordType)}</td><td>${esc(d.description)}<br><small class="muted-small">${esc(d.reportedBy)} · ${fmtDate(d.dateRecorded.slice(0, 10))}</small></td></tr>`).join('')}</tbody></table>` : '<p class="muted-small">None recorded.</p>'}
   <h3>Borrowing history</h3>${h.borrowing.length ? `<table class="mini-table"><thead><tr><th>Request</th><th>Borrower</th><th>Released</th></tr></thead><tbody>${h.borrowing.map((b) => `<tr><td><a href="#/requests?open=${b.requestId}" data-action="ui:close" style="color:var(--blue)">${esc(b.requestCode)}</a></td><td>${esc(b.borrower)}</td><td>${fmtDate(b.releaseDate.slice(0, 10))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted-small">Never borrowed.</p>'}
   <h3>Change history</h3><ul class="timeline">${h.audit.slice(0, 10).map((x) => `<li><strong>${esc(x.action)}</strong><small>${esc(x.userName)} · ${esc(fmtDateTime(x.timestamp))}${x.reason ? ` · ${esc(x.reason)}` : ''}</small></li>`).join('')}</ul>`;
}
async function openDetail(id) {
  const el = openLayer(drawerHtml({ eyebrow: 'Asset', title: 'Loading…', body: loading() })); el.dataset.asset = id; await paint(el, id);
}
async function paint(el, id) {
  try { const a = await assetsApi.get(id); replaceLayer(el, drawerHtml({ eyebrow: a.tag, title: a.itemName, subtitle: esc(a.laboratoryName), body: detail(a) })).dataset.asset = id; }
  catch (e) { el.querySelector('.drawer-body').innerHTML = errorBanner(e, 'ui:close'); }
}
export async function afterAssetChange(id) {
  const d = id && document.querySelector(`[data-layer][data-asset="${id}"]`);
  await Promise.all([reload(), d ? paint(d, id) : null, refreshBadges()]);
}
onClick('assets:open', (el) => openDetail(Number(el.dataset.id)));

// ---- forms ----------------------------------------------------------------------------------------------------------------------
onClick('assets:new', async () => {
  const items = (await inventoryApi.lookup(wsParams())).filter((i) => i.itemType === 'Equipment');
  if (!items.length) { toast('Add an Equipment item in Inventory first — assets belong to equipment items.', 'info'); return; }
  openLayer(modalHtml({ eyebrow: 'Equipment register', title: 'Register asset', subtitle: 'Adds one individually tracked unit to an equipment item.', body: formShell('assets:register', `<div class="form-grid">
    ${field({ name: 'itemId', label: 'Equipment item', type: 'select', required: true, span2: true, options: items.map((i) => ({ value: i.id, label: `${i.name} — ${i.laboratoryName}` })) })}
    ${field({ name: 'assetTag', label: 'Asset ID', placeholder: 'Auto (e.g. MIC-013)', hint: 'Leave empty to generate the next free ID.', attrs: 'style="text-transform:uppercase"' })}
    ${field({ name: 'serialNumber', label: 'Serial number' })}${field({ name: 'condition', label: 'Condition', type: 'select', options: CONDITIONS, value: 'Good' })}
    ${field({ name: 'remarks', label: 'Remarks', span2: true })}</div>`, { submit: 'Register asset', cls: '' }) }));
});
onSubmit('assets:register', (form) => submitForm(form, async (v) => {
  const a = await assetsApi.register(v); closeLayer(form.closest('[data-layer]')); toast(`${a.tag} registered.`); await afterAssetChange(null);
}));
onClick('assets:edit', async (el) => {
  const a = await assetsApi.get(Number(el.dataset.id));
  openLayer(modalHtml({ eyebrow: a.tag, title: 'Edit asset details', body: formShell('assets:edit-save', `${field({ name: 'serialNumber', label: 'Serial number', value: a.serialNumber ?? '' })}${field({ name: 'remarks', label: 'Remarks', type: 'textarea', value: a.remarks ?? '', rows: 2 })}`, { data: `data-id="${a.id}"` }) }));
});
onSubmit('assets:edit-save', (form) => submitForm(form, async (v) => { const id = Number(form.dataset.id); await assetsApi.update(id, v); closeLayer(form.closest('[data-layer]')); toast('Asset updated.'); await afterAssetChange(id); }));

const MANUAL = ['Available', 'In Use', 'Under Inspection', 'Retired'];
onClick('assets:state', async (el) => {
  const a = await assetsApi.get(Number(el.dataset.id));
  const opts = [...new Set([a.status, ...MANUAL])].map((s) => ({ value: s, label: s, disabled: !MANUAL.includes(s) && s !== a.status }));
  openLayer(modalHtml({ eyebrow: a.tag, title: 'Update status / condition', subtitle: 'Damaged, Lost and Under Maintenance are set through their own workflows so records stay complete.', body: formShell('assets:state-save', `<div class="form-grid">
    ${field({ name: 'status', label: 'Status', type: 'select', options: opts, value: a.status })}${field({ name: 'condition', label: 'Condition', type: 'select', options: CONDITIONS, value: a.condition })}
    ${field({ name: 'reason', label: 'Reason', type: 'textarea', rows: 2, required: true, span2: true, placeholder: 'Why is this changing?' })}</div>`, { data: `data-id="${a.id}" data-status="${a.status}" data-condition="${a.condition}"`, cls: '' }) }));
});
onSubmit('assets:state-save', (form) => submitForm(form, async (v) => {
  const id = Number(form.dataset.id);
  const body = { reason: v.reason };
  if (v.status !== form.dataset.status) body.status = v.status;
  if (v.condition !== form.dataset.condition) body.condition = v.condition;
  await assetsApi.setState(id, body); closeLayer(form.closest('[data-layer]')); toast('Asset updated.'); await afterAssetChange(id);
}));
export { openDetail as openAssetDetail };
