import { z, str, optStr, id, oneOf, ASSET_STATUSES, CONDITIONS } from '../../lib/validate.js';

const tag = z.preprocess((v) => (v === '' || v === undefined || v === null ? undefined : String(v).trim().toUpperCase()),
  z.string().regex(/^[A-Z0-9][A-Z0-9._-]{1,29}$/, 'Asset ID may use letters, numbers, dots, dashes (2–30 characters).').optional());

export const registerAssetSchema = z.object({
  itemId: id('Equipment item'), assetTag: tag, serialNumber: optStr('Serial number', { max: 100 }),
  condition: oneOf('Condition', CONDITIONS).default('Good'), remarks: optStr('Remarks'),
});
export const updateAssetSchema = z.object({ serialNumber: optStr('Serial number', { max: 100 }), remarks: optStr('Remarks') });
export const stateSchema = z.object({
  status: oneOf('Status', ASSET_STATUSES).optional(),
  condition: oneOf('Condition', CONDITIONS).optional(),
  reason: str('Reason', { min: 3, max: 500 }),
});
