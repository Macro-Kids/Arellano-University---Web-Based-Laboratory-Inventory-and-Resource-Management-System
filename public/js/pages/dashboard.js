// pages/dashboard.js — UC-015 role-based dashboard (FR-026). Data = /api/dashboard.
import { esc, fmtDate, fmtDateTime, relative, labShort, num } from '../core/format.js';
import { icon } from '../core/icons.js';
import { registerPage } from '../core/router.js';
import { dashboard as api } from '../services/index.js';
import { badge, emptyState } from '../core/ui.js';
import { state, can, wsParams } from '../core/state.js';
import { P } from '../core/permissions.js';

const EYEBROW = { 'System Administrator': 'System administrator overview', 'Laboratory Coordinator': 'Coordinator command center', 'Laboratory Staff': 'Laboratory staff workspace', Teacher: 'Teacher workspace' };

function metricCards(d) {
  const m = d.metrics, labCount = d.readiness?.length ?? 0;
  const needs = m.lowStock + m.openMaintenance;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  return `<section class="metric-grid">
    <article class="metric-card metric-primary"><div class="metric-top"><span>Cataloged items</span><span class="metric-symbol">${icon('box')}</span></div><strong class="num">${num(m.totalItems)}</strong><small><span class="trend-up">${num(m.totalAssets)}</span> tracked units <span class="muted">· across ${labCount} lab${labCount === 1 ? '' : 's'}</span></small><div class="metric-rule"><i style="width:${Math.min(100, m.totalItems * 6)}%"></i></div></article>
    <article class="metric-card"><div class="metric-top"><span>Available assets</span><span class="metric-symbol mint">${icon('scan')}</span></div><strong class="num">${num(m.availableAssets)}<small class="metric-denom"> / ${num(m.totalAssets)}</small></strong><small><span class="trend-up">Ready now</span> for release</small><div class="metric-rule"><i style="width:${pct(m.availableAssets, m.totalAssets)}%;background:#2e9b83"></i></div></article>
    <article class="metric-card"><div class="metric-top"><span>Needs attention</span><span class="metric-symbol coral">${icon('wrench')}</span></div><strong class="num">${needs}</strong><small><span class="trend-down">${m.lowStock} low stock</span> <span class="muted">· ${m.openMaintenance} maintenance</span></small><div class="metric-rule"><i style="width:${Math.min(100, needs * 12)}%;background:#c84659"></i></div></article>
    <article class="metric-card"><div class="metric-top"><span>Open requests</span><span class="metric-symbol amber">${icon('clipboard')}</span></div><strong class="num">${m.openRequests}</strong><small><span class="trend-warn">${m.pendingRequests} pending review</span>${m.overdueReturns ? ` <span class="trend-down">· ${m.overdueReturns} overdue</span>` : ''}</small><div class="metric-rule"><i style="width:${Math.min(100, m.openRequests * 14)}%;background:#d08a31"></i></div></article></section>`;
}

function attentionRow(a) {
  if (a.type === 'low-stock') return `<div class="attention-row"><span class="attention-icon coral">${icon('box')}</span><div><strong>${esc(a.name)}</strong><p>${esc(a.laboratoryName)} · ${num(a.quantity)} ${esc(a.unit)} left (minimum ${num(a.minimum)})</p></div>${badge(a.quantity <= 0 ? 'Out of stock' : 'Low stock')}<a class="row-arrow" href="#/inventory?open=${a.id}" aria-label="Open ${esc(a.name)}">${icon('arrow')}</a></div>`;
  if (a.type === 'maintenance') return `<div class="attention-row"><span class="attention-icon amber">${icon('wrench')}</span><div><strong>${esc(a.name)} · ${esc(a.tag)}</strong><p>${esc(a.issue)}</p></div>${badge('Maintenance')}<a class="row-arrow" href="#/maintenance" aria-label="View maintenance">${icon('arrow')}</a></div>`;
  if (a.type === 'overdue') return `<div class="attention-row"><span class="attention-icon coral">${icon('clipboard')}</span><div><strong>${esc(a.code)} · ${esc(a.requester)}</strong><p>${esc(a.laboratoryName)} · was due ${fmtDate(a.due)}</p></div>${badge('Overdue')}<a class="row-arrow" href="#/requests?open=${a.id}" aria-label="Open request">${icon('arrow')}</a></div>`;
  return `<div class="attention-row"><span class="attention-icon blue">${icon('clipboard')}</span><div><strong>${esc(a.code)} · ${esc(a.requester)}</strong><p>${esc(a.purpose)}</p></div>${badge('Pending')}<a class="row-arrow" href="#/requests?open=${a.id}" aria-label="Review request">${icon('arrow')}</a></div>`;
}

