// -----------------------------------------------------------------------------
// borrowing/service.js — UC-008 Create, UC-009 Approve/Reject, UC-010 Release,
// UC-011 Return (FR-014…FR-018, BR-005/006/012, DIR-001/002, RA-006/014).
//
//   Pending ──approve──▶ Approved ──release──▶ Released ──return(all)──▶ Returned
//      │ reject               │ cancel            │ (past due date) ▶ Overdue ─return▶ Returned
//      ▼                      ▼
//   Rejected              Cancelled
//
// Every state change runs in ONE database transaction together with its inventory /
// asset side-effects and its audit record: it either all happens or none of it does.
// -----------------------------------------------------------------------------
import { inTransaction } from '../../db/connection.js';
import { codes, parseCode } from '../../lib/codes.js';
import { conflict, notFound, ruleViolation, validationError } from '../../lib/errors.js';
import { likeTerm, pageMeta } from '../../lib/http.js';
import { assertLab, can, canAccessLab, labFilter, require as requirePerm } from '../../lib/scope.js';
import { nowIso, round2, todayLocal } from '../../lib/time.js';
import { createLogger } from '../../lib/logger.js';
import { recordAudit } from '../audit/record.js';
import { auditForRecord } from '../audit/repo.js';
import { P } from '../auth/permissions.js';
import { applyAssetState } from '../assets/state.js';
import * as damage from '../damage/service.js';
import { postMovement } from '../inventory/ledger.js';
import * as itemRepo from '../inventory/repo.js';
import * as repo from './repo.js';

const log = createLogger('borrowing');
const OPEN = ['Pending', 'Approved', 'Released', 'Overdue'];

const dto = (r) => r && ({
  ...r, code: codes.request(r.id, r.requestDate),
  isOverdue: r.status === 'Overdue',
  awaitingReturnProcessing: !!r.returnConfirmedAt && ['Released', 'Overdue'].includes(r.status),
});

// ---- access ---------------------------------------------------------------------
function canSee(ctx, r) {
  return can(ctx, P.BORROW_VIEW_ALL) ? canAccessLab(ctx, r.laboratoryId) : r.requesterId === ctx.user.id; // BR-011 / BR-012
}
function load(ctx, id) {
  sweepOverdue();
  const r = repo.getById(id);
  if (!r || !canSee(ctx, r)) throw notFound('Borrowing request');
  return r;
}
const isOwn = (ctx, r) => r.requesterId === ctx.user.id;

// ---- overdue detection (FR-015) ------------------------------------------------------
/** Released requests past their expected return date become Overdue. Cheap; called on reads and hourly. */
export function sweepOverdue() {
  const rows = repo.overdueCandidates(todayLocal());
  if (!rows.length) return 0;
  inTransaction(() => {
    for (const r of rows) {
      repo.setStatus(r.id, 'Overdue');
      recordAudit({ requestId: 'sweep' }, { action: 'Request marked overdue', entity: 'Borrowing Request', recordId: r.id, laboratoryId: r.laboratoryId, previous: { status: 'Released' }, next: { status: 'Overdue' }, reason: 'Expected return date has passed' });
    }
  });
  log.info('requests marked overdue', { count: rows.length });
  return rows.length;
}

// ---- outstanding items (what is still out) ---------------------------------------------
export function outstandingLines(requestId) {
  const lines = new Map();
  const keyOf = (x) => (x.assetId ? `a${x.assetId}` : `i${x.itemId}`);
  for (const r of repo.releaseItemsOf(requestId)) {
    const l = lines.get(keyOf(r)) ?? { key: keyOf(r), itemId: r.itemId, itemName: r.itemName, itemType: r.itemType, unit: r.unit, assetId: r.assetId, assetTag: r.assetTag, released: 0, returned: 0, damaged: 0, missing: 0 };
    l.released = round2(l.released + r.quantityReleased);
    lines.set(l.key, l);
  }
  for (const t of repo.returnItemsOf(requestId)) {
    const l = lines.get(keyOf(t));
    if (!l) continue;
    l.returned = round2(l.returned + t.quantityReturned); l.damaged = round2(l.damaged + t.damagedQuantity); l.missing = round2(l.missing + t.missingQuantity);
  }
  return [...lines.values()].map((l) => ({ ...l, outstanding: round2(l.released - l.returned - l.missing) }));
}

