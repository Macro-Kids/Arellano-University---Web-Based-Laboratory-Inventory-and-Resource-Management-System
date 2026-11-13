// -----------------------------------------------------------------------------
// pages/users.js — UC-002 Manage User Account (administrators only).
// Temporary passwords are shown ONCE in a modal and never stored in the browser.
// -----------------------------------------------------------------------------
import { esc, initials } from '../core/format.js';
import { icon } from '../core/icons.js';
import { registerPage } from '../core/router.js';
import { onClick, onInput, onChange, onSubmit } from '../core/events.js';
import { usersApi, labsApi } from '../services/index.js';
import { badge, pager, emptyState, field, formShell, modalHtml, openLayer, closeLayer, submitForm, confirmDialog, toast, errorBanner } from '../core/ui.js';
import { state } from '../core/state.js';
import { P } from '../core/permissions.js';

const view = { search: '', roleId: '', status: '', page: 1 };
let roles = [];
const params = () => ({ search: view.search, roleId: view.roleId, status: view.status, page: view.page, pageSize: 20 });

function tableHtml({ rows, meta }) {
  return `<div class="panel-head"><div><p class="eyebrow">Access control</p><h2>Users & access</h2></div><span class="panel-meta">${meta.total} account${meta.total === 1 ? '' : 's'} · permissions are enforced by the server</span></div>
  <div class="table-wrap"><table><thead><tr><th>User</th><th>Username</th><th>Role</th><th>Laboratory access</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((u) => `<tr>
    <td><div class="item-cell"><span class="avatar small">${esc(initials(u.name))}</span><div><strong>${esc(u.name)}</strong><small>${esc(u.email || '')}</small></div></div></td><td><code>${esc(u.username)}</code></td><td>${badge(u.roleName)}</td>
    <td>${u.roleName === 'System Administrator' ? 'All laboratories' : esc(u.laboratories.map((l) => l.name).join(', ') || '—')}</td><td>${badge(u.status)}</td>
    <td><div class="table-actions"><button class="btn btn-small btn-quiet" data-action="users:edit" data-id="${u.id}">Edit</button><button class="btn btn-small btn-quiet" data-action="users:reset" data-id="${u.id}">Reset password</button>
    ${u.id !== state.me.id ? `<button class="btn btn-small ${u.status === 'Active' ? 'btn-danger-outline' : 'btn-quiet'}" data-action="users:toggle" data-id="${u.id}" data-status="${u.status}">${u.status === 'Active' ? 'Deactivate' : 'Activate'}</button>` : ''}</div></td></tr>`).join('')
    || `<tr><td colspan="6">${emptyState('users', 'No users match', 'Try a different name or role.')}</td></tr>`}</tbody></table></div>${pager(meta, 'users:page')}`;
}
async function reload() { const h = document.getElementById('user-results'); if (!h) return; try { h.innerHTML = tableHtml(await usersApi.list(params())); } catch (e) { h.innerHTML = errorBanner(e, 'users:reload'); } }
onClick('users:reload', reload);