function staffDashboard(d) {
  const activity = d.recentActivity ?? [];
  return `${metricCards(d)}
  <section class="dashboard-grid">
    <article class="panel attention-panel"><div class="panel-head"><div><p class="eyebrow">Today’s focus</p><h2>Keep the labs moving</h2></div><a href="#/inventory" class="text-link">View inventory ${icon('arrow')}</a></div>
      <div class="attention-list">${d.attention.length ? d.attention.map(attentionRow).join('') : `<div class="empty-inline"><span>${icon('shield')}</span><strong>All clear for today</strong><p>No stock, maintenance or return exceptions.</p></div>`}</div></article>
    <article class="panel activity-panel"><div class="panel-head"><div><p class="eyebrow">Traceable by default</p><h2>Recent activity</h2></div>${can(P.AUDIT_VIEW) ? `<a href="#/audit" class="text-link">Full audit trail ${icon('arrow')}</a>` : ''}</div>
      <div class="activity-list">${activity.length ? activity.map((a) => `<div class="activity-row"><span class="activity-line"></span><div><strong>${esc(a.action)}</strong><p>${esc(a.summary || a.reason || '')} · <b>${esc(a.recordCode)}</b></p><time title="${esc(fmtDateTime(a.timestamp))}">${esc(a.userName)} · ${esc(relative(a.timestamp))}</time></div></div>`).join('')
        : `<div class="empty-inline"><strong>No activity yet</strong><p>Changes you make will appear here.</p></div>`}</div></article>
  </section>
  <section class="panel quick-panel"><div class="panel-head"><div><p class="eyebrow">At a glance</p><h2>Laboratory readiness</h2></div><span class="panel-meta">Usable equipment ÷ owned equipment · updated just now</span></div>
    <div class="readiness">${d.readiness.map((l, i) => `<div class="readiness-lab"><div class="lab-avatar ${i % 2 ? 'red' : 'blue'}">${esc(labShort(l.type))}</div><div><strong>${esc(l.name)}</strong><small>${esc(l.location || '')}</small></div>
      <div class="readiness-bar"><i style="width:${l.percent}%;${l.state === 'Attention' ? 'background:#c84659' : l.state === 'Review' ? 'background:#d08a31' : ''}"></i></div><b>${l.percent}%</b><span class="readiness-state ${l.state === 'Ready' ? '' : 'warn'}">${l.state}</span></div>`).join('') || emptyState('building', 'No laboratories in scope')}</div></section>`;
}

function teacherDashboard(d) {
  const m = d.metrics;
  return `<section class="metric-grid">
    <article class="metric-card metric-primary"><div class="metric-top"><span>My open requests</span><span class="metric-symbol">${icon('clipboard')}</span></div><strong class="num">${m.myOpen}</strong><small>${m.myPending} waiting for approval</small></article>
    <article class="metric-card"><div class="metric-top"><span>Approved, ready to collect</span><span class="metric-symbol mint">${icon('check')}</span></div><strong class="num">${m.myApproved}</strong><small>Collect from the laboratory</small></article>
    <article class="metric-card"><div class="metric-top"><span>Currently borrowed</span><span class="metric-symbol amber">${icon('box')}</span></div><strong class="num">${m.myBorrowed}</strong><small>${m.myOverdue ? `<span class="trend-down">${m.myOverdue} overdue — please return</span>` : 'All on schedule'}</small></article>
    <article class="metric-card"><div class="metric-top"><span>Items you can borrow</span><span class="metric-symbol coral">${icon('scan')}</span></div><strong class="num">${m.availableItems}</strong><small>Currently available in your labs</small></article></section>
  <section class="panel"><div class="panel-head"><div><p class="eyebrow">Your borrowing</p><h2>Upcoming and active requests</h2></div><a href="#/requests" class="text-link">All my requests ${icon('arrow')}</a></div>
    <div class="request-list">${d.upcoming.length ? d.upcoming.map((r) => `<div class="request-row"><div class="request-id"><code>${esc(r.code)}</code><span>${fmtDate(r.requestDate.slice(0, 10))}</span></div><div class="request-main"><strong>${esc(r.purpose)}</strong><small>${esc(r.laboratoryName)}</small></div><div class="request-return"><span>Expected return</span><strong>${fmtDate(r.expectedReturnDate)}</strong></div><div>${badge(r.status)}</div><div class="request-actions"><a class="btn btn-small btn-quiet" href="#/requests?open=${r.id}">Details</a></div></div>`).join('')
      : emptyState('clipboard', 'No open requests', 'Need equipment or supplies for a class? Start a request.', `<button class="btn btn-primary" data-action="requests:new">${icon('plus')}New request</button>`)}</div></section>`;
}

registerPage({
  id: 'dashboard',
  title: () => (can(P.BORROW_VIEW_ALL) ? 'Laboratory overview' : 'My overview'),
  eyebrow: () => EYEBROW[state.me.roleName] || 'Overview',
  subtitle: () => 'A clear read on what is available, moving, and due for attention.',
  actions: () => (can(P.BORROW_CREATE) ? `<button class="btn btn-primary" data-action="requests:new">${icon('plus')}New request</button>` : ''),
  async render() {
    const d = await api.get(wsParams());
    return d.kind === 'personal' ? teacherDashboard(d) : staffDashboard(d);
  },
});
