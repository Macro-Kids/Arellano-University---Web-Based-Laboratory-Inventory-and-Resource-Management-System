// -----------------------------------------------------------------------------
// inventory/ledger.js — the ONLY code allowed to change Inventory_Item.quantity.
//
//   postMovement(ctx, {itemId, type, delta, reason, ...})
//        quantity += delta  (never below 0, BR-003)  +  one immutable ledger row
//        carrying the running balance.            Invariant:  quantity = SUM(ledger)
//
//   syncEquipmentQuantity(ctx, itemId, reason)
//        Equipment quantity = number of owned assets (not Lost/Retired). After any
//        asset change this posts the difference to the ledger, so the asset
//        register and the stock ledger can never drift apart (DIR-001).
//
// Both must be called inside a DB transaction together with the audit record.
// -----------------------------------------------------------------------------
import { notFound, ruleViolation } from '../../lib/errors.js';
import { nowIso, round2 } from '../../lib/time.js';
import { createLogger } from '../../lib/logger.js';
import * as repo from './repo.js';

const log = createLogger('ledger');

export function postMovement(ctx, { itemId, type, delta, reason, source = null, remarks = null }) {
  const item = repo.getRaw(itemId);
  if (!item) throw notFound('Inventory item');
  delta = round2(delta);
  if (delta === 0) throw ruleViolation('Quantity must not be zero.');
  const newQty = round2(item.quantity + delta);
  if (newQty < 0) {
    throw ruleViolation(`Only ${item.quantity} ${item.unit} of “${item.name}” on hand — cannot remove ${Math.abs(delta)}. Quantities can never be negative.`,
      { onHand: item.quantity, requested: Math.abs(delta) });
  }
  const now = nowIso();
  repo.setQuantity(itemId, newQty, now);
  const transactionId = Number(repo.insertTransaction({
    itemId, userId: ctx?.user?.id ?? 0, type, quantity: delta, date: now, reason, source, remarks, balanceAfter: newQty,
  }));
  log.debug('movement posted', { itemId, type, delta, newQty, transactionId, rid: ctx?.requestId });
  return { transactionId, previousQuantity: item.quantity, quantity: newQty, delta };
}

export function syncEquipmentQuantity(ctx, itemId, reason, remarks = null) {
  const item = repo.getRaw(itemId);
  if (!item || item.itemType !== 'Equipment') return null;
  const owned = repo.ownedAssetCount(itemId);
  const delta = round2(owned - item.quantity);
  if (delta === 0) return null;
  return postMovement(ctx, { itemId, type: delta > 0 ? 'Stock-in' : 'Stock-out', delta, reason, remarks });
}
