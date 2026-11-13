// -----------------------------------------------------------------------------
// users/service.js — UC-002 Manage User Account (FR-002, RA-011).
// Business rules enforced here (not just in the UI):
//   * non-admin roles must be assigned at least one laboratory
//   * the last active System Administrator can never be demoted/deactivated
//   * you cannot deactivate yourself
//   * deactivating a user ends all of their sessions immediately
// -----------------------------------------------------------------------------
import { inTransaction } from '../../db/connection.js';
import { codes } from '../../lib/codes.js';
import { notFound, ruleViolation, validationError } from '../../lib/errors.js';
import { diffFields } from '../../lib/diff.js';
import { generatePassword, hashPassword, passwordProblem } from '../../lib/password.js';
import { likeTerm, pageMeta } from '../../lib/http.js';
import { nowIso } from '../../lib/time.js';
import { recordAudit } from '../audit/record.js';
import { deleteUserSessions, setPasswordHash } from '../auth/repo.js';
import { assertLab } from '../../lib/scope.js';
import * as repo from './repo.js';

const dto = (u) => (u ? { ...u, code: codes.user(u.id) } : u);

export const listRoles = () => repo.roles();
export function list(query, page) {
  const { total, rows } = repo.list({
    search: query.search ? likeTerm(query.search) : null,
    roleId: Number(query.roleId) || null, status: ['Active', 'Inactive'].includes(query.status) ? query.status : null,
    limit: page.pageSize, offset: page.offset,
  });
  return { rows: rows.map(dto), meta: pageMeta(total, page) };
}
export function get(id) {
  const u = repo.getById(id);
  if (!u) throw notFound('User');
  return dto(u);
}
export function requesters(ctx, labId) {
  assertLab(ctx, labId);
  return repo.requesters(labId);
}

function validateRoleAndLabs(roleId, laboratoryIds) {
  const role = repo.roleById(roleId);
  if (!role || role.name === 'System') throw validationError({ roleId: 'Choose a valid role.' });
  const unique = [...new Set(laboratoryIds)];
  if (repo.existingLabIds(unique).length !== unique.length) throw validationError({ laboratoryIds: 'One or more selected laboratories do not exist.' });
  if (role.name !== 'System Administrator' && unique.length === 0) throw validationError({ laboratoryIds: 'Assign at least one laboratory to this role.' });
  return { role, labs: role.name === 'System Administrator' ? [] : unique }; // admins are system-wide; no assignments needed
}

export async function create(ctx, input) {
  if (repo.usernameTaken(input.username)) throw validationError({ username: 'That username is already taken.' });
  const { role, labs } = validateRoleAndLabs(input.roleId, input.laboratoryIds);
  const temporary = input.password ? null : generatePassword();
  const password = input.password || temporary;
  const problem = passwordProblem(password);
  if (problem) throw validationError({ password: problem });
  const passwordHash = await hashPassword(password);
  const now = nowIso();
  const id = inTransaction(() => {
    const newId = Number(repo.insert({ ...input, passwordHash, now }));
    repo.setLabs(newId, labs);
    recordAudit(ctx, { action: 'User created', entity: 'User', recordId: newId, next: { username: input.username, role: role.name, laboratoryIds: labs } });
    return newId;
  });
  return { user: get(id), temporaryPassword: temporary };
}

export function update(ctx, id, input) {
  const before = get(id);
  const { role, labs } = validateRoleAndLabs(input.roleId, input.laboratoryIds);
  if (before.roleName === 'System Administrator' && role.name !== 'System Administrator' && before.status === 'Active' && repo.activeAdminCount() <= 1) {
    throw ruleViolation('At least one active System Administrator must remain.');
  }
  inTransaction(() => {
    repo.update(id, { ...input, now: nowIso() });
    repo.setLabs(id, labs);
    const d = diffFields(
      { ...before, laboratoryIds: before.laboratories.map((l) => l.id).join(',') },
      { ...input, roleName: role.name, laboratoryIds: labs.join(',') },
      ['firstName', 'lastName', 'email', 'roleName', 'laboratoryIds'],
    );
    if (d.changed) recordAudit(ctx, { action: 'User updated', entity: 'User', recordId: id, previous: d.previous, next: d.next });
    if (before.roleId !== input.roleId) deleteUserSessions(id); // permissions changed → force fresh sign-in
  });
  return get(id);
}

export function setStatus(ctx, id, status) {
  const before = get(id);
  if (before.status === status) return before;
  if (status === 'Inactive') {
    if (id === ctx.user.id) throw ruleViolation('You cannot deactivate your own account.');
    if (before.roleName === 'System Administrator' && repo.activeAdminCount() <= 1) throw ruleViolation('At least one active System Administrator must remain.');
  }
  inTransaction(() => {
    repo.setStatus(id, status, nowIso());
    if (status === 'Inactive') deleteUserSessions(id);
    recordAudit(ctx, { action: status === 'Active' ? 'User activated' : 'User deactivated', entity: 'User', recordId: id, previous: { status: before.status }, next: { status } });
  });
  return get(id);
}

export async function resetPassword(ctx, id, supplied) {
  get(id); // 404 if missing
  const temporary = supplied ? null : generatePassword();
  const password = supplied || temporary;
  const problem = passwordProblem(password);
  if (problem) throw validationError({ password: problem });
  const hash = await hashPassword(password);
  inTransaction(() => {
    setPasswordHash(id, hash);
    deleteUserSessions(id); // old sessions end immediately
    recordAudit(ctx, { action: 'Password reset', entity: 'User', recordId: id, reason: 'Reset by administrator' });
  });
  return { temporaryPassword: temporary };
}
