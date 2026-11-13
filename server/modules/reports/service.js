// -----------------------------------------------------------------------------
// reports/service.js — UC-013 Generate Reports (FR-027…FR-031).
// Each report returns { title, columns:[{key,label}], rows, summary } so the SAME
// definition drives the on-screen table, printing and CSV export.
// Archived inventory stays reportable (BR-010).
// -----------------------------------------------------------------------------
import { getDb } from '../../db/connection.js';
import { codes } from '../../lib/codes.js';
import { notFound } from '../../lib/errors.js';
import { labFilter } from '../../lib/scope.js';
import { dayBoundsUtc, todayLocal } from '../../lib/time.js';

const REPORTS = {
  inventory(ctx, q) {
    const s = labFilter(ctx, 'i.laboratory_id', Number(q.laboratoryId) || null);
    const rows = getDb().prepare(`
      SELECT i.item_id id, i.item_name item, c.name category, i.item_type itemType, i.quantity, i.unit_of_measurement unit, i.minimum_stock_level minimum,
             l.name laboratory, i."condition" "condition", i.status, i.location,
             CASE WHEN i.item_type='Equipment' THEN (SELECT COUNT(*) FROM Asset a WHERE a.item_id=i.item_id AND a.status='Available') ELSE i.quantity END available
      FROM Inventory_Item i JOIN Category c ON c.category_id=i.category_id JOIN Laboratory l ON l.laboratory_id=i.laboratory_id
      WHERE ${s.sql} ${q.includeArchived === '1' ? '' : "AND i.status='Active'"} ORDER BY l.name, i.item_name COLLATE NOCASE`).all(...s.params)
      .map((r) => ({ ...r, code: codes.item(r.id), stock: r.quantity <= 0 ? 'Out of stock' : r.quantity <= r.minimum ? 'Low stock' : 'OK', quantityText: `${r.quantity} ${r.unit}` }));
    return {
      title: 'Inventory report',
      columns: [['code', 'Item ID'], ['item', 'Item'], ['category', 'Category'], ['laboratory', 'Laboratory'], ['quantityText', 'Quantity'], ['available', 'Available'], ['minimum', 'Minimum'], ['condition', 'Condition'], ['stock', 'Stock'], ['status', 'Status'], ['location', 'Location']],
      rows, summary: [['Items', rows.length], ['Below minimum', rows.filter((r) => r.stock !== 'OK' && r.status === 'Active').length], ['Archived', rows.filter((r) => r.status === 'Archived').length]],
    };
  },
  borrowing(ctx, q) {
    const s = labFilter(ctx, 'r.laboratory_id', Number(q.laboratoryId) || null);
    const where = [s.sql], params = [...s.params];
    if (q.from) { where.push('r.request_date >= ?'); params.push(dayBoundsUtc(q.from).from); }
    if (q.to) { where.push('r.request_date < ?'); params.push(dayBoundsUtc(q.to).to); }
    if (q.status) { where.push('r.status = ?'); params.push(q.status); }
    const rows = getDb().prepare(`
      SELECT r.request_id id, r.request_date requestDate, rq.first_name || ' ' || rq.last_name borrower, l.name laboratory, i.item_name item,
             ri.requested_quantity quantity, i.unit_of_measurement unit, r.expected_return_date expectedReturn, r.status,
             (SELECT MIN(rl.release_date) FROM "Release" rl WHERE rl.request_id = r.request_id) dateBorrowed,
             (SELECT MAX(t.return_date) FROM "Return" t WHERE t.request_id = r.request_id) lastReturn
      FROM Borrowing_Request r JOIN Borrowing_Request_Item ri ON ri.request_id = r.request_id JOIN Inventory_Item i ON i.item_id = ri.item_id
      JOIN "User" rq ON rq.user_id = r.requester_id JOIN Laboratory l ON l.laboratory_id = r.laboratory_id
      WHERE ${where.join(' AND ')} ORDER BY r.request_id DESC, ri.request_item_id`).all(...params)
      .map((r) => ({ ...r, code: codes.request(r.id, r.requestDate), actualReturn: r.status === 'Returned' ? r.lastReturn : null, quantityText: `${r.quantity} ${r.unit}`, dateBorrowed: r.dateBorrowed }));
    return {
      title: 'Borrowing report',
      columns: [['code', 'Request'], ['borrower', 'Borrower'], ['laboratory', 'Laboratory'], ['item', 'Item'], ['quantityText', 'Quantity'], ['dateBorrowed', 'Date borrowed'], ['expectedReturn', 'Expected return'], ['actualReturn', 'Actual return'], ['status', 'Status']],
      rows, summary: [['Lines', rows.length], ['Requests', new Set(rows.map((r) => r.id)).size], ['Overdue', new Set(rows.filter((r) => r.status === 'Overdue').map((r) => r.id)).size]],
    };
  },
  equipment(ctx, q) {
    const s = labFilter(ctx, 'a.laboratory_id', Number(q.laboratoryId) || null);
    const rows = getDb().prepare(`
      SELECT a.asset_id id, a.asset_tag tag, i.item_name equipment, l.name laboratory, a."condition" "condition", a.status, a.serial_number serialNumber,
             COALESCE((SELECT m.maintenance_status FROM Maintenance_Record m WHERE m.asset_id=a.asset_id ORDER BY m.maintenance_id DESC LIMIT 1), 'None') maintenance
      FROM Asset a JOIN Inventory_Item i ON i.item_id=a.item_id JOIN Laboratory l ON l.laboratory_id=a.laboratory_id
      WHERE ${s.sql} ${q.status ? 'AND a.status = ?' : ''} ORDER BY l.name, i.item_name COLLATE NOCASE, a.asset_tag`).all(...s.params, ...(q.status ? [q.status] : []));
    return {
      title: 'Equipment report',
      columns: [['tag', 'Asset ID'], ['equipment', 'Equipment'], ['laboratory', 'Laboratory'], ['serialNumber', 'Serial'], ['condition', 'Condition'], ['status', 'Status'], ['maintenance', 'Maintenance']],
      rows, summary: [['Assets', rows.length], ['Available', rows.filter((r) => r.status === 'Available').length], ['Need attention', rows.filter((r) => ['Damaged', 'Under Maintenance', 'Under Inspection', 'Lost'].includes(r.status)).length]],
    };
  },
  movements(ctx, q) {
    const s = labFilter(ctx, 'i.laboratory_id', Number(q.laboratoryId) || null);
    const where = [s.sql], params = [...s.params];
    if (q.from) { where.push('t.transaction_date >= ?'); params.push(dayBoundsUtc(q.from).from); }
    if (q.to) { where.push('t.transaction_date < ?'); params.push(dayBoundsUtc(q.to).to); }
    if (['Stock-in', 'Stock-out', 'Adjustment', 'Transfer'].includes(q.type)) { where.push('t.transaction_type = ?'); params.push(q.type); }
    const rows = getDb().prepare(`
      SELECT t.transaction_id id, t.transaction_date date, t.transaction_type type, i.item_name item, t.quantity, i.unit_of_measurement unit, l.name laboratory,
             u.first_name || ' ' || u.last_name userName, t.reason, t.remarks, t.balance_after balanceAfter
      FROM Inventory_Transaction t JOIN Inventory_Item i ON i.item_id=t.item_id JOIN Laboratory l ON l.laboratory_id=i.laboratory_id JOIN "User" u ON u.user_id=t.user_id
      WHERE ${where.join(' AND ')} ORDER BY t.transaction_id DESC LIMIT 5000`).all(...params)
      .map((r) => ({ ...r, code: codes.movement(r.id), quantityText: `${r.quantity > 0 ? '+' : ''}${r.quantity} ${r.unit}` }));
    const sum = (t) => rows.filter((r) => r.type === t).reduce((a, r) => a + r.quantity, 0);
    return {
      title: 'Inventory movement report',
      columns: [['code', 'Movement'], ['date', 'Date'], ['type', 'Type'], ['item', 'Item'], ['quantityText', 'Quantity'], ['balanceAfter', 'Balance after'], ['laboratory', 'Laboratory'], ['userName', 'User'], ['reason', 'Reason']],
      rows, summary: [['Movements', rows.length], ['Stock-in (units)', sum('Stock-in')], ['Stock-out (units)', Math.abs(sum('Stock-out'))], ['Adjustments (net)', sum('Adjustment')]],
    };
  },
};

export function generate(ctx, type, query) {
  const fn = REPORTS[type];
  if (!fn) throw notFound('Report');
  const r = fn(ctx, query);
  return {
    ...r, type, generatedAt: new Date().toISOString(), today: todayLocal(),
    columns: r.columns.map(([key, label]) => ({ key, label })),
    summary: r.summary.map(([label, value]) => ({ label, value })),
    filters: { laboratoryId: query.laboratoryId || null, from: query.from || null, to: query.to || null },
  };
}
export const REPORT_TYPES = Object.keys(REPORTS);
