// -----------------------------------------------------------------------------
// assets/service.js — UC-006 Manage Equipment and Asset (FR-011/012/013, BR-002/004/005).
// -----------------------------------------------------------------------------
import { inTransaction } from '../../db/connection.js';
import { notFound, ruleViolation, validationError } from '../../lib/errors.js';
import { likeTerm, pageMeta } from '../../lib/http.js';
import { assertLab, labFilter, require as requirePerm } from '../../lib/scope.js';
import { nowIso } from '../../lib/time.js';
import { codes } from '../../lib/codes.js';
import { recordAudit } from '../audit/record.js';
import { auditForRecord } from '../audit/repo.js';
import { P } from '../auth/permissions.js';
import { syncEquipmentQuantity } from '../inventory/ledger.js';
import * as itemRepo from '../inventory/repo.js';
import { applyAssetState } from './state.js';
import * as repo from './repo.js';

const dto = (a) => (a ? { ...a, itemCode: codes.item(a.itemId) } : a);

export function loadAsset(ctx, id) {
  const a = repo.getById(id);
  if (!a) throw notFound('Asset');
  assertLab(ctx, a.laboratoryId);
  return a;
}

export function list(ctx, query, page) {
  const scope = labFilter(ctx, 'a.laboratory_id', Number(query.laboratoryId) || null);
  const term = (query.search || '').trim();
  const { total, rows } = repo.search({
    scopeSql: scope.sql, scopeParams: scope.params, q: term ? likeTerm(term) : null,
    itemId: Number(query.itemId) || null, status: query.status || null, condition: query.condition || null,
    sort: query.sort, dir: query.dir, limit: page.pageSize, offset: page.offset,
  });
  const out = rows.map((a) => {
    const d = dto(a);
    if (a.status === 'Borrowed') d.heldBy = repo.heldBy(a.id) ?? null; // DS-001: "Who currently has it?"
    return d;
  });
  return { rows: out, meta: pageMeta(total, page) };
}

export function get(ctx, id) {
  const a = dto(loadAsset(ctx, id));
  a.heldBy = repo.heldBy(id) ?? null;
  a.openMaintenance = repo.openMaintenanceFor(id) ?? null;
  a.history = {
    maintenance: repo.maintenanceFor(id).map((m) => ({ ...m, code: codes.maintenance(m.id) })),
    damageLoss: repo.damageFor(id).map((d) => ({ ...d, code: codes.damageLoss(d.id) })),
    borrowing: repo.borrowingHistory(id).map((b) => ({ ...b, requestCode: codes.request(b.requestId, b.requestDate) })),
    audit: auditForRecord('Asset', id, 30),
  };
  return a;
}

/** Create `count` assets for an equipment item with auto-generated tags. Call inside a transaction. */
export function createAssets(ctx, item, count, { condition = 'Good', reason, remarks = null, tags = [], serialNumber = null }) {
  const prefix = item.assetPrefix || 'AST';
  let n = repo.nextTagNumber(prefix);
  const created = [];
  for (let k = 0; k < count; k++) {
    const tag = tags[k] || `${prefix}-${String(n++).padStart(3, '0')}`;
    if (repo.tagTaken(tag)) throw validationError({ assetTag: `Asset ID ${tag} already exists.` });   // BR-002
    const id = Number(repo.insert({ itemId: item.id, laboratoryId: item.laboratoryId, tag, serialNumber, status: 'Available', condition, remarks, now: nowIso() }));
    recordAudit(ctx, { action: 'Asset registered', entity: 'Asset', recordId: id, laboratoryId: item.laboratoryId, next: { tag, item: item.name, condition }, reason });
    created.push(id);
  }
  syncEquipmentQuantity(ctx, item.id, reason || 'Asset registration', remarks);
  return created;
}

export function register(ctx, input) {
  requirePerm(ctx, P.ASSETS_REGISTER);
  const item = itemRepo.getRaw(input.itemId);
  if (!item) throw validationError({ itemId: 'Choose an existing equipment item.' });
  assertLab(ctx, item.laboratoryId);
  if (item.itemType !== 'Equipment') throw validationError({ itemId: 'Only Equipment items are tracked as individual assets.' });
  if (item.status !== 'Active') throw ruleViolation('Archived items cannot receive new assets.');
  let id;
  inTransaction(() => {
    [id] = createAssets(ctx, item, 1, {
      condition: input.condition, reason: 'Asset registration', remarks: input.remarks, tags: input.assetTag ? [input.assetTag] : [], serialNumber: input.serialNumber,
    });
  });
  return get(ctx, id);
}

export function updateMeta(ctx, id, input) {
  requirePerm(ctx, P.ASSETS_UPDATE);
  const a = loadAsset(ctx, id);
  inTransaction(() => {
    repo.updateMeta(id, { ...input, now: nowIso() });
    recordAudit(ctx, { action: 'Asset updated', entity: 'Asset', recordId: id, laboratoryId: a.laboratoryId, previous: { serialNumber: a.serialNumber, remarks: a.remarks }, next: input });
  });
  return get(ctx, id);
}

// Manual targets. Borrowed → release flow; Under Maintenance → maintenance flow; Damaged/Lost → damage/loss flow.
const MANUAL_STATUSES = ['Available', 'In Use', 'Under Inspection', 'Retired'];

export function changeState(ctx, id, { status, condition, reason }) {
  requirePerm(ctx, P.ASSETS_UPDATE);
  const a = loadAsset(ctx, id);
  if (status === undefined && condition === undefined) throw validationError({ status: 'Choose a new status or condition.' });
  if (status && status !== a.status) {
    if (!MANUAL_STATUSES.includes(status)) {
      const via = { Borrowed: 'release the item through an approved borrowing request', 'Under Maintenance': 'log a maintenance record', Damaged: 'use “Report damage / loss”', Lost: 'use “Report damage / loss”' }[status];
      throw ruleViolation(`“${status}” cannot be set by hand — ${via}.`);
    }
    if (a.status === 'Borrowed') throw ruleViolation(`${a.tag} is currently borrowed. Process the return first.`);
    if (a.status === 'Under Maintenance') throw ruleViolation(`${a.tag} is under maintenance. Complete the maintenance record first.`);
  }
  if (a.status === 'Borrowed' && condition && condition !== a.condition) throw ruleViolation(`${a.tag} is currently borrowed. Record its condition when it is returned.`);
  inTransaction(() => applyAssetState(ctx, a, { status, condition, reason }));
  return get(ctx, id);
}