// ---- queries ------------------------------------------------------------------------------
export function list(ctx, query, page) {
  sweepOverdue();
  const where = [], params = [];
  if (can(ctx, P.BORROW_VIEW_ALL)) {
    const s = labFilter(ctx, 'r.laboratory_id', Number(query.laboratoryId) || null);
    where.push(s.sql); params.push(...s.params);
    if (query.mine === '1') { where.push('r.requester_id = ?'); params.push(ctx.user.id); }
    else if (query.requesterId) { where.push('r.requester_id = ?'); params.push(Number(query.requesterId)); }
  } else { where.push('r.requester_id = ?'); params.push(ctx.user.id); }
  const term = (query.search || '').trim();
  if (term) {
    const codeId = parseCode('BR', term);
    where.push(`(rq.first_name || ' ' || rq.last_name LIKE ? ESCAPE '\\' OR r.purpose LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM Borrowing_Request_Item x JOIN Inventory_Item i ON i.item_id = x.item_id WHERE x.request_id = r.request_id AND i.item_name LIKE ? ESCAPE '\\')
      ${codeId ? 'OR r.request_id = ?' : ''})`);
    params.push(likeTerm(term), likeTerm(term), likeTerm(term), ...(codeId ? [codeId] : []));
  }
  const baseWhere = where.join(' AND '), baseParams = [...params];
  if (query.status && query.status !== 'All') { where.push('r.status = ?'); params.push(query.status); }
  const { total, rows } = repo.query({ where: where.join(' AND '), params, limit: page.pageSize, offset: page.offset });
  return { rows: rows.map(dto), meta: { ...pageMeta(total, page), statusCounts: repo.statusCounts(baseWhere, baseParams) } };
}

export function get(ctx, id) {
  const r = dto(load(ctx, id));
  r.items = repo.itemsOf(id);
  r.releases = repo.releasesOf(id);
  r.releaseItems = repo.releaseItemsOf(id);
  r.returns = repo.returnsOf(id);
  r.returnItems = repo.returnItemsOf(id);
  r.outstanding = outstandingLines(id).filter((l) => l.outstanding > 0);
  r.timeline = auditForRecord('Borrowing Request', id, 40);
  return r;
}

export function releasePlan(ctx, id) {
  requirePerm(ctx, P.BORROW_RELEASE);
  const r = load(ctx, id);
  assertLab(ctx, r.laboratoryId);
  if (r.status !== 'Approved') throw ruleViolation('Only approved requests can be released.');
  return repo.itemsOf(id).map((it) => {
    if (it.itemType === 'Equipment') {
      const assets = repo.availableAssets(it.itemId);
      return { ...it, assets, suggestedAssetIds: assets.slice(0, it.quantity).map((a) => a.id), shortfall: Math.max(0, it.quantity - assets.length) };
    }
    return { ...it, shortfall: Math.max(0, round2(it.quantity - it.availableQuantity)) };
  });
}

