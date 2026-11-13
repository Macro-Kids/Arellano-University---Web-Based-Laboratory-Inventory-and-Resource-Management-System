// audit/repo.js — data access for Audit_Log (insert + queries). Never UPDATE/DELETE (DB triggers forbid it).
import { getDb } from '../../db/connection.js';

export function insertAudit(row) {
  return getDb().prepare(`
    INSERT INTO Audit_Log (user_id, "timestamp", action, affected_entity, record_id, previous_value, new_value, reason, laboratory_id)
    VALUES (@userId, @timestamp, @action, @entity, @recordId, @previous, @next, @reason, @laboratoryId)`).run(row).lastInsertRowid;
}

const SELECT = `
  SELECT a.audit_id AS id, a."timestamp" AS timestamp, a.action, a.affected_entity AS entity, a.record_id AS recordId,
         a.previous_value AS previous, a.new_value AS next, a.reason, a.laboratory_id AS laboratoryId,
         l.name AS laboratoryName, br.request_date AS requestDate, a.user_id AS userId,
         u.first_name || ' ' || u.last_name AS userName, u.username AS username
  FROM Audit_Log a
  JOIN "User" u ON u.user_id = a.user_id
  LEFT JOIN Laboratory l ON l.laboratory_id = a.laboratory_id
  LEFT JOIN Borrowing_Request br ON a.affected_entity = 'Borrowing Request' AND br.request_id = a.record_id`;

export function queryAudit({ where, params, limit, offset }) {
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) n FROM Audit_Log a JOIN "User" u ON u.user_id = a.user_id WHERE ${where}`).get(...params).n;
  const rows = db.prepare(`${SELECT} WHERE ${where} ORDER BY a.audit_id DESC ${limit ? 'LIMIT ? OFFSET ?' : ''}`)
    .all(...params, ...(limit ? [limit, offset] : []));
  return { total, rows };
}
export function auditForRecord(entity, recordId, limit = 50) {
  return getDb().prepare(`${SELECT} WHERE a.affected_entity = ? AND a.record_id = ? ORDER BY a.audit_id DESC LIMIT ?`).all(entity, recordId, limit);
}
export const auditFacets = () => ({
  entities: getDb().prepare('SELECT DISTINCT affected_entity v FROM Audit_Log ORDER BY 1').all().map((r) => r.v),
  actions: getDb().prepare('SELECT DISTINCT action v FROM Audit_Log ORDER BY 1').all().map((r) => r.v),
});
export const systemUserId = () => getDb().prepare(`SELECT user_id id FROM "User" WHERE username = 'system'`).get()?.id;
