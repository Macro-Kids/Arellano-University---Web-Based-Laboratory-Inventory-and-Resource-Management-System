// -----------------------------------------------------------------------------
// damage/service.js — UC-012 Record Damage and Loss (FR-019, FR-020, BR-004, RA-007).
//   asset  : Damage → status Damaged (+ condition) ; Loss → status Lost (never available again)
//   bulk   : stock-out (reason Damage/Loss) + a record with the quantity
// insertRecord() is also used by return processing, which manages asset state itself.
// -----------------------------------------------------------------------------
import { inTransaction } from '../../db/connection.js';
import { notFound, ruleViolation, validationError } from '../../lib/errors.js';
import { pageMeta } from '../../lib/http.js';
import { assertLab, labFilter, require as requirePerm } from '../../lib/scope.js';
import { nowIso } from '../../lib/time.js';
import { codes } from '../../lib/codes.js';
import { recordAudit } from '../audit/record.js';
import { P } from '../auth/permissions.js';
import * as assetRepo from '../assets/repo.js';
import { applyAssetState } from '../assets/state.js';
import { postMovement } from '../inventory/ledger.js';
import * as itemRepo from '../inventory/repo.js';
import * as repo from './repo.js';

export function insertRecord(ctx, { itemId, assetId = null, recordType, description, currentCondition = null, actionTaken = null, remarks = null, quantity = 1, laboratoryId }) {
  const id = Number(repo.insert({ itemId, assetId, recordType, description, userId: ctx.user.id, currentCondition, actionTaken, remarks, quantity, now: nowIso() }));
  recordAudit(ctx, {
    action: recordType === 'Loss' ? 'Loss recorded' : 'Damage recorded', entity: 'Damage/Loss Record', recordId: id, laboratoryId,
    next: { itemId, assetId, quantity, description }, reason: actionTaken,
  });
  return id;
}

export function recordForItem(ctx, itemId, { recordType, quantity, description, actionTaken = null, remarks = null }) {
  const item = itemRepo.getRaw(itemId);
  if (!item) throw notFound('Inventory item');
  if (item.itemType !== 'Consumable') throw validationError({ assetId: 'Select the specific asset that was damaged or lost.' });
  return inTransaction(() => {
    postMovement(ctx, { itemId, type: 'Stock-out', delta: -quantity, reason: recordType, remarks: description });
    return insertRecord(ctx, { itemId, recordType, quantity, description, actionTaken, remarks, currentCondition: recordType === 'Damage' ? 'Damaged' : null, laboratoryId: item.laboratoryId });
  });
}

export function record(ctx, input) {
  requirePerm(ctx, P.DAMAGE_RECORD);
  if (!input.assetId && !input.itemId) throw validationError({ assetId: 'Choose the asset or item affected.' });
  if (input.assetId) {
    const asset = assetRepo.getById(input.assetId);
    if (!asset) throw notFound('Asset');
    assertLab(ctx, asset.laboratoryId);
    if (asset.status === 'Borrowed') throw ruleViolation(`${asset.tag} is currently borrowed — record damage or loss while processing its return.`);
    if (asset.status === 'Retired') throw ruleViolation(`${asset.tag} is already retired.`);
    if (asset.status === 'Lost') throw ruleViolation(`${asset.tag} is already recorded as lost.`);
    if (input.recordType === 'Loss' && asset.status === 'Under Maintenance') throw ruleViolation(`${asset.tag} has an open maintenance record. Complete it before recording a loss.`);
    const condition = input.currentCondition || (input.recordType === 'Damage' ? 'Damaged' : asset.condition);
    if (input.recordType === 'Damage' && !['Fair', 'Damaged', 'Non-functional'].includes(condition)) throw validationError({ currentCondition: 'Damaged equipment must be Fair, Damaged or Non-functional.' });
    return inTransaction(() => {
      const id = insertRecord(ctx, { itemId: asset.itemId, assetId: asset.id, recordType: input.recordType, description: input.description, currentCondition: condition, actionTaken: input.actionTaken, remarks: input.remarks, laboratoryId: asset.laboratoryId });
      applyAssetState(ctx, asset, {
        status: input.recordType === 'Loss' ? 'Lost' : (asset.status === 'Under Maintenance' ? undefined : 'Damaged'),
        condition: condition, reason: input.description, ledgerReason: input.recordType === 'Loss' ? 'Loss' : undefined,
      });
      return id;
    });
  }
  const item = itemRepo.getRaw(input.itemId);
  if (!item) throw notFound('Inventory item');
  assertLab(ctx, item.laboratoryId);
  if (item.status !== 'Active') throw ruleViolation('Archived items cannot be changed.');
  return recordForItem(ctx, item.id, { recordType: input.recordType, quantity: input.quantity, description: input.description, actionTaken: input.actionTaken, remarks: input.remarks });
}

export function list(ctx, query, page) {
  const scope = labFilter(ctx, 'i.laboratory_id', Number(query.laboratoryId) || null);
  const where = [scope.sql], params = [...scope.params];
  if (['Damage', 'Loss'].includes(query.type)) { where.push('d.record_type = ?'); params.push(query.type); }
  if (query.assetId) { where.push('d.asset_id = ?'); params.push(Number(query.assetId)); }
  const { total, rows } = repo.query({ where: where.join(' AND '), params, limit: page.pageSize, offset: page.offset });
  return { rows: rows.map((r) => ({ ...r, code: codes.damageLoss(r.id) })), meta: pageMeta(total, page) };
}
