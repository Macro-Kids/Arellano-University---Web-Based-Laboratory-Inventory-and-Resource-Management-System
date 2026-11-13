// -----------------------------------------------------------------------------
// inventory/service.js — UC-004 Manage Inventory, UC-005 Manage Inventory Quantity,
// UC-007 Search & Filter (FR-004…FR-010, FR-023…FR-025).
// Rules enforced: BR-001 (item belongs to a lab), BR-003 (never negative), BR-007
// (only authorised users change quantities), BR-008 (no silent delete → archive),
// BR-009/FR-005 (changes are audited), BR-010 (archived stays reportable).
// -----------------------------------------------------------------------------
import { inTransaction } from '../../db/connection.js';
import { codes, parseCode } from '../../lib/codes.js';
import { notFound, ruleViolation, validationError, conflict, forbidden } from '../../lib/errors.js';
import { diffFields } from '../../lib/diff.js';
import { likeTerm, pageMeta } from '../../lib/http.js';
import { assertLab, can, labFilter, require as requirePerm } from '../../lib/scope.js';
import { nowIso, round2, todayLocal } from '../../lib/time.js';
import { STOCK_OUT_REASONS } from '../../lib/validate.js';
import { recordAudit } from '../audit/record.js';
import { auditForRecord } from '../audit/repo.js';
import { P } from '../auth/permissions.js';
import * as assets from '../assets/service.js';
import * as damage from '../damage/service.js';
import { postMovement, syncEquipmentQuantity } from './ledger.js';
import * as repo from './repo.js';

export function itemDto(ctx, row) {
  if (!row) return row;
  const stockState = row.quantity <= 0 ? 'out' : row.quantity <= row.minimumStock ? 'low' : 'ok';
  const dto = { ...row, code: codes.item(row.id), stockState };
  if (!can(ctx, P.INVENTORY_VIEW_DETAILS)) { dto.acquisitionSource = null; dto.remarks = null; }
  return dto;
}

/** Load an item and verify the caller may see its laboratory. */
export function loadItem(ctx, id) {
  const row = repo.getById(id);
  if (!row) throw notFound('Inventory item');
  assertLab(ctx, row.laboratoryId);
  return row;
}

export function search(ctx, query, page) {
  const scope = labFilter(ctx, 't.laboratoryId', Number(query.laboratoryId) || null);
  const term = (query.search || '').trim();
  const { total, rows } = repo.search({
    scopeSql: scope.sql, scopeParams: scope.params,
    q: term ? likeTerm(term) : null, codeId: term ? parseCode('ITM', term) : null,
    categoryId: Number(query.categoryId) || null,
    itemType: ['Equipment', 'Consumable'].includes(query.itemType) ? query.itemType : null,
    availability: ['available', 'unavailable', 'low', 'out'].includes(query.availability) ? query.availability : null,
    condition: query.condition || null,
    status: ['archived', 'all'].includes(query.status) ? query.status : 'active',
    location: query.location ? likeTerm(query.location) : null,
    sort: query.sort, dir: query.dir, limit: page.pageSize, offset: page.offset,
  });
  return { rows: rows.map((r) => itemDto(ctx, r)), meta: pageMeta(total, page) };
}

export function lookup(ctx, query) {
  const scope = labFilter(ctx, 't.laboratoryId', Number(query.laboratoryId) || null);
  return repo.lookup({ scopeSql: scope.sql, scopeParams: scope.params, q: query.q ? likeTerm(query.q) : null })
    .map((r) => ({ ...r, code: codes.item(r.id) }));
}

export function get(ctx, id) {
  const row = loadItem(ctx, id);
  const dto = itemDto(ctx, row);
  if (row.itemType === 'Equipment') {
    dto.assetStatusCounts = repo.assetStatusCounts(id);
    dto.assetConditionCounts = repo.assetConditionCounts(id);
    dto.onLoanQuantity = dto.assetStatusCounts.Borrowed || 0;
  } else {
    dto.onLoanQuantity = repo.onLoanQuantity(id);
  }
  dto.openRequestCount = repo.openRequestsForItem(id).length;
  return dto;
}

