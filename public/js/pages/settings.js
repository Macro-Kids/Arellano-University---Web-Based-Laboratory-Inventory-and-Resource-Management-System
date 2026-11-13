// -----------------------------------------------------------------------------
// pages/settings.js — profile & password, display preferences (UI-only),
// laboratories & categories (reference data), and — for administrators — the
// system panel: backups (BRR-001), integrity check, diagnostics, recent errors.
// -----------------------------------------------------------------------------
import { esc, fmtDateTime, initials, num } from '../core/format.js';
import { icon } from '../core/icons.js';
import { registerPage, renderRoute } from '../core/router.js';
import { onClick, onSubmit } from '../core/events.js';
import { auth, labsApi, categoriesApi, system } from '../services/index.js';
import { badge, field, formShell, modalHtml, openLayer, closeLayer, submitForm, toast, loading, errorBanner } from '../core/ui.js';
import { state, can, setPref, setSession } from '../core/state.js';
import { P } from '../core/permissions.js';
import { invalidateCategories } from '../core/lookups.js';
import { debugOn } from '../core/debug.js';
import { labShort } from '../core/format.js';

const toggle = (key, label, text) => `<div class="setting-row"><div><strong>${label}</strong><p>${text}</p></div><button class="toggle ${state.prefs[key] ? 'on' : ''}" data-action="settings:toggle" data-key="${key}" role="switch" aria-checked="${!!state.prefs[key]}" aria-label="${label}"><i></i></button></div>`;

registerPage({
  id: 'settings', title: 'Settings', eyebrow: 'Workspace controls', subtitle: 'Your profile, display preferences and reference data.',
  async render() {
    const [labs, cats] = await Promise.all([labsApi.list(), categoriesApi.list({ includeInactive: can(P.CATEGORIES_MANAGE) ? 1 : '' })]);
    const me = state.me;
    return `<div class="settings-grid">
    <section class="panel settings-card profile-settings"><div class="panel-head"><div><p class="eyebrow">Your workspace</p><h2>Profile</h2></div><button class="btn btn-quiet" data-action="settings:change-password">${icon('key')}Change password</button></div>
      <div class="profile-banner"><span class="avatar large">${esc(initials(me.name))}</span><div><strong>${esc(me.name)}</strong><p>${esc(me.roleName)}</p><small>@${esc(me.username)}</small></div></div>
      ${formShell('settings:profile', `<div class="form-grid">${field({ name: 'firstName', label: 'First name', value: me.firstName, required: true })}${field({ name: 'lastName', label: 'Last name', value: me.lastName, required: true })}${field({ name: 'email', label: 'Email address', type: 'email', value: me.email ?? '', span2: true })}</div>`, { submit: 'Save profile', cancel: false, cls: '' })}</section>
    <section class="panel settings-card"><div class="panel-head"><div><p class="eyebrow">Display</p><h2>Preferences</h2></div></div>
      ${toggle('dense', 'Dense information mode', 'Keep more records visible in tables and queues.')}${toggle('dark', 'Night desk', 'Use a lower-light palette for evening inventory checks.')}
      <div class="setting-row"><div><strong>Debug logging</strong><p>Verbose browser console output for troubleshooting.</p></div><button class="toggle ${debugOn() ? 'on' : ''}" data-action="settings:debug" role="switch" aria-label="Debug logging"><i></i></button></div></section>
    <section class="panel settings-card"><div class="panel-head"><div><p class="eyebrow">Reference data</p><h2>Laboratories</h2></div>${can(P.LABS_MANAGE) ? `<button class="btn btn-small btn-quiet" data-action="settings:lab" data-id="">${icon('plus')}Add</button>` : ''}</div>
      ${labs.map((l, i) => `<div class="reference-row"><span class="lab-avatar ${i % 2 ? 'red' : 'blue'}">${esc(labShort(l.type))}</span><div><strong>${esc(l.name)}</strong><small>${esc(l.location || '')} · ${l.itemCount} items · ${l.assetCount} assets</small></div>${badge(l.status)}${can(P.LABS_MANAGE) ? `<button class="btn btn-small btn-quiet" data-action="settings:lab" data-id="${l.id}">Edit</button>` : ''}</div>`).join('') || '<div class="empty-inline"><strong>No laboratories assigned</strong></div>'}</section>
    <section class="panel settings-card"><div class="panel-head"><div><p class="eyebrow">Reference data</p><h2>Categories</h2></div>${can(P.CATEGORIES_MANAGE) ? `<button class="btn btn-small btn-quiet" data-action="settings:cat" data-id="">${icon('plus')}Add</button>` : ''}</div>
      ${cats.map((c) => `<div class="reference-row"><span class="lab-avatar blue">${esc(c.name.slice(0, 2).toUpperCase())}</span><div><strong>${esc(c.name)}</strong><small>${esc(c.description || '')} · ${c.itemCount} items</small></div>${badge(c.status)}${can(P.CATEGORIES_MANAGE) ? `<button class="btn btn-small btn-quiet" data-action="settings:cat" data-id="${c.id}">Edit</button>` : ''}</div>`).join('')}</section>
    ${can(P.SYSTEM_MANAGE) ? `<section class="panel settings-card" style="grid-column:1/-1"><div class="panel-head"><div><p class="eyebrow">Administration</p><h2>System, backups & data health</h2></div>
      <div class="heading-actions"><button class="btn btn-small btn-quiet" data-action="settings:integrity">${icon('shield')}Run integrity check</button><button class="btn btn-small btn-primary" data-action="settings:backup">${icon('db')}Back up now</button></div></div><div class="setting-block" id="system-panel">${loading()}</div></section>` : ''}</div>`;
  },
  mount() { if (can(P.SYSTEM_MANAGE)) loadSystem(); },
});

