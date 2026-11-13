// -----------------------------------------------------------------------------
// audit/service.js — UC-014 View Audit History (FR-032, SR-005).
// Read-only. Admins see everything; coordinators see their laboratories plus their
// own actions. There is deliberately NO write/update/delete API (and the DB forbids it).
// -----------------------------------------------------------------------------
import { entityCode } from '../../lib/codes.js';
import { likeTerm, pageMeta } from '../../lib/http.js';
import { labFilter } from '../../lib/scope.js';
import { dayBoundsUtc } from '../../lib/time.js';
import * as repo from './repo.js';

const parseJson = (v) => { if (v == null) return null; try { return JSON.parse(v); } catch { return v; } };

export function dto(a) {
  return { ...a, recordCode: entityCode(a.entity, a.recordId, a.requestDate), previous: parseJson(a.previous), next: parseJson(a.next) };
}
export const summarise = (a) => {
  const fmt = (v) => (v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join('; ') : x}`).join(', ') : v ?? '');
  if (a.previous && a.next && typeof a.previous === 'object') {
    const keys = Object.keys(a.next).filter((k) => k in a.previous);
    if (keys.length) return keys.map((k) => `${k} ${a.previous[k] ?? '—'} → ${a.next[k] ?? '—'}`).join(', ');
  }
  return fmt(a.next) || a.reason || '';
};

function build(ctx, query) {
  const where = [], params = [];
  if (ctx.user.isGlobal) { where.push('1 = 1'); }
  else {
    const s = labFilter(ctx, 'a.laboratory_id', null);
    where.push(`(${s.sql} OR a.user_id = ?)`); params.push(...s.params, ctx.user.id);
  }
  if (query.laboratoryId) { where.push('a.laboratory_id = ?'); params.push(Number(query.laboratoryId)); }
  if (query.entity) { where.push('a.affected_entity = ?'); params.push(query.entity); }
  if (query.action) { where.push('a.action = ?'); params.push(query.action); }
  if (query.userId) { where.push('a.user_id = ?'); params.push(Number(query.userId)); }
  if (query.from) { where.push('a."timestamp" >= ?'); params.push(dayBoundsUtc(query.from).from); }
  if (query.to) { where.push('a."timestamp" < ?'); params.push(dayBoundsUtc(query.to).to); }
  if (query.search) {
    const t = likeTerm(query.search);
    where.push(`(a.action LIKE ? ESCAPE '\\' OR a.affected_entity LIKE ? ESCAPE '\\' OR IFNULL(a.reason,'') LIKE ? ESCAPE '\\' OR IFNULL(a.new_value,'') LIKE ? ESCAPE '\\' OR u.first_name || ' ' || u.last_name LIKE ? ESCAPE '\\')`);
    params.push(t, t, t, t, t);
  }
  return { where: where.join(' AND '), params };
}
export function list(ctx, query, page) {
  const { where, params } = build(ctx, query);
  const { total, rows } = repo.queryAudit({ where, params, limit: page.pageSize, offset: page.offset });
  return { rows: rows.map((r) => { const d = dto(r); return { ...d, summary: summarise(d) }; }), meta: pageMeta(total, page) };
}
export function listAll(ctx, query) {
  const { where, params } = build(ctx, query);
  return repo.queryAudit({ where, params }).rows.map((r) => { const d = dto(r); return { ...d, summary: summarise(d) }; });
}
export const facets = () => repo.auditFacets();
