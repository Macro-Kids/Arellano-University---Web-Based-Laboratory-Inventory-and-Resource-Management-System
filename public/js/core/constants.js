// constants.js — vocabularies shared with the server (SRS FR-009, FR-012, FR-013, FR-015).
export const CONDITIONS = ['Excellent', 'Good', 'Fair', 'Damaged', 'Non-functional'];
export const SERVICEABLE = ['Excellent', 'Good', 'Fair'];
export const ASSET_STATUSES = ['Available', 'In Use', 'Borrowed', 'Under Inspection', 'Under Maintenance', 'Damaged', 'Lost', 'Retired'];
export const REQUEST_STATUSES = ['Pending', 'Approved', 'Released', 'Overdue', 'Returned', 'Rejected', 'Cancelled'];
export const STOCK_OUT_REASONS = ['Consumption', 'Damage', 'Loss', 'Disposal', 'Other'];
export const ITEM_TYPES = [{ value: 'Equipment', label: 'Equipment — tracked unit by unit' }, { value: 'Consumable', label: 'Consumable / bulk supply — tracked by quantity' }];
