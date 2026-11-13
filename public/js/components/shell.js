// -----------------------------------------------------------------------------
// components/shell.js — sidebar, top bar, notifications drawer, profile menu.
// The shell is rendered ONCE after sign-in; navigation only swaps #page-body.
// -----------------------------------------------------------------------------
import { esc, initials, labShort } from '../core/format.js';
import { icon } from '../core/icons.js';
import { state, can, canAny, labs, setWorkspaceLab } from '../core/state.js';
import { onClick } from '../core/events.js';
import { openLayer, closeLayer, closeAllLayers, drawerHtml, toastError } from '../core/ui.js';
import { renderRoute, current, allPages } from '../core/router.js';
import { dashboard as dashApi } from '../services/index.js';
import { P } from '../core/permissions.js';

const NAV = [
  { id: 'dashboard', label: 'Overview', icon: 'grid', group: 'Workspace' },
  { id: 'inventory', label: 'Inventory', icon: 'box', perm: P.INVENTORY_VIEW },
  { id: 'requests', label: 'Borrowing requests', mine: 'My requests', icon: 'clipboard', perm: [P.BORROW_CREATE, P.BORROW_VIEW_ALL], badge: 'pending' },
  { id: 'assets', label: 'Tracked assets', icon: 'scan', perm: P.ASSETS_VIEW },
  { id: 'maintenance', label: 'Maintenance', icon: 'wrench', perm: P.MAINTENANCE_VIEW },
  { id: 'reports', label: 'Reports', icon: 'chart', perm: P.REPORTS_VIEW, group: 'Insights' },
  { id: 'audit', label: 'Audit trail', icon: 'shield', perm: P.AUDIT_VIEW },
  { id: 'users', label: 'Users & access', icon: 'users', perm: P.USERS_MANAGE },
];
const visible = (n) => !n.perm || canAny(n.perm);

function navHtml(activeId) {
  const items = NAV.filter(visible);
  let html = '', lastGroup = '';
  items.forEach((n, i) => {
    const group = n.group || (i === 0 ? 'Workspace' : '');
    if (group && group !== lastGroup) { html += `<div class="nav-label ${lastGroup ? 'nav-label-spaced' : ''}">${group}</div>`; lastGroup = group; }
    const count = n.badge === 'pending' && state.badges.pending ? `<b class="nav-count">${state.badges.pending}</b>` : '';
    const label = n.mine && !can(P.BORROW_VIEW_ALL) ? n.mine : n.label;
    html += `<a class="nav-item ${activeId === n.id ? 'active' : ''}" href="#/${n.id}" data-nav="${n.id}">${icon(n.icon)}<span>${label}</span>${count}</a>`;
  });
  return html;
}

function labSwitcher() {
  const l = labs();
  const sel = l.find((x) => String(x.id) === state.workspaceLab);
  const title = sel ? sel.name : (l.length > 1 || state.me.isGlobal ? 'All laboratories' : l[0]?.name || 'No laboratory');
  const multi = l.length > 1;
  return `<button class="lab-switcher" data-action="shell:lab-menu" ${multi ? '' : 'disabled style="cursor:default"'} aria-haspopup="listbox"><span class="status-dot"></span>
    <div><small>Active workspace</small><strong>${esc(title)}</strong></div>${multi ? icon('chevron') : ''}</button>`;
}

export function renderShell() {
  const me = state.me;
  document.getElementById('app').innerHTML = `<div class="app-shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="brand-mark"><img src="assets/arellano-logo.png" alt="Arellano University"/></div><div><strong>AU<span>·</span>LAB</strong><small>Inventory command center</small></div></div>
      <div id="lab-switcher-slot" style="position:relative">${labSwitcher()}</div>
      <nav class="primary-nav" id="primary-nav"></nav>
      <div class="sidebar-foot"><a class="nav-item" href="#/settings" data-nav="settings">${icon('settings')}<span>Settings</span></a>
        <div class="side-note"><span class="pulse"></span><div><strong>System ready</strong><small>Connected · data saved on server</small></div></div></div>
    </aside>
    <main class="main">
      <header class="topbar"><button class="icon-btn mobile-menu" data-action="shell:toggle-sidebar" aria-label="Open navigation">${icon('menu')}</button>
        <div class="breadcrumbs"><span>AU Lab</span><i>/</i><strong id="crumb"></strong></div>
        <div class="top-actions"><button class="icon-btn notification-btn" data-action="shell:notifications" aria-label="Open notifications">${icon('bell')}<em id="bell-count" hidden></em></button>
          <button class="profile-chip" data-action="shell:profile-menu"><span class="avatar">${esc(initials(me.name))}</span><span class="profile-copy"><strong>${esc(me.name)}</strong><small>${esc(me.roleName)}</small></span>${icon('chevron')}</button></div></header>
      <div class="page-content"><div class="page-heading" id="page-head"></div><div id="page-body"></div></div>
    </main>
    <div class="mobile-nav" id="mobile-nav"></div></div>`;
  paintNav(current().id);
  refreshBadges();
}

