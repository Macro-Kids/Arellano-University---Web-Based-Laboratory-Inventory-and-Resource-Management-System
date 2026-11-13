// assets/repo.js — data access for Asset (+ read-only history queries for the detail view).
import { getDb } from '../../db/connection.js';

const SELECT = `
  SELECT a.asset_id AS id, a.asset_tag AS tag, a.item_id AS itemId, i.item_name AS itemName, i.unit_of_measurement AS unit,
         a.laboratory_id AS laboratoryId, l.name AS laboratoryName, a.serial_number AS serialNumber,
         a.status, a."condition" AS "condition", a.remarks, a.created_at AS createdAt, a.updated_at AS updatedAt
  FROM Asset a JOIN Inventory_Item i ON i.item_id = a.item_id JOIN Laboratory l ON l.laboratory_id = a.laboratory_id`;

export function search({ scopeSql, scopeParams, q, itemId, status, condition, sort, dir, limit, offset }) {
  const db = getDb(), where = [scopeSql], params = [...scopeParams];
  if (q) { where.push(`(a.asset_tag LIKE ? ESCAPE '\\' OR IFNULL(a.serial_number,'') LIKE ? ESCAPE '\\' OR i.item_name LIKE ? ESCAPE '\\' OR l.name LIKE ? ESCAPE '\\' OR a.status LIKE ? ESCAPE '\\' OR IFNULL(a.remarks,'') LIKE ? ESCAPE '\\')`); params.push(q, q, q, q, q, q); }
  if (itemId) { where.push('a.item_id = ?'); params.push(itemId); }
  if (status) { where.push('a.status = ?'); params.push(status); }
  if (condition) { where.push('a."condition" = ?'); params.push(condition); }
  const w = where.join(' AND ');
  const order = { tag: 'a.asset_tag COLLATE NOCASE', item: 'i.item_name COLLATE NOCASE', status: 'a.status', condition: 'a."condition"', added: 'a.created_at' }[sort] || 'a.asset_tag COLLATE NOCASE';
  const total = db.prepare(`SELECT COUNT(*) n FROM Asset a JOIN Inventory_Item i ON i.item_id = a.item_id JOIN Laboratory l ON l.laboratory_id = a.laboratory_id WHERE ${w}`).get(...params).n;
  const rows = db.prepare(`${SELECT} WHERE ${w} ORDER BY ${order} ${dir === 'desc' ? 'DESC' : 'ASC'}, a.asset_id LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, rows };
}
export const getById = (id) => getDb().prepare(`${SELECT} WHERE a.asset_id = ?`).get(id);
export const tagTaken = (tag, exceptId = 0) => !!getDb().prepare('SELECT 1 FROM Asset WHERE asset_tag = ? COLLATE NOCASE AND asset_id <> ?').get(tag, exceptId);

/** Next free number for PREFIX-### (global across the Asset table because tags are globally unique). */
export function nextTagNumber(prefix) {
  const rows = getDb().prepare(`SELECT asset_tag t FROM Asset WHERE asset_tag LIKE ? ESCAPE '\\'`).all(`${prefix.replace(/[\\%_]/g, '\\$&')}-%`);
  let max = 0;
  for (const { t } of rows) { const m = t.match(/-(\d+)$/); if (m) max = Math.max(max, Number(m[1])); }
  return max + 1;
}
export function insert(a) {
  return getDb().prepare(`INSERT INTO Asset (item_id, laboratory_id, asset_tag, serial_number, status, "condition", remarks, created_at, updated_at)
    VALUES (@itemId,@laboratoryId,@tag,@serialNumber,@status,@condition,@remarks,@now,@now)`).run(a).lastInsertRowid;
}
export const updateMeta = (id, a) => getDb().prepare('UPDATE Asset SET serial_number=@serialNumber, remarks=@remarks, updated_at=@now WHERE asset_id=@id').run({ ...a, id });
export const updateState = (id, status, condition, now) => getDb().prepare('UPDATE Asset SET status = ?, "condition" = ?, updated_at = ? WHERE asset_id = ?').run(status, condition, now, id);
export const openMaintenanceFor = (assetId) => getDb().prepare(`SELECT maintenance_id id, maintenance_status status FROM Maintenance_Record WHERE asset_id = ? AND maintenance_status <> 'Completed' LIMIT 1`).get(assetId);
export const maintenanceFor = (assetId) => getDb().prepare(`SELECT maintenance_id id, reported_issue reportedIssue, date_reported dateReported, maintenance_action action, responsible_person person,
  date_completed dateCompleted, maintenance_status status FROM Maintenance_Record WHERE asset_id = ? ORDER BY maintenance_id DESC`).all(assetId);
export const damageFor = (assetId) => getDb().prepare(`SELECT d.damage_loss_id id, d.record_type recordType, d.date_recorded dateRecorded, d.description, d.current_condition currentCondition,
  d.action_taken actionTaken, u.first_name || ' ' || u.last_name reportedBy FROM Damage_Loss_Record d JOIN "User" u ON u.user_id = d.reported_by WHERE d.asset_id = ? ORDER BY d.damage_loss_id DESC`).all(assetId);
export const borrowingHistory = (assetId) => getDb().prepare(`
  SELECT r.request_id requestId, r.request_date requestDate, r.status requestStatus, r.expected_return_date expectedReturn, rel.release_date releaseDate,
         u.first_name || ' ' || u.last_name borrower
  FROM Release_Item ri JOIN "Release" rel ON rel.release_id = ri.release_id JOIN Borrowing_Request r ON r.request_id = rel.request_id
  JOIN "User" u ON u.user_id = r.requester_id WHERE ri.asset_id = ? ORDER BY rel.release_id DESC`).all(assetId);
export const heldBy = (assetId) => getDb().prepare(`
  SELECT r.request_id requestId, r.request_date requestDate, r.expected_return_date expectedReturn, r.status requestStatus, rel.release_date releaseDate,
         u.first_name || ' ' || u.last_name borrower
  FROM Release_Item ri JOIN "Release" rel ON rel.release_id = ri.release_id JOIN Borrowing_Request r ON r.request_id = rel.request_id
  JOIN "User" u ON u.user_id = r.requester_id
  WHERE ri.asset_id = ? AND r.status IN ('Released','Overdue')
    AND NOT EXISTS (SELECT 1 FROM Return_Item rt JOIN "Return" t ON t.return_id = rt.return_id
                    WHERE t.request_id = r.request_id AND rt.asset_id = ri.asset_id AND (rt.quantity_returned > 0 OR rt.missing_quantity > 0))
  ORDER BY rel.release_id DESC LIMIT 1`).get(assetId);
