// -----------------------------------------------------------------------------
// pages/reports.js — UC-013 Generate Reports (FR-027…FR-031).
// One generic table renderer driven by { columns, rows, summary } from the server,
// so on-screen, printed and CSV output are always identical.
// -----------------------------------------------------------------------------
import { esc, fmtDate, fmtDateTime } from '../core/format.js';
import { icon } from '../core/icons.js';
import { registerPage, navigate } from '../core/router.js';
import { onClick, onChange } from '../core/events.js';
import { reportsApi } from '../services/index.js';
import { badge, emptyState, errorBanner } from '../core/ui.js';
import { wsParams } from '../core/state.js';
import { P } from '../core/permissions.js';

const CARDS = [
  { type: 'inventory', name: 'Inventory register', hint: 'Current stock by laboratory' },
  { type: 'borrowing', name: 'Borrowing activity', hint: 'Requests, releases, returns' },
  { type: 'equipment', name: 'Equipment condition', hint: 'Condition and asset status' },
  { type: 'movements', name: 'Stock movement', hint: 'Stock-in, out and adjustments' },
  { type: 'audit', name: 'Audit extract', hint: 'Immutable activity record' },
];
const view = { type: 'inventory', from: '', to: '', includeArchived: false };
const BADGE_KEYS = new Set(['status', 'condition', 'type', 'stock', 'maintenance']);
const DATETIME_KEYS = new Set(['date', 'actualReturn', 'dateBorrowed']);
const DATE_KEYS = new Set(['expectedReturn']);
const q = () => ({ ...wsParams(), from: view.from, to: view.to, includeArchived: view.includeArchived ? '1' : '' });

function cell(key, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (BADGE_KEYS.has(key)) return badge(String(v));
  if (DATETIME_KEYS.has(key)) return esc(fmtDate(String(v).slice(0, 10)));
  if (DATE_KEYS.has(key)) return esc(fmtDate(v));
  return esc(v);
}
function reportHtml(r) {
  return `<div class="report-kpis">${r.summary.map((s) => `<div><small>${esc(s.label)}</small><strong>${esc(s.value)}</strong></div>`).join('')}</div>
  <div class="table-wrap"><table><thead><tr>${r.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
  <tbody>${r.rows.map((row) => `<tr>${r.columns.map((c) => `<td>${cell(c.key, row[c.key])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${r.columns.length}">${emptyState('chart', 'No records for these filters', 'Widen the date range or choose another laboratory.')}</td></tr>`}</tbody></table></div>`;
}
async function loadReport() {
  const host = document.getElementById('report-body'); if (!host) return;
  host.innerHTML = '<div class="loading-block"><span class="spinner"></span>Generating report…</div>';
  try {
    const r = await reportsApi.get(view.type, q());
    document.getElementById('report-title').textContent = r.title;
    document.getElementById('report-sub').textContent = `Arellano University · Laboratory Resource Management · generated ${fmtDateTime(r.generatedAt)}`;
    host.innerHTML = reportHtml(r);
  } catch (e) { host.innerHTML = errorBanner(e, 'reports:reload'); }
}

registerPage({
  id: 'reports', title: 'Reports', eyebrow: 'Operational intelligence', perm: P.REPORTS_VIEW,
  subtitle: 'Printable summaries drawn directly from live records.',
  async render({ query }) {
    if (CARDS.some((c) => c.type === query.type)) view.type = query.type;
    return `<div class="report-switcher">${CARDS.map((c, i) => `<button class="report-card ${view.type === c.type ? 'active' : ''}" data-action="reports:switch" data-type="${c.type}"><span class="report-number">0${i + 1}</span><strong>${c.name}</strong><small>${c.hint}</small>${icon('arrow')}</button>`).join('')}</div>
    <div class="toolbar panel"><label class="muted-small">From <input type="date" data-on-change="reports:filter" data-key="from" value="${esc(view.from)}"></label><label class="muted-small">To <input type="date" data-on-change="reports:filter" data-key="to" value="${esc(view.to)}"></label>
      <label class="check-row"><input type="checkbox" data-on-change="reports:filter" data-key="includeArchived" ${view.includeArchived ? 'checked' : ''}>Include archived items</label><span class="spacer"></span>
      <button class="btn btn-quiet" data-action="reports:csv">${icon('download')}Export CSV</button><button class="btn btn-primary" data-action="reports:print">${icon('printer')}Print report</button></div>
    <section class="panel report-preview"><div class="report-toolbar"><div><p class="eyebrow">Printable view</p><h2 id="report-title">Report</h2><p id="report-sub"></p></div></div><div id="report-body"></div></section>`;
  },
  mount() { loadReport(); },
});
onClick('reports:switch', (el) => {
  if (el.dataset.type === 'audit') { navigate('audit'); return; }
  view.type = el.dataset.type;
  document.querySelectorAll('.report-card').forEach((c) => c.classList.toggle('active', c.dataset.type === view.type));
  loadReport();
});
onChange('reports:filter', (el) => { view[el.dataset.key] = el.type === 'checkbox' ? el.checked : el.value; loadReport(); });
onClick('reports:reload', loadReport);
onClick('reports:print', () => window.print());
onClick('reports:csv', () => { window.location.href = reportsApi.csvUrl(view.type, q()); });
