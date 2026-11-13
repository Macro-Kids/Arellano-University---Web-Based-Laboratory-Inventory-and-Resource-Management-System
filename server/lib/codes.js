// -----------------------------------------------------------------------------
// codes.js — human-friendly codes derived from numeric primary keys.
// The DB only stores integer IDs; codes are computed on the way out and parsed
// on the way in (search boxes). Keep both directions here so they never drift.
// -----------------------------------------------------------------------------
import { yearOf } from './time.js';

const pad = (n, w) => String(n).padStart(w, '0');

export const codes = {
  item: (id) => `ITM-${pad(id, 4)}`,
  lab: (id) => `LAB-${pad(id, 3)}`,
  user: (id) => `USR-${pad(id, 3)}`,
  request: (id, requestDateIso) => `BR-${yearOf(requestDateIso)}-${pad(id, 4)}`,
  maintenance: (id) => `MNT-${pad(id, 4)}`,
  movement: (id) => `MOV-${pad(id, 4)}`,
  audit: (id) => `AUD-${pad(id, 4)}`,
  damageLoss: (id) => `DLR-${pad(id, 4)}`,
  category: (id) => `CAT-${pad(id, 3)}`,
};

/** "ITM-0007" | "itm7" | "7" -> 7 ; anything else -> null. */
export function parseCode(prefix, text) {
  const t = String(text ?? '').trim();
  const m = t.match(new RegExp(`^(?:${prefix})?[-\\s]*(?:\\d{4}-)?0*(\\d+)$`, 'i'));
  return m ? Number(m[1]) : null;
}

/** Display code for an audit "affected_entity" + record id. */
export function entityCode(entity, id, extra) {
  if (id == null) return '';
  switch (entity) {
    case 'Inventory Item': return codes.item(id);
    case 'Laboratory': return codes.lab(id);
    case 'User': return codes.user(id);
    case 'Borrowing Request': return codes.request(id, extra);
    case 'Maintenance Record': return codes.maintenance(id);
    case 'Inventory Transaction': return codes.movement(id);
    case 'Damage/Loss Record': return codes.damageLoss(id);
    case 'Category': return codes.category(id);
    default: return `#${id}`;
  }
}