// ---- UC-008 create --------------------------------------------------------------------------
export function create(ctx, input) {
  requirePerm(ctx, P.BORROW_CREATE);
  assertLab(ctx, input.laboratoryId);
  const lab = repo.labStatus(input.laboratoryId);
  if (!lab) throw validationError({ laboratoryId: 'Choose an existing laboratory.' });
  if (lab.status !== 'Operational') throw validationError({ laboratoryId: 'That laboratory is not operational.' });

  let requesterId = ctx.user.id;
  if (input.requesterId && input.requesterId !== ctx.user.id) {
    requirePerm(ctx, P.BORROW_CREATE_FOR_OTHERS);
    requesterId = input.requesterId;
  }
  const requester = repo.requesterInfo(requesterId);
  if (!requester || requester.status !== 'Active') throw ruleViolation('Deactivated users cannot create new borrowing requests.');   // FR-033
  if (!repo.requesterHasLab(requesterId, input.laboratoryId) && requester.roleName !== 'System Administrator') {
    throw validationError({ requesterId: 'The requester is not assigned to this laboratory.' });
  }
  if (input.expectedReturnDate < todayLocal()) throw validationError({ expectedReturnDate: 'The expected return date cannot be in the past.' });

  const seen = new Set();
  input.items.forEach((line, i) => {
    if (seen.has(line.itemId)) throw validationError({ [`items.${i}.itemId`]: 'This item is listed twice — combine the quantities.' });
    seen.add(line.itemId);
    const item = itemRepo.getRaw(line.itemId);
    if (!item || item.laboratoryId !== input.laboratoryId) throw validationError({ [`items.${i}.itemId`]: 'Choose items from the selected laboratory.' });
    if (item.status !== 'Active') throw validationError({ [`items.${i}.itemId`]: `“${item.name}” is archived and cannot be borrowed.` });
    if (item.itemType === 'Equipment' && !Number.isInteger(line.quantity)) throw validationError({ [`items.${i}.quantity`]: 'Equipment is borrowed in whole units.' });
    if (line.quantity > item.quantity) throw validationError({ [`items.${i}.quantity`]: `Only ${item.quantity} ${item.unit} of “${item.name}” exist in this laboratory.` });
  });

  const id = inTransaction(() => {
    const newId = Number(repo.insertRequest({ requesterId, laboratoryId: input.laboratoryId, purpose: input.purpose, expectedReturnDate: input.expectedReturnDate, remarks: input.remarks, now: nowIso() }));
    for (const line of input.items) repo.insertRequestItem({ requestId: newId, itemId: line.itemId, quantity: round2(line.quantity), remarks: line.remarks });
    recordAudit(ctx, { action: 'Request submitted', entity: 'Borrowing Request', recordId: newId, laboratoryId: input.laboratoryId, next: { requester: requesterId, purpose: input.purpose, items: input.items.length, expectedReturnDate: input.expectedReturnDate } });
    return newId;
  });
  return get(ctx, id);
}

// ---- UC-009 approve / reject / cancel -------------------------------------------------
export function approve(ctx, id, reason) {
  requirePerm(ctx, P.BORROW_APPROVE);
  const r = load(ctx, id);
  assertLab(ctx, r.laboratoryId);
  if (r.status !== 'Pending') throw ruleViolation(`Only pending requests can be approved (this one is ${r.status.toLowerCase()}).`);
  if (isOwn(ctx, r)) throw ruleViolation('You cannot approve your own request — another coordinator or staff member must.');
  const items = repo.itemsOf(id);
  const archived = items.find((i) => i.itemStatus !== 'Active');
  if (archived) throw ruleViolation(`“${archived.itemName}” has been archived and can no longer be lent.`);
  inTransaction(() => {
    repo.setDecision(id, { status: 'Approved', userId: ctx.user.id, now: nowIso(), reason });
    recordAudit(ctx, { action: 'Request approved', entity: 'Borrowing Request', recordId: id, laboratoryId: r.laboratoryId, previous: { status: 'Pending' }, next: { status: 'Approved' }, reason });
  });
  const result = get(ctx, id);
  result.warnings = items.filter((i) => i.quantity > i.availableQuantity).map((i) => `${i.itemName}: ${i.availableQuantity} available now, ${i.quantity} requested.`);
  return result;
}
export function reject(ctx, id, reason) {
  requirePerm(ctx, P.BORROW_APPROVE);
  const r = load(ctx, id);
  assertLab(ctx, r.laboratoryId);
  if (r.status !== 'Pending') throw ruleViolation(`Only pending requests can be rejected (this one is ${r.status.toLowerCase()}).`);
  inTransaction(() => {
    repo.setDecision(id, { status: 'Rejected', userId: ctx.user.id, now: nowIso(), reason });
    recordAudit(ctx, { action: 'Request rejected', entity: 'Borrowing Request', recordId: id, laboratoryId: r.laboratoryId, previous: { status: 'Pending' }, next: { status: 'Rejected' }, reason });
  });
  return get(ctx, id);
}
export function cancel(ctx, id, reason) {
  const r = load(ctx, id);
  if (!(isOwn(ctx, r) || (can(ctx, P.BORROW_CANCEL_ANY) && canAccessLab(ctx, r.laboratoryId)))) throw notFound('Borrowing request');
  if (!['Pending', 'Approved'].includes(r.status)) throw ruleViolation(`A ${r.status.toLowerCase()} request cannot be cancelled.`);
  inTransaction(() => {
    repo.setStatus(id, 'Cancelled');
    recordAudit(ctx, { action: 'Request cancelled', entity: 'Borrowing Request', recordId: id, laboratoryId: r.laboratoryId, previous: { status: r.status }, next: { status: 'Cancelled' }, reason });
  });
  return get(ctx, id);
}

