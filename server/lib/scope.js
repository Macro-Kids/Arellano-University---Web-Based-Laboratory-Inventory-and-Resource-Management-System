// -----------------------------------------------------------------------------
// scope.js — laboratory-level authorisation helpers (BR-011, UC-015).
// `ctx.user` is built by middleware/auth.js:
//   { id, username, name, roleName, permissions:Set, labIds:number[], isGlobal }
// -----------------------------------------------------------------------------
import { forbidden } from './errors.js';

export const can = (ctx, permission) => ctx.user.permissions.has(permission);
export function require(ctx, permission) {
  if (!can(ctx, permission)) throw forbidden();
}
export const canAccessLab = (ctx, labId) => ctx.user.isGlobal || ctx.user.labIds.includes(Number(labId));
export function assertLab(ctx, labId) {
  if (!canAccessLab(ctx, labId)) throw forbidden('You are not assigned to that laboratory.');
}
/**
 * SQL fragment limiting `column` to labs the user may see, optionally narrowed to one lab.
 *   const s = labFilter(ctx, 'i.laboratory_id', query.laboratoryId);  ->  { sql, params }
 */
export function labFilter(ctx, column, requestedLabId) {
  if (requestedLabId) {
    assertLab(ctx, requestedLabId);
    return { sql: `${column} = ?`, params: [Number(requestedLabId)] };
  }
  if (ctx.user.isGlobal) return { sql: '1 = 1', params: [] };
  if (!ctx.user.labIds.length) return { sql: '0 = 1', params: [] };
  return { sql: `${column} IN (${ctx.user.labIds.map(() => '?').join(',')})`, params: [...ctx.user.labIds] };
}
