// -----------------------------------------------------------------------------
// validate.js — zod helpers that produce friendly, field-level messages (UR-002).
//   const data = parse(schema, req.body);   // throws AppError(VALIDATION_ERROR)
// -----------------------------------------------------------------------------
import { z } from 'zod';
import { validationError } from './errors.js';

export { z };

export function parse(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw validationError(fields);
}

// ---- reusable field builders -------------------------------------------------
export const str = (label, { min = 1, max = 255 } = {}) =>
  z.string({ error: `${label} is required.` }).trim()
    .min(min, min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

/** Optional free-text. Empty string / null / undefined all become null. */
export const optStr = (label, { max = 2000 } = {}) =>
  z.preprocess((v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v),
    z.string({ error: `${label} must be text.` }).trim().max(max, `${label} must be ${max} characters or fewer.`).nullable());

const toNumber = (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);
export const num = (label, { min, max, int = false, positive = false } = {}) => {
  let s = z.number({ error: `${label} must be a number.` }).finite(`${label} must be a number.`);
  if (int) s = s.int(`${label} must be a whole number.`);
  if (positive) s = s.gt(0, `${label} must be greater than zero.`);
  if (min !== undefined) s = s.min(min, `${label} cannot be less than ${min}.`);
  if (max !== undefined) s = s.max(max, `${label} cannot be more than ${max}.`);
  return z.preprocess(toNumber, s);
};
export const id = (label) => num(label, { int: true, positive: true });
export const optId = (label) =>
  z.preprocess((v) => (v === '' || v === undefined || v === null ? null : toNumber(v)), num(label, { int: true, positive: true }).nullable());

export const dateStr = (label) =>
  z.string({ error: `${label} is required.` }).regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a valid date.`)
    .refine((v) => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; }, `${label} must be a valid date.`);
export const optDate = (label) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), dateStr(label).nullable());

export const oneOf = (label, values) =>
  z.enum(values, { error: `${label} must be one of: ${values.join(', ')}.` });

// ---- shared vocabularies (SRS) -------------------------------------------------
export const ASSET_STATUSES = ['Available', 'In Use', 'Borrowed', 'Under Inspection', 'Under Maintenance', 'Damaged', 'Lost', 'Retired']; // FR-012
export const CONDITIONS = ['Excellent', 'Good', 'Fair', 'Damaged', 'Non-functional'];                                                     // FR-013
export const REQUEST_STATUSES = ['Pending', 'Approved', 'Rejected', 'Released', 'Returned', 'Overdue', 'Cancelled'];                      // FR-015
export const ITEM_TYPES = ['Equipment', 'Consumable'];
export const STOCK_OUT_REASONS = ['Consumption', 'Damage', 'Loss', 'Disposal', 'Other'];                                                 // FR-009 (Transfer is its own movement type)