registerPage({
  id: 'users', title: 'Users & access', eyebrow: 'Authorization', perm: P.USERS_MANAGE, subtitle: 'Create accounts, assign roles and laboratories, and deactivate leavers.',
  actions: () => `<button class="btn btn-primary" data-action="users:new">${icon('plus')}Add user</button>`,
  async render() {
    const [data, r] = await Promise.all([usersApi.list(params()), usersApi.roles()]);
    roles = r;
    return `<div class="toolbar panel"><div class="search-field">${icon('search')}<input data-on-input="users:search" placeholder="Search name, username or email…" aria-label="Search users" value="${esc(view.search)}"></div>
      <select data-on-change="users:filter" data-key="roleId" aria-label="Role"><option value="">All roles</option>${roles.map((x) => `<option value="${x.id}" ${String(x.id) === String(view.roleId) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <select data-on-change="users:filter" data-key="status" aria-label="Status"><option value="">Any status</option><option ${view.status === 'Active' ? 'selected' : ''}>Active</option><option ${view.status === 'Inactive' ? 'selected' : ''}>Inactive</option></select></div>
      <section class="panel table-panel" id="user-results">${tableHtml(data)}</section>`;
  },
});
onInput('users:search', (el) => { view.search = el.value.trim(); view.page = 1; reload(); });
onChange('users:filter', (el) => { view[el.dataset.key] = el.value; view.page = 1; reload(); });
onClick('users:page', (el) => { view.page = Number(el.dataset.page); reload(); });

async function userForm(u) {
  const [allLabs, rs] = await Promise.all([labsApi.list(), roles.length ? roles : usersApi.roles()]); roles = rs;
  const mine = new Set((u?.laboratories ?? []).map((l) => l.id));
  const adminId = roles.find((r) => r.name === 'System Administrator')?.id;
  const body = formShell('users:save', `<div class="form-grid">
    ${u ? `<div class="field"><span>Username</span><input value="${esc(u.username)}" disabled></div>` : field({ name: 'username', label: 'Username', required: true, hint: 'Letters, numbers, dots, dashes. Cannot be changed later.', attrs: 'autocomplete="off"' })}
    ${field({ name: 'roleId', label: 'Role', type: 'select', required: true, options: roles.map((r) => ({ value: r.id, label: r.name })), value: u?.roleId ?? roles.find((r) => r.name === 'Teacher')?.id, attrs: `data-on-change="users:role-change" data-admin="${adminId}"` })}
    ${field({ name: 'firstName', label: 'First name', required: true, value: u?.firstName })}${field({ name: 'lastName', label: 'Last name', required: true, value: u?.lastName })}
    ${field({ name: 'email', label: 'Email address', type: 'email', value: u?.email ?? '', span2: true })}
    <div class="field span-2" data-labs-box><span>Laboratory access *</span><div class="chips" style="gap:12px">${allLabs.map((l) => `<label class="check-row"><input type="checkbox" name="lab-${l.id}" data-lab="${l.id}" ${mine.has(l.id) ? 'checked' : ''}>${esc(l.name)}</label>`).join('')}</div><span class="field-error" data-error-for="laboratoryIds"></span><span class="field-hint">Administrators have access to every laboratory.</span></div>
    ${u ? '' : field({ name: 'password', label: 'Initial password (optional)', type: 'password', hint: 'Leave empty to generate a temporary password you can hand over.', span2: true, attrs: 'autocomplete="new-password"' })}</div>`,
    { submit: u ? 'Save changes' : 'Create user', data: `data-id="${u?.id ?? ''}"`, cls: '' });
  return modalHtml({ eyebrow: 'Access control', title: u ? `Edit ${u.name}` : 'Add user', body, size: 'wide' });
}
const syncRole = (form) => { const sel = form.querySelector('[name="roleId"]'); form.querySelector('[data-labs-box]').hidden = sel.value === sel.dataset.admin; };
onClick('users:new', async () => { const l = openLayer(await userForm(null)); syncRole(l.querySelector('form')); });
onClick('users:edit', async (el) => { const l = openLayer(await userForm(await usersApi.get(Number(el.dataset.id)))); syncRole(l.querySelector('form')); });
onChange('users:role-change', (el) => syncRole(el.closest('form')));
const reveal = (title, user, pw) => openLayer(modalHtml({ eyebrow: 'Temporary password', title, subtitle: `For <strong>${esc(user)}</strong>. Copy it now — it is shown only once and the user should change it after signing in.`, body: `<div class="pw-reveal">${esc(pw)}</div><div class="modal-actions"><button class="btn btn-quiet" data-action="users:copy" data-pw="${esc(pw)}">Copy</button><button class="btn btn-primary" data-action="ui:close">Done</button></div>` }));
onClick('users:copy', async (el) => { try { await navigator.clipboard.writeText(el.dataset.pw); toast('Copied to clipboard.'); } catch { toast('Select the password and copy it manually.', 'info'); } });
onSubmit('users:save', (form) => submitForm(form, async (v) => {
  const id = form.dataset.id;
  const admin = v.roleId === Number(form.querySelector('[name="roleId"]').dataset.admin);
  const body = { ...v, laboratoryIds: admin ? [] : [...form.querySelectorAll('[data-lab]:checked')].map((c) => Number(c.dataset.lab)) };
  Object.keys(body).filter((k) => k.startsWith('lab-')).forEach((k) => delete body[k]);
  if (id) { await usersApi.update(Number(id), body); closeLayer(form.closest('[data-layer]')); toast('User updated.'); await reload(); return; }
  const r = await usersApi.create(body); closeLayer(form.closest('[data-layer]')); await reload();
  if (r.temporaryPassword) reveal('Account created', r.user.username, r.temporaryPassword); else toast(`${r.user.name} created.`);
}));
onClick('users:toggle', async (el) => {
  const to = el.dataset.status === 'Active' ? 'Inactive' : 'Active';
  if (to === 'Inactive') { const ok = await confirmDialog({ title: 'Deactivate this account?', message: 'They are signed out immediately and cannot sign in or create requests. History is kept.', label: 'Deactivate' }); if (!ok) return; }
  await usersApi.setStatus(Number(el.dataset.id), to); toast(`Account ${to === 'Active' ? 'activated' : 'deactivated'}.`); await reload();
});
onClick('users:reset', async (el) => {
  const ok = await confirmDialog({ title: 'Reset this password?', message: 'A new temporary password is generated and the user is signed out everywhere.', label: 'Reset password', danger: false }); if (!ok) return;
  const u = await usersApi.get(Number(el.dataset.id)); const r = await usersApi.resetPassword(u.id); reveal('Password reset', u.username, r.temporaryPassword);
});
