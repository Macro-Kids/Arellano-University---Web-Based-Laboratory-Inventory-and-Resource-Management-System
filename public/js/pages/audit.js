// -----------------------------------------------------------------------------
// pages/audit.js — UC-014 View Audit History (FR-032). Read-only by design:
// there is no edit or delete anywhere, and the database refuses them too.
// -----------------------------------------------------------------------------
import { esc, fmtDateTime, initials } from '../core/format.js';
import { icon } from '../core/icons.js';
import { registerPage } from '../core/router.js';
import { onClick, onInput, onChange } from '../core/events.js';
import { auditApi } from '../services/index.js';
import { pager, emptyState, errorBanner } from '../core/ui.js';
import { wsParams } from '../core/state.js';
import { P } from '../core/permissions.js';

const view = { search: '', entity: '', action: '', from: '', to: '', page: 1 };
const q = () => ({ ...wsParams(), search: view.search, entity: view.entity, action: view.action, from: view.from, to: view.to });

function detailText(a) {
  const fmt = (v) => (v && typeof v === 'object' ? JSON.stringify(v, null, 1).replace(/[{}"]/g, '').trim() : v ?? '');
  return [a.previous ? `Before:\n${fmt(a.previous)}` : '', a.next ? `After:\n${fmt(a.next)}` : '', a.reason ? `Reason: ${a.reason}` : ''].filter(Boolean).join('\n\n');
}
function listHtml({ rows, meta }) {
  return `<section class="panel audit-hero"><div class="audit-seal">${icon('shield')}</div><div><p class="eyebrow">Append-only record</p><h2>A record of every decision</h2><p>Stock, asset, request, maintenance and account changes are logged automatically with who, when and why. Entries cannot be edited or removed.</p></div><span class="audit-count">${meta.total}<small>events match</small></span></section>
  <section class="panel table-panel"><div class="panel-head"><div><p class="eyebrow">Chronological log</p><h2>Audit trail</h2></div><a class="btn btn-quiet" href="${auditApi.csvUrl(q())}">${icon('download')}Export CSV</a></div>
  <div class="audit-list">${rows.map((a) => `<div class="audit-row clickable" data-action="audit:toggle" data-id="${a.id}"><span class="audit-dot"></span><div class="audit-time"><strong>${esc(fmtDateTime(a.timestamp).split(',').slice(0, 2).join(','))}</strong><span>${esc(new Date(a.timestamp).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }))}</span></div>
    <div class="audit-action"><strong>${esc(a.action)}</strong><p>${esc(a.summary || a.reason || '')}</p><pre class="diff" data-detail="${a.id}" hidden>${esc(detailText(a))}</pre></div>
    <div class="audit-entity"><span>${esc(a.entity)}</span><code>${esc(a.recordCode)}</code></div><div class="audit-user"><span class="avatar tiny">${esc(initials(a.userName))}</span>${esc(a.userName)}</div></div>`).join('')
    || emptyState('shield', 'No audit entries match', 'Adjust the filters to see more events.')}</div>${pager(meta, 'audit:page')}</section>`;
}
async function reload() { const h = document.getElementById('audit-body'); if (!h) return; try { h.innerHTML = listHtml(await auditApi.list({ ...q(), page: view.page, pageSize: 30 }).then((r) => r)); } catch (e) { h.innerHTML = errorBanner(e, 'audit:reload'); } }

registerPage({
  id: 'audit', title: 'Audit trail', eyebrow: 'Trust & traceability', perm: P.AUDIT_VIEW, subtitle: 'Who changed what, when, and why.',
  async render() {
    const [data, facets] = await Promise.all([auditApi.list({ ...q(), page: view.page, pageSize: 30 }), auditApi.facets()]);
    const opt = (list, cur) => list.map((v) => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
    return `<div class="toolbar panel"><div class="search-field">${icon('search')}<input data-on-input="audit:search" placeholder="Search action, reason, person…" aria-label="Search audit" value="${esc(view.search)}"></div>
      <select data-on-change="audit:filter" data-key="entity" aria-label="Entity"><option value="">All records</option>${opt(facets.entities, view.entity)}</select>
      <select data-on-change="audit:filter" data-key="action" aria-label="Action"><option value="">All actions</option>${opt(facets.actions, view.action)}</select>
      <input type="date" data-on-change="audit:filter" data-key="from" value="${esc(view.from)}" aria-label="From date"><input type="date" data-on-change="audit:filter" data-key="to" value="${esc(view.to)}" aria-label="To date"></div><div id="audit-body">${listHtml(data)}</div>`;
  },
});
onInput('audit:search', (el) => { view.search = el.value.trim(); view.page = 1; reload(); });
onChange('audit:filter', (el) => { view[el.dataset.key] = el.value; view.page = 1; reload(); });
onClick('audit:page', (el) => { view.page = Number(el.dataset.page); reload(); });
onClick('audit:reload', reload);
onClick('audit:toggle', (el) => { const d = el.querySelector('[data-detail]'); if (d && d.textContent.trim()) d.hidden = !d.hidden; });
