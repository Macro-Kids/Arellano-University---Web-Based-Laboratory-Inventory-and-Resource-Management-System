// damage/repo.js — data access for Damage_Loss_Record.
import { getDb } from '../../db/connection.js';

export function insert(r) {
  return getDb().prepare(`INSERT INTO Damage_Loss_Record (item_id, asset_id, record_type, date_recorded, description, reported_by, current_condition, action_taken, remarks, quantity)
    VALUES (@itemId,@assetId,@recordType,@now,@description,@userId,@currentCondition,@actionTaken,@remarks,@quantity)`).run(r).lastInsertRowid;
}
export function query({ where, params, limit, offset }) {
  const db = getDb();
  const from = `FROM Damage_Loss_Record d JOIN Inventory_Item i ON i.item_id = d.item_id JOIN Laboratory l ON l.laboratory_id = i.laboratory_id
                LEFT JOIN Asset a ON a.asset_id = d.asset_id JOIN "User" u ON u.user_id = d.reported_by WHERE ${where}`;
  const total = db.prepare(`SELECT COUNT(*) n ${from}`).get(...params).n;
  const rows = db.prepare(`SELECT d.damage_loss_id id, d.record_type recordType, d.date_recorded dateRecorded, d.description, d.current_condition currentCondition,
      d.action_taken actionTaken, d.remarks, d.quantity, d.item_id itemId, i.item_name itemName, i.unit_of_measurement unit, i.laboratory_id laboratoryId, l.name laboratoryName,
      d.asset_id assetId, a.asset_tag assetTag, u.first_name || ' ' || u.last_name reportedBy ${from} ORDER BY d.damage_loss_id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, rows };
}
