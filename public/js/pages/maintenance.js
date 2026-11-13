// -----------------------------------------------------------------------------
// pages/maintenance.js — UC-012 maintenance records + damage/loss records
// (FR-019…FR-022). Logging maintenance takes an asset offline; completing it
// puts the asset back with a new condition — the server keeps both in step.
// -----------------------------------------------------------------------------
import { esc, fmtDate, fmtDateTime, num } from '../core/format.js';
import { icon } from '../core/icons.js';
import { registerPage, current, renderRoute } from '../core/router.js';
import { onClick, onChange, onSubmit } from '../core/events.js';
import { maintenanceApi, assetsApi, damageApi, inventoryApi } from '../services/index.js';
import { badge, pager, emptyState, field, formShell, modalHtml, openLayer, closeLayer, submitForm, toast, errorBanner } from '../core/ui.js';
import { state, can, wsParams } from '../core/state.js';
import { P } from '../core/permissions.js';
import { CONDITIONS } from '../core/constants.js';
import { refreshBadges } from '../components/shell.js';
import { afterAssetChange } from './assets.js';
import { afterInventoryChange } from './inventory.js';

const view = { status: 'All', page: 1 };
const params = () => ({ ...wsParams(), status: view.status === 'All' ? '' : view.status, page: view.page, pageSize: 20 });

function listHtml({ rows, meta }, dmg) {
  const c = meta.statusCounts || {};
  const open = (c.Open || 0) + (c['In Progress'] || 0);
  return `<div class="maintenance-summary"><div class="mini-stat"><span class="attention-icon amber">${icon('wrench')}</span><div><strong>${open}</strong><small>Open records</small></div></div>
    <div class="mini-stat"><span class="attention-icon mint">${icon('shield')}</span><div><strong>${c.Completed || 0}</strong><small>Completed</small></div></div>
    <div class="mini-stat"><span class="attention-icon blue">${icon('scan')}</span><div><strong>${open}</strong><small>Assets offline</small></div></div></div>
  <div class="tabs panel">${['All', 'Open', 'In Progress', 'Completed'].map((s) => `<button class="tab ${view.status === s ? 'active' : ''}" data-action="maintenance:tab" data-status="${s}">${s}<b>${s === 'All' ? Object.values(c).reduce((a, n) => a + n, 0) : c[s] || 0}</b></button>`).join('')}</div>
  <section class="panel table-panel"><div class="panel-head"><div><p class="eyebrow">Care log</p><h2>Maintenance history</h2></div><span class="panel-meta">Issue → action → completion</span></div>
  <div class="maintenance-list">${rows.map((m) => `<div class="maintenance-row"><div class="maint-id"><code>${esc(m.code)}</code><span>${fmtDate(m.dateReported.slice(0, 10))}</span></div>
    <div class="maint-main"><strong>${esc(m.itemName)} · ${esc(m.assetTag)}</strong><p>${esc(m.reportedIssue)}</p><small>${m.maintenanceAction ? `Action: ${esc(m.maintenanceAction)}` : 'No action recorded yet'} · ${esc(m.laboratoryName)}</small></div>
    <div><span class="muted-label">Responsible</span><strong>${esc(m.responsiblePerson || '—')}</strong></div><div>${badge(m.status)}</div>
    <div>${m.status !== 'Completed' && can(P.MAINTENANCE_MANAGE) ? `<button class="btn btn-small btn-quiet" data-action="maintenance:update" data-id="${m.id}">Update</button> <button class="btn btn-small btn-primary" data-action="maintenance:complete" data-id="${m.id}">Complete</button>` : `<span class="completed-date">${m.dateCompleted ? fmtDate(m.dateCompleted.slice(0, 10)) : ''}</span>`}</div></div>`).join('')
    || emptyState('wrench', 'No maintenance records', 'Equipment that needs care will appear here.')}</div>${pager(meta, 'maintenance:page')}</section>
  <section class="panel table-panel" style="margin-top:18px"><div class="panel-head"><div><p class="eyebrow">Incident log</p><h2>Damage & loss records</h2></div><span class="panel-meta">${dmg.meta.total} record${dmg.meta.total === 1 ? '' : 's'}</span></div>
  <div class="table-wrap"><table><thead><tr><th>Record</th><th>Type</th><th>Item</th><th>Qty</th><th>Description</th><th>Reported</th></tr></thead><tbody>${dmg.rows.map((d) => `<tr><td><code>${esc(d.code)}</code></td><td>${badge(d.recordType)}</td><td><strong>${esc(d.itemName)}</strong>${d.assetTag ? `<small class="table-sub">${esc(d.assetTag)}</small>` : ''}</td><td>${num(d.quantity)} ${esc(d.unit)}</td><td>${esc(d.description)}${d.actionTaken ? `<small class="table-sub">Action: ${esc(d.actionTaken)}</small>` : ''}</td><td>${fmtDate(d.dateRecorded.slice(0, 10))}<small class="table-sub">${esc(d.reportedBy)}</small></td></tr>`).join('')
    || `<tr><td colspan="6">${emptyState('shield', 'Nothing damaged or lost', 'Incidents are recorded here and on the asset.')}</td></tr>`}</tbody></table></div></section>`;
}
async function data() { return Promise.all([maintenanceApi.list(params()), damageApi.list({ ...wsParams(), pageSize: 15 }).catch(() => ({ rows: [], meta: { total: 0 } }))]); }
async function reload() { const h = document.getElementById('maint-results'); if (!h) return; try { const [m, d] = await data(); h.innerHTML = listHtml(m, d); } catch (e) { h.innerHTML = errorBanner(e, 'maintenance:reload'); } }
onClick('maintenance:reload', reload);

