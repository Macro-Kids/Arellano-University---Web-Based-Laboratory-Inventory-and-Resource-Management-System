// -----------------------------------------------------------------------------
// assets/state.js — the single function that changes an asset's status/condition.
// Used by assets, borrowing (release/return), maintenance and damage/loss so the
// rules (BR-004, BR-005, RA-015) and the audit/ledger side-effects live ONCE.
// Call inside a DB transaction.
// -----------------------------------------------------------------------------
import { ruleViolation } from '../../lib/errors.js';
import { nowIso } from '../../lib/time.js';
import { recordAudit } from '../audit/record.js';
import { syncEquipmentQuantity } from '../inventory/ledger.js';
import * as repo from './repo.js';

const NOT_OWNED = new Set(['Lost', 'Retired']);

export function applyAssetState(ctx, asset, { status, condition, reason, ledgerReason }) {
  const nextStatus = status ?? asset.status;
  const nextCondition = condition ?? asset.condition;
  if (nextStatus === asset.status && nextCondition === asset.condition) return asset;
  // A damaged / non-functional unit must never look "Available".
  if (nextStatus === 'Available' && (nextCondition === 'Damaged' || nextCondition === 'Non-functional')) {
    throw ruleViolation(`Asset ${asset.tag} is ${nextCondition.toLowerCase()} and cannot be marked Available. Log maintenance or change its condition first.`);
  }
  repo.updateState(asset.id, nextStatus, nextCondition, nowIso());
  const prev = {}, next = {};
  if (nextStatus !== asset.status) { prev.status = asset.status; next.status = nextStatus; }
  if (nextCondition !== asset.condition) { prev.condition = asset.condition; next.condition = nextCondition; }
  recordAudit(ctx, {
    action: nextStatus !== asset.status ? 'Asset status changed' : 'Asset condition changed',
    entity: 'Asset', recordId: asset.id, laboratoryId: asset.laboratoryId, previous: { tag: asset.tag, ...prev }, next: next, reason,
  });
  // Moving into/out of Lost/Retired changes how many units the lab owns → post to the ledger.
  if (NOT_OWNED.has(nextStatus) !== NOT_OWNED.has(asset.status)) {
    syncEquipmentQuantity(ctx, asset.itemId, ledgerReason || (NOT_OWNED.has(nextStatus) ? (nextStatus === 'Lost' ? 'Loss' : 'Disposal') : 'Recovered'), `${asset.tag}: ${reason || ''}`.trim());
  }
  return repo.getById(asset.id);
}
