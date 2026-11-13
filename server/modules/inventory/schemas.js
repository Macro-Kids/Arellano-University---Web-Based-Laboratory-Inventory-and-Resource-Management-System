import { z, str, optStr, num, id, optId, optDate, oneOf, CONDITIONS, ITEM_TYPES, STOCK_OUT_REASONS } from '../../lib/validate.js';

const assetPrefix = z.preprocess((v) => (v === '' || v === undefined || v === null ? null : String(v).toUpperCase().trim()),
  z.string().regex(/^[A-Z0-9]{2,6}$/, 'Asset prefix must be 2–6 letters or numbers (e.g. MIC).').nullable());

const itemBase = {
  name: str('Item name', { max: 200 }),
  description: optStr('Description'),
  categoryId: id('Category'),
  unit: str('Unit of measurement', { max: 50 }),
  minimumStock: num('Minimum stock level', { min: 0, max: 1_000_000 }),
  condition: oneOf('Condition', CONDITIONS).default('Good'),
  location: str('Storage location', { max: 255 }),
  acquisitionDate: optDate('Acquisition date'),
  acquisitionSource: optStr('Acquisition source', { max: 255 }),
  remarks: optStr('Remarks'),
};
export const createItemSchema = z.object({
  ...itemBase,
  laboratoryId: id('Laboratory'),
  itemType: oneOf('Item type', ITEM_TYPES),
  quantity: num('Quantity', { min: 0, max: 1_000_000 }),
  assetPrefix,
});
export const updateItemSchema = z.object(itemBase);

export const movementSchema = z.object({
  type: oneOf('Movement type', ['Stock-in', 'Stock-out', 'Adjustment', 'Transfer']),
  quantity: num('Quantity', { positive: true, max: 1_000_000 }).optional(),      // in / out / transfer
  newQuantity: num('Physical count', { min: 0, max: 1_000_000 }).optional(),      // adjustment (physical count)
  expectedQuantity: num('Expected quantity', { min: 0 }).optional(),              // stale-data guard
  reason: optStr('Reason', { max: 255 }),                                          // stock-out category / adjustment reason
  source: optStr('Source', { max: 255 }),                                          // stock-in source
  remarks: optStr('Remarks'),
  targetLaboratoryId: optId('Destination laboratory'),
});
export const archiveSchema = z.object({ reason: optStr('Reason', { max: 500 }) });
export { STOCK_OUT_REASONS };