export function history(ctx, id, page) {
  loadItem(ctx, id);
  const { total, rows } = repo.queryTransactions({ where: 't.item_id = ?', params: [id], limit: page.pageSize, offset: page.offset });
  return { rows: rows.map((t) => ({ ...t, code: codes.movement(t.id) })), meta: pageMeta(total, page) };
}
export function auditTrail(ctx, id) {
  loadItem(ctx, id);
  return auditForRecord('Inventory Item', id, 30);
}

/** Letters of the name → default asset prefix, e.g. "Digital Compound Microscope" → "DIG". */
function defaultPrefix(name) {
  const letters = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const joined = letters.length >= 3 ? letters.slice(0, 3).map((w) => w[0]).join('') : (letters.join('') + 'XXX').slice(0, 3);
  return joined.slice(0, 6);
}

export function create(ctx, input) {
  requirePerm(ctx, P.INVENTORY_CREATE);
  assertLab(ctx, input.laboratoryId);
  const lab = repo.labById(input.laboratoryId);
  if (!lab) throw validationError({ laboratoryId: 'Choose an existing laboratory.' });            // BR-001
  if (lab.status !== 'Operational') throw validationError({ laboratoryId: 'That laboratory is inactive.' });
  const cat = repo.categoryById(input.categoryId);
  if (!cat || cat.status !== 'Active') throw validationError({ categoryId: 'Choose an active category.' });
  if (repo.nameTaken(input.laboratoryId, input.name)) throw validationError({ name: 'An item with this name already exists in this laboratory.' });
  if (input.itemType === 'Equipment' && (!Number.isInteger(input.quantity) || input.quantity > 500)) {
    throw validationError({ quantity: 'Equipment is tracked unit by unit — enter a whole number up to 500.' });
  }
  const prefix = input.itemType === 'Equipment' ? (input.assetPrefix || defaultPrefix(input.name)) : null;

  const id = inTransaction(() => {
    const newId = Number(repo.insert({ ...input, assetPrefix: prefix, now: nowIso() }));
    if (input.itemType === 'Equipment') {
      if (input.quantity > 0) assets.createAssets(ctx, repo.getRaw(newId), input.quantity, { condition: input.condition, reason: 'Initial registration' });
    } else if (input.quantity > 0) {
      postMovement(ctx, { itemId: newId, type: 'Stock-in', delta: input.quantity, reason: 'Opening balance', source: input.acquisitionSource });
    }
    recordAudit(ctx, {
      action: 'Inventory created', entity: 'Inventory Item', recordId: newId, laboratoryId: input.laboratoryId,
      next: { name: input.name, itemType: input.itemType, quantity: input.quantity, laboratory: lab.name, category: cat.name },
    });
    return newId;
  });
  return get(ctx, id);
}

export function update(ctx, id, input) {
  requirePerm(ctx, P.INVENTORY_UPDATE);
  const before = loadItem(ctx, id);
  if (before.status === 'Archived') throw ruleViolation('Archived items cannot be edited. Restore the item first.');
  const cat = repo.categoryById(input.categoryId);
  if (!cat || (cat.status !== 'Active' && cat.id !== before.categoryId)) throw validationError({ categoryId: 'Choose an active category.' });
  if (repo.nameTaken(before.laboratoryId, input.name, id)) throw validationError({ name: 'An item with this name already exists in this laboratory.' });
  inTransaction(() => {
    repo.updateMeta(id, { ...input, condition: before.itemType === 'Equipment' ? (repo.getRaw(id).condition ?? 'Good') : input.condition, now: nowIso() });
    const d = diffFields(before, { ...input, categoryName: cat.name }, ['name', 'description', 'categoryName', 'unit', 'minimumStock', 'location', 'acquisitionDate', 'acquisitionSource', 'remarks', ...(before.itemType === 'Consumable' ? ['condition'] : [])]);
    if (d.changed) recordAudit(ctx, { action: 'Inventory updated', entity: 'Inventory Item', recordId: id, laboratoryId: before.laboratoryId, previous: d.previous, next: d.next });
  });
  return get(ctx, id);
}