registerPage({
  id: 'maintenance', title: 'Maintenance', eyebrow: 'Care & continuity', perm: P.MAINTENANCE_VIEW,
  subtitle: 'Equipment under care is kept out of circulation until it is verified.',
  actions: () => `${can(P.DAMAGE_RECORD) ? `<button class="btn btn-quiet" data-action="damage:new">Report damage / loss</button>` : ''}${can(P.MAINTENANCE_MANAGE) ? `<button class="btn btn-primary" data-action="maintenance:new">${icon('plus')}Log maintenance</button>` : ''}`,
  async render() { const [m, d] = await data(); return `<div id="maint-results">${listHtml(m, d)}</div>`; },
});
onClick('maintenance:tab', (el) => { view.status = el.dataset.status; view.page = 1; reload(); });
onClick('maintenance:page', (el) => { view.page = Number(el.dataset.page); reload(); });
async function after(assetId) { await Promise.all([current().id === 'maintenance' ? reload() : null, afterAssetChange(assetId), refreshBadges()]); }

// ---- log maintenance -----------------------------------------------------------------------------------------------------------------
async function assetOptions(excludeStatuses) {
  const { rows } = await assetsApi.list({ ...wsParams(), pageSize: 200, sort: 'tag' });
  return rows.filter((a) => !excludeStatuses.includes(a.status)).map((a) => ({ value: a.id, label: `${a.tag} — ${a.itemName} (${a.status})` }));
}
onClick('maintenance:new', async (el) => {
  const opts = await assetOptions(['Borrowed', 'Lost', 'Retired', 'Under Maintenance']);
  openLayer(modalHtml({ eyebrow: 'Care log', title: 'Log maintenance', subtitle: 'The asset goes offline until maintenance is completed.', body: formShell('maintenance:create', `
    ${field({ name: 'assetId', label: 'Asset', type: 'select', required: true, options: opts, value: el.dataset.asset ?? '' })}
    ${field({ name: 'reportedIssue', label: 'Reported issue', type: 'textarea', rows: 2, required: true, placeholder: 'Describe what needs attention' })}
    ${field({ name: 'maintenanceAction', label: 'Planned action', type: 'textarea', rows: 2, placeholder: 'Repair, replace, inspect…' })}
    ${field({ name: 'responsiblePerson', label: 'Responsible person', required: true, value: state.me.name })}`, { submit: 'Create record' }) }));
});
onSubmit('maintenance:create', (form) => submitForm(form, async (v) => {
  const m = await maintenanceApi.create(v); closeLayer(form.closest('[data-layer]')); toast(`${m.code} logged — ${m.assetTag} is now offline.`); await after(m.assetId);
}));
onClick('maintenance:update', async (el) => {
  const { rows } = await maintenanceApi.list({ pageSize: 100 });
  const m = rows.find((r) => r.id === Number(el.dataset.id));
  openLayer(modalHtml({ eyebrow: m.code, title: 'Update progress', body: formShell('maintenance:progress', `
    ${field({ name: 'status', label: 'Status', type: 'select', options: ['Open', 'In Progress'], value: m.status })}
    ${field({ name: 'maintenanceAction', label: 'Action / notes', type: 'textarea', rows: 2, value: m.maintenanceAction ?? '' })}
    ${field({ name: 'responsiblePerson', label: 'Responsible person', required: true, value: m.responsiblePerson ?? '' })}${field({ name: 'remarks', label: 'Remarks', value: m.remarks ?? '' })}`, { data: `data-id="${m.id}" data-asset="${m.assetId}"` }) }));
});
onSubmit('maintenance:progress', (form) => submitForm(form, async (v) => { await maintenanceApi.update(Number(form.dataset.id), v); closeLayer(form.closest('[data-layer]')); toast('Maintenance updated.'); await after(Number(form.dataset.asset)); }));
onClick('maintenance:complete', async (el) => {
  const { rows } = await maintenanceApi.list({ pageSize: 100 });
  const m = rows.find((r) => r.id === Number(el.dataset.id));
  openLayer(modalHtml({ eyebrow: `${m.code} · ${m.assetTag}`, title: 'Complete maintenance', subtitle: esc(m.reportedIssue), body: formShell('maintenance:complete-save', `
    ${field({ name: 'maintenanceAction', label: 'Work performed', type: 'textarea', rows: 2, required: true, value: m.maintenanceAction ?? '' })}
    <div class="form-grid">${field({ name: 'resultCondition', label: 'Condition after maintenance', type: 'select', options: CONDITIONS, value: 'Good' })}${field({ name: 'resultStatus', label: 'Return asset as', type: 'select', options: ['Available', 'Under Inspection', 'Retired'], value: 'Available' })}</div>
    ${field({ name: 'remarks', label: 'Remarks', value: m.remarks ?? '' })}`, { submit: 'Mark completed', data: `data-id="${m.id}" data-asset="${m.assetId}"` }) }));
});
onSubmit('maintenance:complete-save', (form) => submitForm(form, async (v) => { const m = await maintenanceApi.complete(Number(form.dataset.id), v); closeLayer(form.closest('[data-layer]')); toast(`${m.code} completed.`); await after(Number(form.dataset.asset)); }));