onClick('settings:toggle', (el) => { setPref(el.dataset.key, !state.prefs[el.dataset.key]); el.classList.toggle('on', state.prefs[el.dataset.key]); el.setAttribute('aria-checked', String(state.prefs[el.dataset.key])); });
onClick('settings:debug', (el) => { const on = !debugOn(); try { localStorage.setItem('aulab:debug', on ? '1' : '0'); } catch { /* ignore */ } el.classList.toggle('on', on); toast(on ? 'Debug logging on — open the browser console.' : 'Debug logging off.'); });
onSubmit('settings:profile', (form) => submitForm(form, async (v) => { setSession(await auth.updateProfile(v)); toast('Profile saved.'); await renderRoute(); document.querySelector('.profile-copy strong').textContent = state.me.name; }));

// ---- change password ------------------------------------------------------------------------------------------------
onClick('settings:change-password', () => {
  document.querySelectorAll('#overlay [data-layer]').forEach((l) => l.remove());
  openLayer(modalHtml({ eyebrow: 'Security', title: 'Change password', subtitle: 'You stay signed in here; other devices are signed out.', body: formShell('settings:password', `
    ${field({ name: 'currentPassword', label: 'Current password', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
    ${field({ name: 'newPassword', label: 'New password', type: 'password', required: true, hint: 'At least 8 characters with a letter and a number.', attrs: 'autocomplete="new-password"' })}
    ${field({ name: 'confirm', label: 'Confirm new password', type: 'password', required: true, attrs: 'autocomplete="new-password"' })}`, { submit: 'Update password' }) }));
});
onSubmit('settings:password', (form) => submitForm(form, async (v) => {
  if (v.newPassword !== v.confirm) { const e = new (await import('../core/api.js')).ApiError(400, { error: { message: 'Passwords do not match.', fields: { confirm: 'Passwords do not match.' } } }); throw e; }
  await auth.changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword }); closeLayer(form.closest('[data-layer]')); toast('Password updated.');
}));

// ---- laboratories & categories ---------------------------------------------------------------------------------------------
onClick('settings:lab', async (el) => {
  const l = el.dataset.id ? (await labsApi.list()).find((x) => x.id === Number(el.dataset.id)) : null;
  openLayer(modalHtml({ eyebrow: 'Reference data', title: l ? `Edit ${l.name}` : 'Add laboratory', body: formShell('settings:lab-save', `<div class="form-grid">${field({ name: 'name', label: 'Name', value: l?.name, required: true, span2: true })}${field({ name: 'type', label: 'Type', value: l?.type, required: true, placeholder: 'e.g. Science' })}${field({ name: 'status', label: 'Status', type: 'select', options: ['Operational', 'Inactive'], value: l?.status ?? 'Operational' })}${field({ name: 'location', label: 'Location', value: l?.location ?? '', span2: true })}${field({ name: 'description', label: 'Description', type: 'textarea', rows: 2, value: l?.description ?? '', span2: true })}</div>`, { data: `data-id="${l?.id ?? ''}"`, cls: '' }) }));
});
onSubmit('settings:lab-save', (form) => submitForm(form, async (v) => {
  const id = form.dataset.id; id ? await labsApi.update(Number(id), v) : await labsApi.create(v);
  closeLayer(form.closest('[data-layer]')); toast('Laboratory saved.'); await renderRoute();
}));
onClick('settings:cat', async (el) => {
  const c = el.dataset.id ? (await categoriesApi.list({ includeInactive: 1 })).find((x) => x.id === Number(el.dataset.id)) : null;
  openLayer(modalHtml({ eyebrow: 'Reference data', title: c ? `Edit ${c.name}` : 'Add category', body: formShell('settings:cat-save', `${field({ name: 'name', label: 'Name', value: c?.name, required: true })}${field({ name: 'description', label: 'Description', value: c?.description ?? '' })}${field({ name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], value: c?.status ?? 'Active' })}`, { data: `data-id="${c?.id ?? ''}"` }) }));
});
onSubmit('settings:cat-save', (form) => submitForm(form, async (v) => {
  const id = form.dataset.id; id ? await categoriesApi.update(Number(id), v) : await categoriesApi.create(v);
  invalidateCategories(); closeLayer(form.closest('[data-layer]')); toast('Category saved.'); await renderRoute();
}));