export function archive(ctx, id, reason) {
  requirePerm(ctx, P.INVENTORY_ARCHIVE);
  const item = loadItem(ctx, id);
  if (item.status === 'Archived') throw conflict('This item is already archived.');
  const open = repo.openRequestsForItem(id);
  if (open.length) throw ruleViolation(`Cannot archive: ${open.length} borrowing request(s) are still open for this item. Finish or cancel them first.`);
  if (item.itemType === 'Equipment' && (repo.assetStatusCounts(id).Borrowed || 0) > 0) throw ruleViolation('Cannot archive: some units are currently borrowed.');
  inTransaction(() => {
    repo.setArchived(id, nowIso(), nowIso());
    recordAudit(ctx, { action: 'Inventory archived', entity: 'Inventory Item', recordId: id, laboratoryId: item.laboratoryId, previous: { status: 'Active' }, next: { status: 'Archived' }, reason });
  });
  return get(ctx, id);
}
export function restore(ctx, id) {
  requirePerm(ctx, P.INVENTORY_ARCHIVE);
  const item = loadItem(ctx, id);
  if (item.status !== 'Archived') throw conflict('This item is not archived.');
  if (repo.nameTaken(item.laboratoryId, item.name, id)) throw ruleViolation('Cannot restore: another active item in this laboratory already uses this name. Rename it first.');
  inTransaction(() => {
    repo.setArchived(id, null, nowIso());
    recordAudit(ctx, { action: 'Inventory restored', entity: 'Inventory Item', recordId: id, laboratoryId: item.laboratoryId, previous: { status: 'Archived' }, next: { status: 'Active' } });
  });
  return get(ctx, id);
}

