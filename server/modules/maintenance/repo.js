// maintenance/repo.js — data access for Maintenance_Record.
import { getDb } from '../../db/connection.js';

const FROM = `FROM Maintenance_Record m JOIN Asset a ON a.asset_id = m.asset_id JOIN Inventory_Item i ON i.item_id = a.item_id JOIN Laboratory l ON l.laboratory_id = a.laboratory_id`;
const COLS = `m.maintenance_id id, m.asset_id assetId, a.asset_tag assetTag, i.item_name itemName, a.status assetStatus, a."condition" assetCondition,
  a.laboratory_id laboratoryId, l.name laboratoryName, m.reported_issue reportedIssue, m.date_reported dateReported,
  m.maintenance_action maintenanceAction, m.responsible_person responsiblePerson, m.date_completed dateCompleted, m.maintenance_status status, m.remarks`;

export function query({ where, params, limit, offset }) {
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) n ${FROM} WHERE ${where}`).get(...params).n;
  const rows = db.prepare(`SELECT ${COLS} ${FROM} WHERE ${where} ORDER BY CASE m.maintenance_status WHEN 'Completed' THEN 1 ELSE 0 END, m.maintenance_id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, rows };
}
export const getById = (id) => getDb().prepare(`SELECT ${COLS} ${FROM} WHERE m.maintenance_id = ?`).get(id);
export const statusCounts = (where, params) => getDb().prepare(`SELECT m.maintenance_status s, COUNT(*) n ${FROM} WHERE ${where} GROUP BY 1`).all(...params).reduce((o, r) => ({ ...o, [r.s]: r.n }), {});
export const insert = (m) => getDb().prepare(`INSERT INTO Maintenance_Record (asset_id, reported_issue, date_reported, maintenance_action, responsible_person, maintenance_status, remarks)
  VALUES (@assetId,@reportedIssue,@now,@maintenanceAction,@responsiblePerson,'Open',@remarks)`).run(m).lastInsertRowid;
export const updateProgress = (id, m) => getDb().prepare(`UPDATE Maintenance_Record SET maintenance_action=@maintenanceAction, responsible_person=@responsiblePerson, maintenance_status=@status, remarks=@remarks WHERE maintenance_id=@id`).run({ ...m, id });
export const complete = (id, m) => getDb().prepare(`UPDATE Maintenance_Record SET maintenance_action=@maintenanceAction, remarks=@remarks, maintenance_status='Completed', date_completed=@now WHERE maintenance_id=@id`).run({ ...m, id });
