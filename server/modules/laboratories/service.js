// -----------------------------------------------------------------------------
// laboratories/service.js — UC-003 Manage Laboratory (SRS 6.1, SC-001/002).
// Laboratories are DATA, not code: adding an Agriculture lab needs no code change.
// -----------------------------------------------------------------------------
import { inTransaction } from '../../db/connection.js';
import { codes } from '../../lib/codes.js';
import { notFound, validationError } from '../../lib/errors.js';
import { diffFields } from '../../lib/diff.js';
import { nowIso } from '../../lib/time.js';
import { recordAudit } from '../audit/record.js';
import * as repo from './repo.js';

const dto = (l) => (l ? { ...l, code: codes.lab(l.id) } : l);

/** Admins see every laboratory; everyone else only the ones they are assigned to (BR-011). */
export const list = (ctx) => repo.list(ctx.user.isGlobal ? null : ctx.user.labIds).map(dto);
export function get(id) { const l = repo.getById(id); if (!l) throw notFound('Laboratory'); return dto(l); }

export function create(ctx, input) {
  if (repo.nameTaken(input.name)) throw validationError({ name: 'A laboratory with this name already exists.' });
  const id = inTransaction(() => {
    const newId = Number(repo.insert({ ...input, now: nowIso() }));
    recordAudit(ctx, { action: 'Laboratory created', entity: 'Laboratory', recordId: newId, next: input, laboratoryId: newId });
    return newId;
  });
  return get(id);
}
export function update(ctx, id, input) {
  const before = get(id);
  if (repo.nameTaken(input.name, id)) throw validationError({ name: 'A laboratory with this name already exists.' });
  inTransaction(() => {
    repo.update(id, input);
    const d = diffFields(before, input, ['name', 'type', 'location', 'description', 'status']);
    if (d.changed) recordAudit(ctx, { action: 'Laboratory updated', entity: 'Laboratory', recordId: id, previous: d.previous, next: d.next, laboratoryId: id });
  });
  return get(id);
}