// ---- UC-005 stock movements ---------------------------------------------------
export function moveStock(ctx, id, input) {
  const item = loadItem(ctx, id);
  requirePerm(ctx, input.type === 'Adjustment' ? P.STOCK_ADJUST : P.STOCK_MOVE);               // BR-007
  if (item.status === 'Archived') throw ruleViolation('Archived items cannot be changed. Restore the item first.');
  const isEquipment = item.itemType === 'Equipment';

  if (isEquipment && input.type !== 'Stock-in') {
    throw ruleViolation('Equipment quantity follows the asset register. Change an individual asset’s status instead (retire, report lost, etc.).');
  }

  switch (input.type) {
    case 'Stock-in': {
      if (!input.quantity) throw validationError({ quantity: 'Enter the quantity received.' });
      if (!input.source) throw validationError({ source: 'Enter the source or reason for this stock-in.' });   // FR-008
      if (isEquipment && !Number.isInteger(input.quantity)) throw validationError({ quantity: 'Equipment is received in whole units.' });
      inTransaction(() => {
        if (isEquipment) {
          assets.createAssets(ctx, repo.getRaw(id), input.quantity, { condition: 'Good', reason: input.source, remarks: input.remarks });
        } else {
          postMovement(ctx, { itemId: id, type: 'Stock-in', delta: input.quantity, reason: input.reason || 'Stock received', source: input.source, remarks: input.remarks });
        }
        recordAudit(ctx, { action: 'Stock-in', entity: 'Inventory Item', recordId: id, laboratoryId: item.laboratoryId, previous: { quantity: item.quantity }, next: { quantity: round2(item.quantity + input.quantity) }, reason: input.source });
      });
      break;
    }
    case 'Stock-out': {
      if (!input.quantity) throw validationError({ quantity: 'Enter the quantity leaving stock.' });
      if (!input.reason || !STOCK_OUT_REASONS.includes(input.reason)) throw validationError({ reason: `Choose a reason: ${STOCK_OUT_REASONS.join(', ')}.` }); // FR-009
      if (input.reason === 'Other' && !input.remarks) throw validationError({ remarks: 'Please describe the reason.' });
      if (input.reason === 'Damage' || input.reason === 'Loss') {
        // Damage / loss of bulk items is a Damage_Loss_Record (FR-019/020) which also posts the stock-out.
        damage.recordForItem(ctx, id, { recordType: input.reason === 'Damage' ? 'Damage' : 'Loss', quantity: input.quantity, description: input.remarks || `${input.reason} recorded via stock-out` });
        break;
      }
      inTransaction(() => {
        postMovement(ctx, { itemId: id, type: 'Stock-out', delta: -input.quantity, reason: input.reason, remarks: input.remarks });
        recordAudit(ctx, { action: 'Stock-out', entity: 'Inventory Item', recordId: id, laboratoryId: item.laboratoryId, previous: { quantity: item.quantity }, next: { quantity: round2(item.quantity - input.quantity) }, reason: input.reason });
      });
      break;
    }
    case 'Adjustment': {
      if (input.newQuantity === undefined) throw validationError({ newQuantity: 'Enter the physical count.' });
      if (!input.reason || input.reason.length < 3) throw validationError({ reason: 'An adjustment requires a valid reason.' });   // FR-010 / FR-033
      if (input.expectedQuantity !== undefined && round2(input.expectedQuantity) !== round2(item.quantity)) {
        throw conflict(`Stock changed while you were editing (now ${item.quantity} ${item.unit}). Review the new balance and try again.`, { currentQuantity: item.quantity });
      }
      const delta = round2(input.newQuantity - item.quantity);
      if (delta === 0) throw ruleViolation('The physical count equals the system quantity — no adjustment is needed.');
      inTransaction(() => {
        postMovement(ctx, { itemId: id, type: 'Adjustment', delta, reason: input.reason, remarks: input.remarks });
        recordAudit(ctx, { action: 'Stock adjusted', entity: 'Inventory Item', recordId: id, laboratoryId: item.laboratoryId, previous: { quantity: item.quantity }, next: { quantity: input.newQuantity }, reason: input.reason });
      });
      break;
    }
    case 'Transfer': {
      if (!input.quantity) throw validationError({ quantity: 'Enter the quantity to transfer.' });
      if (!input.targetLaboratoryId) throw validationError({ targetLaboratoryId: 'Choose the destination laboratory.' });
      if (input.targetLaboratoryId === item.laboratoryId) throw validationError({ targetLaboratoryId: 'Choose a different laboratory.' });
      assertLab(ctx, input.targetLaboratoryId);
      const target = repo.labById(input.targetLaboratoryId);
      if (!target || target.status !== 'Operational') throw validationError({ targetLaboratoryId: 'Choose an operational laboratory.' });
      inTransaction(() => {
        let dest = repo.findActiveByName(target.id, item.name);
        if (!dest) {
          const newId = Number(repo.insert({
            name: item.name, description: item.description, categoryId: item.categoryId, laboratoryId: target.id, itemType: 'Consumable', unit: item.unit,
            minimumStock: 0, condition: item.condition || 'Good', location: null, acquisitionDate: todayLocal(), acquisitionSource: `Transfer from ${item.laboratoryName}`, remarks: null, assetPrefix: null, now: nowIso(),
          }));
          dest = { id: newId };
          recordAudit(ctx, { action: 'Inventory created', entity: 'Inventory Item', recordId: newId, laboratoryId: target.id, next: { name: item.name, via: `Transfer from ${item.laboratoryName}` } });
        }
        const note = input.remarks || null;
        postMovement(ctx, { itemId: id, type: 'Transfer', delta: -input.quantity, reason: `Transfer to ${target.name}`, remarks: note });
        postMovement(ctx, { itemId: dest.id, type: 'Transfer', delta: input.quantity, reason: `Transfer from ${item.laboratoryName}`, source: item.laboratoryName, remarks: note });
        recordAudit(ctx, { action: 'Stock transferred', entity: 'Inventory Item', recordId: id, laboratoryId: item.laboratoryId, previous: { quantity: item.quantity }, next: { quantity: round2(item.quantity - input.quantity), to: target.name, destinationItemId: dest.id }, reason: input.remarks || `Transfer to ${target.name}` });
      });
      break;
    }
  }
  return get(ctx, id);
}

export function movements(ctx, query, page) {
  const scope = labFilter(ctx, 'i.laboratory_id', Number(query.laboratoryId) || null);
  const where = [scope.sql], params = [...scope.params];
  if (query.itemId) { where.push('t.item_id = ?'); params.push(Number(query.itemId)); }
  if (['Stock-in', 'Stock-out', 'Adjustment', 'Transfer'].includes(query.type)) { where.push('t.transaction_type = ?'); params.push(query.type); }
  const { total, rows } = repo.queryTransactions({ where: where.join(' AND '), params, limit: page.pageSize, offset: page.offset });
  return { rows: rows.map((t) => ({ ...t, code: codes.movement(t.id) })), meta: pageMeta(total, page) };
}
export { syncEquipmentQuantity, forbidden };
