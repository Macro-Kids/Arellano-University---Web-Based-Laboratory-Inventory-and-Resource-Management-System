// categories/service.js — FR-007 Manage Inventory Categories (configurable, not hard-coded).
import { inTransaction } from '../../db/connection.js';
import { codes } from '../../lib/codes.js';
import { notFound, validationError } from '../../lib/errors.js';
import { diffFields } from '../../lib/diff.js';
import { recordAudit } from '../audit/record.js';
import * as repo from './repo.js';

const dto = (c) => (c ? { ...c, code: codes.category(c.id) } : c);
export const list = ({ includeInactive } = {}) => repo.list(!includeInactive).map(dto);
export function get(id) { const c = repo.getById(id); if (!c) throw notFound('Category'); return dto(c); }

export function create(ctx, input) {
  if (repo.nameTaken(input.name)) throw validationError({ name: 'A category with this name already exists.' });
  const id = inTransaction(() => {
    const newId = Number(repo.insert(input));
    recordAudit(ctx, { action: 'Category created', entity: 'Category', recordId: newId, next: input });
    return newId;
  });
  return get(id);
}
export function update(ctx, id, input) {
  const before = get(id);
  if (repo.nameTaken(input.name, id)) throw validationError({ name: 'A category with this name already exists.' });
  inTransaction(() => {
    repo.update(id, input);
    const d = diffFields(before, input, ['name', 'description', 'status']);
    if (d.changed) recordAudit(ctx, { action: 'Category updated', entity: 'Category', recordId: id, previous: d.previous, next: d.next });
  });
  return get(id);
}
