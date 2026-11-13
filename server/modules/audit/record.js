// -----------------------------------------------------------------------------
// audit/record.js — the ONE function every module calls to write an audit row
// (FR-032, BR-009, SR-005). Call it INSIDE the same DB transaction as the change
// it describes, so a change and its audit record succeed or fail together.
//
//   recordAudit(ctx, { action: 'Inventory updated', entity: 'Inventory Item', recordId: 4,
//                      previous: {quantity: 38}, next: {quantity: 36}, reason: '…', laboratoryId: 1 });
// -----------------------------------------------------------------------------
import { insertAudit, systemUserId } from './repo.js';
import { nowIso } from '../../lib/time.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('audit');
const encode = (v) => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));

export function recordAudit(ctx, { action, entity, recordId = null, previous = null, next = null, reason = null, laboratoryId = null, userId }) {
  const uid = userId ?? ctx?.user?.id ?? systemUserId();
  const id = insertAudit({
    userId: uid, timestamp: nowIso(), action, entity, recordId,
    previous: encode(previous), next: encode(next), reason: reason || null, laboratoryId: laboratoryId ?? null,
  });
  log.debug(action, { entity, recordId, auditId: id, requestId: ctx?.requestId });
  return id;
}