function paintNav(activeId) {
  const nav = document.getElementById('primary-nav'); if (nav) nav.innerHTML = navHtml(activeId);
  const foot = document.querySelector('.sidebar-foot > a.nav-item'); foot?.classList.toggle('active', activeId === 'settings');
  const m = document.getElementById('mobile-nav');
  if (m) m.innerHTML = ['dashboard', 'inventory', 'requests', 'assets'].map((id) => NAV.find((n) => n.id === id)).filter((n) => n && visible(n))
    .map((n) => `<a class="nav-item ${activeId === n.id ? 'active' : ''}" href="#/${n.id}">${icon(n.icon)}<span>${n.mine && !can(P.BORROW_VIEW_ALL) ? 'Requests' : n.label.split(' ')[0]}</span></a>`).join('')
    + `<a class="nav-item ${activeId === 'settings' ? 'active' : ''}" href="#/settings">${icon('settings')}<span>More</span></a>`;
}

/** Router hook: update breadcrumb, heading and highlighted nav item for the new page. */
export const chrome = {
  body: () => document.getElementById('page-body'),
  update(page, query) {
    document.getElementById('sidebar')?.classList.remove('open');
    paintNav(page.id);
    const title = typeof page.title === 'function' ? page.title() : page.title;
    document.getElementById('crumb').textContent = title;
    document.title = `${title} · AU·LAB`;
    const sub = typeof page.subtitle === 'function' ? page.subtitle() : page.subtitle || `Keep ${title.toLowerCase()} accurate, traceable, and ready for the next practical.`;
    document.getElementById('page-head').innerHTML = `<div><p class="eyebrow">${esc(typeof page.eyebrow === 'function' ? page.eyebrow() : page.eyebrow || '')}</p><h1>${esc(title)}</h1><p class="heading-sub">${esc(sub)}</p></div>
      <div class="heading-actions">${page.actions ? page.actions(query) : ''}</div>`;
  },
};

export async function refreshBadges() {
  try {
    const list = await dashApi.notifications();
    state.badges.notifications = list.length;
    state.badges.pending = Number((list.find((n) => n.id === 'pending')?.title.match(/^\d+/) || [0])[0]);
    const bell = document.getElementById('bell-count');
    if (bell) { bell.textContent = list.length; bell.hidden = list.length === 0; }
    paintNav(current().id);
  } catch { /* badges are non-critical; the 401 case is handled globally */ }
}
export function refreshLabSwitcher() { const slot = document.getElementById('lab-switcher-slot'); if (slot) slot.innerHTML = labSwitcher(); }

// ---- shell actions -----------------------------------------------------------------------------
onClick('shell:toggle-sidebar', () => document.getElementById('sidebar').classList.toggle('open'));

onClick('shell:lab-menu', () => {
  const slot = document.getElementById('lab-switcher-slot');
  const existing = slot.querySelector('.lab-menu');
  if (existing) { existing.remove(); return; }
  const menu = document.createElement('div');
  menu.className = 'lab-menu';
  menu.innerHTML = `<button data-action="shell:set-lab" data-id="" class="${state.workspaceLab === '' ? 'on' : ''}">All my laboratories<small>Combined view</small></button>` +
    labs().map((l) => `<button data-action="shell:set-lab" data-id="${l.id}" class="${String(l.id) === state.workspaceLab ? 'on' : ''}">${esc(l.name)}<small>${esc(l.location || l.type || '')}</small></button>`).join('');
  slot.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
});
onClick('shell:set-lab', (el) => { setWorkspaceLab(el.dataset.id); refreshLabSwitcher(); renderRoute(); });

onClick('shell:notifications', async () => {
  const el = openLayer(drawerHtml({ eyebrow: 'Attention center', title: 'Notifications', body: '<div class="loading-block"><span class="spinner"></span>Loading…</div>' }));
  try {
    const list = await dashApi.notifications();
    el.querySelector('.drawer-body').innerHTML = `<div class="drawer-note">Live from the server — these reflect the current state of your laboratories.</div>
      <div class="notification-list">${list.length ? list.map((n) => `<div class="notification-item ${n.severity === 'urgent' ? 'urgent' : ''}"><span>${icon(n.icon)}</span><div><strong>${esc(n.title)}</strong><p>${esc(n.text)}</p><a href="${n.link}" data-action="ui:close">Open ${icon('arrow')}</a></div></div>`).join('')
        : `<div class="empty-inline"><span>${icon('shield')}</span><strong>You're all caught up</strong><p>Nothing needs attention right now.</p></div>`}</div>`;
  } catch (err) { closeLayer(el); toastError(err); }
});

onClick('shell:profile-menu', () => {
  const me = state.me;
  openLayer(`<div class="modal-backdrop" data-layer><div class="modal profile-menu"><div class="profile-banner"><span class="avatar large">${esc(initials(me.name))}</span><div><strong>${esc(me.name)}</strong><p>${esc(me.roleName)}</p></div></div>
    <a href="#/settings" class="menu-link" data-action="ui:close">${icon('settings')}Profile & settings</a>
    <button class="menu-link" data-action="settings:change-password">${icon('key')}Change password</button>
    <button class="menu-link" data-action="auth:sign-out">${icon('logout')}Sign out</button>
    <div class="menu-foot">Signed in as ${esc(me.username)}</div></div></div>`);
});
export { closeAllLayers, allPages };
