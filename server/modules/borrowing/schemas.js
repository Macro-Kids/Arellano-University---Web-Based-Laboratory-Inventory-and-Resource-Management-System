import { z, str, optStr, num, id, optId, dateStr, optDate, oneOf, CONDITIONS } from '../../lib/validate.js';

export const createSchema = z.object({
  requesterId: optId('Requester'),
  laboratoryId: id('Laboratory'),
  purpose: str('Purpose', { min: 3, max: 1000 }),
  expectedReturnDate: dateStr('Expected return date'),
  remarks: optStr('Remarks'),
  items: z.array(z.object({
    itemId: id('Item'), quantity: num('Quantity', { positive: true, max: 100_000 }), remarks: optStr('Item remarks', { max: 500 }),
  }), { error: 'Add at least one item.' }).min(1, 'Add at least one item.').max(40, 'A request can contain at most 40 different items.'),
});
export const decisionSchema = z.object({ reason: optStr('Reason', { max: 500 }) });
export const rejectSchema = z.object({ reason: str('Reason for rejection', { min: 3, max: 500 }) });
export const releaseSchema = z.object({
  remarks: optStr('Remarks'),
  items: z.array(z.object({
    requestItemId: id('Request item'),
    quantity: num('Quantity', { min: 0 }).optional(),         // bulk items
    assetIds: z.array(id('Asset')).optional(),                // equipment
  })).min(1, 'Nothing to release.'),
});
export const returnSchema = z.object({
  returnDate: optDate('Return date'), remarks: optStr('Remarks'),
  items: z.array(z.object({
    itemId: id('Item'), assetId: optId('Asset'),
    returned: num('Returned quantity', { min: 0 }).default(0),
    damaged: num('Damaged quantity', { min: 0 }).default(0),
    missing: num('Missing quantity', { min: 0 }).default(0),
    condition: oneOf('Condition', CONDITIONS).optional(), remarks: optStr('Remarks', { max: 500 }),
  })).min(1, 'Nothing to return.'),
});
