import { z, str, optStr, num, optId, oneOf, CONDITIONS } from '../../lib/validate.js';
export const damageSchema = z.object({
  recordType: oneOf('Record type', ['Damage', 'Loss']),
  assetId: optId('Asset'), itemId: optId('Item'),
  quantity: num('Quantity', { positive: true, max: 1_000_000 }).default(1),
  description: str('Description', { min: 3, max: 2000 }),
  currentCondition: oneOf('Current condition', CONDITIONS).optional(),
  actionTaken: optStr('Action taken'), remarks: optStr('Remarks'),
});