// ---- system panel (administrators) -------------------------------------------------------------------------------------------------
const bytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
async function loadSystem() {
  const host = document.getElementById('system-panel'); if (!host) return;
  try {
    const [d, backups] = await Promise.all([system.diagnostics(), system.backups()]);
    host.innerHTML = `<div class="stat-row" style="grid-template-columns:repeat(4,1fr)"><div class="stat-box"><strong>${esc(d.app.version)}</strong><small>Version · Node ${esc(d.app.node)}</small></div><div class="stat-box"><strong>${bytes(d.database.sizeBytes)}</strong><small>SQLite ${esc(d.database.sqlite)} · schema v${d.database.migrations.applied.length}</small></div>
      <div class="stat-box"><strong>${d.sessions}</strong><small>Active sessions</small></div><div class="stat-box"><strong>${d.memoryMb} MB</strong><small>Memory · up ${Math.round(d.app.uptimeSeconds / 60)} min</small></div></div>
      <div id="integrity-result"></div>
      <h3>Backups ${d.backups.enabled ? `<span class="muted-small">· automatic every ${d.backups.enabled ? '24' : '—'} h, keeping ${d.backups.retention}</span>` : '<span class="muted-small">· automatic backups are off</span>'}</h3>
      ${backups.length ? `<table class="mini-table"><thead><tr><th>File</th><th>Created</th><th>Size</th><th></th></tr></thead><tbody>${backups.slice(0, 8).map((b) => `<tr><td><code>${esc(b.name)}</code></td><td>${esc(fmtDateTime(b.createdAt))}</td><td>${bytes(b.size)}</td><td><a class="btn btn-small btn-quiet" href="${system.backupUrl(b.name)}">${icon('download')}Download</a></td></tr>`).join('')}</tbody></table>` : '<p class="muted-small">No backups yet — click “Back up now”.</p>'}
      <p class="muted-small">Restoring is done with the server stopped: <code>npm run db:restore -- &lt;file&gt;</code> (see docs/OPERATIONS.md).</p>
      <h3>Recent warnings & errors</h3>${d.recentProblems.length ? `<div class="log-list">${d.recentProblems.slice(0, 8).map((p) => `<div><b>${esc(p.level.toUpperCase())}</b> [${esc(p.scope)}] ${esc(p.message)} <span class="muted-small">· ${esc(fmtDateTime(p.time))}</span></div>`).join('')}</div>` : '<p class="muted-small">Nothing logged since the server started.</p>'}
      <h3>Table sizes</h3><div class="chips">${d.database.tables.map((t) => `<span class="badge">${esc(t.table)} · ${num(t.rows)}</span>`).join('')}</div>`;
  } catch (e) { host.innerHTML = errorBanner(e, 'settings:reload-system'); }
}
onClick('settings:reload-system', loadSystem);
onClick('settings:backup', async (el) => { el.disabled = true; try { const b = await system.createBackup(); toast(b.verified ? `Backup ${b.name} created and verified.` : 'Backup created but FAILED verification — check the server log.', b.verified ? 'success' : 'info'); await loadSystem(); } finally { el.disabled = false; } });
onClick('settings:integrity', async () => {
  const r = await system.integrity(); const host = document.getElementById('integrity-result');
  host.innerHTML = r.ok ? `<p class="form-note"><span class="integrity-ok">✓ Data is consistent</span> — ${r.checks} checks passed (stock ledger, asset register, requests, maintenance, audit protection).</p>`
    : `<p class="form-note warn"><span class="integrity-bad">✗ ${r.issues.length} problem(s) found</span></p><div class="log-list">${r.issues.map((i) => `<div>${esc(i.message)} <span class="muted-small">[${esc(i.check)}]</span></div>`).join('')}</div>`;
});