// ---- UC-010 release -----------------------------------------------------------------------------
export function release(ctx, id, input) {
  requirePerm(ctx, P.BORROW_RELEASE);
  const r = load(ctx, id);
  assertLab(ctx, r.laboratoryId);
  if (r.status !== 'Approved') throw ruleViolation(r.status === 'Pending' ? 'This request must be approved before items can be released.' : `This request is ${r.status.toLowerCase()} and cannot be released.`); // BR-006
  const requested = new Map(repo.itemsOf(id).map((it) => [it.id, it]));
  const plan = [];                                            // validated release lines
  const usedAssets = new Set();
  input.items.forEach((line, i) => {
    const it = requested.get(line.requestItemId);
    if (!it) throw validationError({ [`items.${i}.requestItemId`]: 'This line is not part of the request.' });
    if (it.itemStatus !== 'Active') throw ruleViolation(`“${it.itemName}” is archived and cannot be released.`);
    if (it.itemType === 'Equipment') {
      const ids = [...new Set(line.assetIds ?? [])];
      if (ids.length > it.quantity) throw validationError({ [`items.${i}.assetIds`]: `Select at most ${it.quantity} unit(s) of ${it.itemName}.` });
      const assets = repo.assetsByIds(ids);
      if (assets.length !== ids.length) throw validationError({ [`items.${i}.assetIds`]: 'One of the selected assets does not exist.' });
      for (const a of assets) {
        if (a.itemId !== it.itemId || a.laboratoryId !== r.laboratoryId) throw ruleViolation(`${a.tag} does not belong to ${it.itemName} in this laboratory.`);
        if (a.status !== 'Available') throw ruleViolation(`${a.tag} is ${a.status.toLowerCase()} and cannot be released.`);                // FR-033, BR-004, BR-005
        if (['Damaged', 'Non-functional'].includes(a.condition)) throw ruleViolation(`${a.tag} is ${a.condition.toLowerCase()} and cannot be released.`);
        if (usedAssets.has(a.id)) throw ruleViolation(`${a.tag} is selected twice.`);
        usedAssets.add(a.id);
      }
      if (assets.length) plan.push({ it, assets });
    } else {
      const qty = round2(line.quantity ?? 0);
      if (qty < 0 || qty > it.quantity) throw validationError({ [`items.${i}.quantity`]: `Release between 0 and ${it.quantity} ${it.unit}.` });
      if (qty > it.onHand) throw ruleViolation(`Only ${it.onHand} ${it.unit} of ${it.itemName} are on hand — cannot release ${qty}.`);
      if (qty > 0) plan.push({ it, qty });
    }
  });
  if (!plan.length) throw ruleViolation('Select at least one unit to release.');

  inTransaction(() => {
    const releaseId = Number(repo.insertRelease({ requestId: id, userId: ctx.user.id, remarks: input.remarks, now: nowIso() }));
    const code = codes.request(id, r.requestDate);
    const summary = [];
    for (const p of plan) {
      if (p.assets) {
        for (const a of p.assets) {
          repo.insertReleaseItem({ releaseId, itemId: p.it.itemId, assetId: a.id, quantity: 1 });
          applyAssetState(ctx, a, { status: 'Borrowed', reason: `Released for ${code}` });
        }
        summary.push(`${p.assets.length} × ${p.it.itemName} (${p.assets.map((a) => a.tag).join(', ')})`);
      } else {
        postMovement(ctx, { itemId: p.it.itemId, type: 'Stock-out', delta: -p.qty, reason: 'Released to borrower', remarks: code });
        repo.insertReleaseItem({ releaseId, itemId: p.it.itemId, assetId: null, quantity: p.qty });
        summary.push(`${p.qty} ${p.it.unit} ${p.it.itemName}`);
      }
    }
    repo.setStatus(id, 'Released');
    recordAudit(ctx, { action: 'Items released', entity: 'Borrowing Request', recordId: id, laboratoryId: r.laboratoryId, previous: { status: 'Approved' }, next: { status: 'Released', items: summary }, reason: input.remarks });
  });
  return get(ctx, id);
}