// ---- damage / loss (UC-012) ---------------------------------------------------------------------------------------------------------------
function damageModal({ assetLabel, assetId, itemId, itemLabel, assetOpts }) {
  const bulk = !!itemId;
  return modalHtml({ eyebrow: 'Incident record', title: 'Report damage or loss', subtitle: esc(assetLabel || itemLabel || ''), body: formShell('damage:save', `
    ${assetOpts ? field({ name: 'assetId', label: 'Asset', type: 'select', required: true, options: assetOpts }) : ''}
    <div class="form-grid">${field({ name: 'recordType', label: 'What happened?', type: 'select', options: [{ value: 'Damage', label: 'Damaged' }, { value: 'Loss', label: 'Lost / missing' }], attrs: 'data-on-change="damage:type"' })}
    ${bulk ? field({ name: 'quantity', label: 'Quantity affected', type: 'number', value: 1, required: true, attrs: 'min="0" step="any"' }) : `<div data-damage-only>${field({ name: 'currentCondition', label: 'Condition now', type: 'select', options: ['Fair', 'Damaged', 'Non-functional'], value: 'Damaged' })}</div>`}</div>
    ${field({ name: 'description', label: 'Description', type: 'textarea', rows: 2, required: true, placeholder: 'What happened, and how was it found?' })}${field({ name: 'actionTaken', label: 'Action taken', placeholder: 'e.g. Set aside for repair quote' })}`,
    { submit: 'Record', data: `data-asset="${assetId ?? ''}" data-item="${itemId ?? ''}"` }) });
}
onChange('damage:type', (el) => { const box = el.closest('form').querySelector('[data-damage-only]'); if (box) box.hidden = el.value !== 'Damage'; });
onClick('damage:new-asset', async (el) => { const a = await assetsApi.get(Number(el.dataset.id)); openLayer(damageModal({ assetId: a.id, assetLabel: `${a.tag} — ${a.itemName}` })); });
onClick('damage:new-item', async (el) => { const i = await inventoryApi.get(Number(el.dataset.id)); openLayer(damageModal({ itemId: i.id, itemLabel: `${i.name} — ${num(i.quantity)} ${i.unit} on hand` })); });
onClick('damage:new', async () => openLayer(damageModal({ assetOpts: await assetOptions(['Borrowed', 'Lost', 'Retired']) })));
onSubmit('damage:save', (form) => submitForm(form, async (v) => {
  const body = { recordType: v.recordType, description: v.description, actionTaken: v.actionTaken };
  const assetId = Number(form.dataset.asset || v.assetId) || null, itemId = Number(form.dataset.item) || null;
  if (assetId) { body.assetId = assetId; if (v.recordType === 'Damage') body.currentCondition = v.currentCondition; } else { body.itemId = itemId; body.quantity = v.quantity; }
  await damageApi.record(body); closeLayer(form.closest('[data-layer]'));
  toast(v.recordType === 'Loss' ? 'Loss recorded.' : 'Damage recorded.');
  await Promise.all([after(assetId), itemId ? afterInventoryChange(itemId) : null]);
}));