// ---- UC-011 return ----------------------------------------------------------------------------------
export function processReturn(ctx, id, input) {
  requirePerm(ctx, P.BORROW_RETURN);
  const r = load(ctx, id);
  assertLab(ctx, r.laboratoryId);
  if (!['Released', 'Overdue'].includes(r.status)) throw ruleViolation('Only released requests can be returned.');
  const lines = new Map(outstandingLines(id).map((l) => [l.key, l]));
  const releaseDay = todayLocal(new Date(repo.releasesOf(id)[0]?.releaseDate ?? r.requestDate));
  let returnDateIso = nowIso();
  if (input.returnDate && input.returnDate !== todayLocal()) {
    if (input.returnDate > todayLocal()) throw validationError({ returnDate: 'The return date cannot be in the future.' });
    if (input.returnDate < releaseDay) throw validationError({ returnDate: 'The return date cannot be before the release date.' });
    returnDateIso = `${input.returnDate}T12:00:00.000Z`;
  }

  const seen = new Set(), work = [];
  input.items.forEach((x, i) => {
    const key = x.assetId ? `a${x.assetId}` : `i${x.itemId}`;
    const line = lines.get(key);
    const at = (f) => `items.${i}.${f}`;
    if (!line || line.itemId !== x.itemId) throw validationError({ [at('itemId')]: 'This line was not released on this request.' });
    if (seen.has(key)) throw validationError({ [at('itemId')]: 'This line appears twice.' });
    seen.add(key);
    const returned = round2(x.returned), damaged = round2(x.damaged), missing = round2(x.missing);
    if (damaged > returned) throw validationError({ [at('damaged')]: 'Damaged quantity cannot exceed the quantity returned.' });
    if (returned + missing > line.outstanding + 1e-9) throw ruleViolation(`Return quantity cannot exceed the released quantity (${line.outstanding} still outstanding for ${line.assetTag || line.itemName}).`); // FR-033
    if (line.assetId && ![returned, damaged, missing].every(Number.isInteger)) throw validationError({ [at('returned')]: 'Individually tracked units are returned one by one.' });
    if (returned + missing === 0) return;                                   // untouched line
    let condition = x.condition ?? null;
    if (line.assetId && returned > 0) {
      if (damaged > 0) { condition = condition ?? 'Damaged'; if (!['Damaged', 'Non-functional'].includes(condition)) throw validationError({ [at('condition')]: 'A damaged unit must be rated Damaged or Non-functional.' }); }
      else { condition = condition ?? 'Good'; if (['Damaged', 'Non-functional'].includes(condition)) throw validationError({ [at('condition')]: 'Mark the unit as damaged instead of rating it Damaged/Non-functional.' }); }
    }
    work.push({ line, returned, damaged, missing, condition, remarks: x.remarks });
  });
  if (!work.length) throw ruleViolation('Enter what is being returned (or mark items missing).');

  let complete = false;
  inTransaction(() => {
    const returnId = Number(repo.insertReturn({ requestId: id, userId: ctx.user.id, returnDate: returnDateIso, remarks: input.remarks }));
    const code = codes.request(id, r.requestDate);
    const tally = { returned: 0, damaged: 0, missing: 0 };
    for (const w of work) {
      const { line } = w;
      repo.insertReturnItem({ returnId, itemId: line.itemId, assetId: line.assetId, returned: w.returned, missing: w.missing, damaged: w.damaged, condition: w.condition, remarks: w.remarks });
      tally.returned += w.returned; tally.damaged += w.damaged; tally.missing += w.missing;
      const item = itemRepo.getRaw(line.itemId);
      if (line.assetId) {
        const [asset] = repo.assetsByIds([line.assetId]);
        if (w.missing > 0) {
          damage.insertRecord(ctx, { itemId: line.itemId, assetId: line.assetId, recordType: 'Loss', description: `Not returned for ${code}`, laboratoryId: item.laboratoryId });
          applyAssetState(ctx, asset, { status: 'Lost', reason: `Missing on return of ${code}`, ledgerReason: 'Loss' });
        } else if (w.damaged > 0) {
          damage.insertRecord(ctx, { itemId: line.itemId, assetId: line.assetId, recordType: 'Damage', description: `Returned damaged for ${code}`, currentCondition: w.condition, laboratoryId: item.laboratoryId, remarks: w.remarks });
          applyAssetState(ctx, asset, { status: 'Damaged', condition: w.condition, reason: `Returned damaged: ${code}` });
        } else {
          applyAssetState(ctx, asset, { status: 'Available', condition: w.condition, reason: `Returned: ${code}` });
        }
      } else {
        const restock = round2(w.returned - w.damaged);
        if (restock > 0) postMovement(ctx, { itemId: line.itemId, type: 'Stock-in', delta: restock, reason: 'Returned from borrower', remarks: code });
        if (w.damaged > 0) damage.insertRecord(ctx, { itemId: line.itemId, recordType: 'Damage', quantity: w.damaged, description: `Returned damaged for ${code}`, laboratoryId: item.laboratoryId, remarks: w.remarks });
        if (w.missing > 0) damage.insertRecord(ctx, { itemId: line.itemId, recordType: 'Loss', quantity: w.missing, description: `Not returned for ${code}`, laboratoryId: item.laboratoryId, remarks: w.remarks });
      }
    }
    complete = outstandingLines(id).every((l) => l.outstanding <= 0);
    if (complete) repo.setStatus(id, 'Returned');
    recordAudit(ctx, { action: 'Items returned', entity: 'Borrowing Request', recordId: id, laboratoryId: r.laboratoryId, previous: { status: r.status }, next: { status: complete ? 'Returned' : r.status, ...tally, complete }, reason: input.remarks });
  });
  return get(ctx, id);
}

// ---- teacher: confirm / facilitate return (SRS 5.3) -------------------------------------------------
export function confirmReturn(ctx, id) {
  requirePerm(ctx, P.BORROW_CONFIRM_RETURN);
  const r = load(ctx, id);
  if (!isOwn(ctx, r)) throw notFound('Borrowing request');
  if (!['Released', 'Overdue'].includes(r.status)) throw ruleViolation('Only items that are currently borrowed can be confirmed as returning.');
  if (r.returnConfirmedAt) throw conflict('You have already told the laboratory these items are being returned.');
  inTransaction(() => {
    repo.setReturnConfirmed(id, nowIso());
    recordAudit(ctx, { action: 'Return confirmed by borrower', entity: 'Borrowing Request', recordId: id, laboratoryId: r.laboratoryId, reason: 'Borrower is returning the items — awaiting laboratory check-in' });
  });
  return get(ctx, id);
}
