// users/repo.js — data access for User, Role, User_Laboratory.
import { getDb } from '../../db/connection.js';

const SELECT = `
  SELECT u.user_id AS id, u.username, u.first_name AS firstName, u.last_name AS lastName,
         u.first_name || ' ' || u.last_name AS name, u.email, u.status, u.role_id AS roleId, r.role_name AS roleName,
         u.created_at AS createdAt, u.updated_at AS updatedAt
  FROM "User" u JOIN "Role" r ON r.role_id = u.role_id`;

export function labsOf(userId) {
  return getDb().prepare(`SELECT l.laboratory_id id, l.name FROM User_Laboratory ul JOIN Laboratory l ON l.laboratory_id = ul.laboratory_id
                          WHERE ul.user_id = ? ORDER BY l.name`).all(userId);
}
const attachLabs = (u) => (u ? { ...u, laboratories: labsOf(u.id) } : u);

export function list({ search, roleId, status, limit, offset }) {
  const db = getDb(), where = [`u.username <> 'system'`], params = [];
  if (search) { where.push(`(u.username LIKE ? ESCAPE '\\' OR u.first_name || ' ' || u.last_name LIKE ? ESCAPE '\\' OR IFNULL(u.email,'') LIKE ? ESCAPE '\\')`); params.push(search, search, search); }
  if (roleId) { where.push('u.role_id = ?'); params.push(roleId); }
  if (status) { where.push('u.status = ?'); params.push(status); }
  const w = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) n FROM "User" u WHERE ${w}`).get(...params).n;
  const rows = db.prepare(`${SELECT} WHERE ${w} ORDER BY u.status, u.last_name, u.first_name LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, rows: rows.map(attachLabs) };
}
export const getById = (id) => attachLabs(getDb().prepare(`${SELECT} WHERE u.user_id = ? AND u.username <> 'system'`).get(id));
export const usernameTaken = (username, exceptId = 0) =>
  !!getDb().prepare('SELECT 1 FROM "User" WHERE username = ? COLLATE NOCASE AND user_id <> ?').get(username, exceptId);
export const roles = () => getDb().prepare(`SELECT role_id id, role_name name, description FROM "Role" WHERE role_name <> 'System' ORDER BY role_id`).all();
export const roleById = (id) => getDb().prepare('SELECT role_id id, role_name name FROM "Role" WHERE role_id = ?').get(id);

export function insert(u) {
  return getDb().prepare(`INSERT INTO "User" (role_id, username, password_hash, first_name, last_name, email, status, created_at, updated_at)
                          VALUES (@roleId,@username,@passwordHash,@firstName,@lastName,@email,'Active',@now,@now)`).run(u).lastInsertRowid;
}
export function update(id, u) {
  getDb().prepare(`UPDATE "User" SET role_id=@roleId, first_name=@firstName, last_name=@lastName, email=@email, updated_at=@now WHERE user_id=@id`).run({ ...u, id });
}
export const setStatus = (id, status, now) => getDb().prepare('UPDATE "User" SET status = ?, updated_at = ? WHERE user_id = ?').run(status, now, id);
export function setLabs(userId, labIds) {
  const db = getDb();
  db.prepare('DELETE FROM User_Laboratory WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT INTO User_Laboratory (user_id, laboratory_id) VALUES (?,?)');
  for (const id of labIds) ins.run(userId, id);
}
export const existingLabIds = (ids) =>
  ids.length ? getDb().prepare(`SELECT laboratory_id id FROM Laboratory WHERE laboratory_id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((r) => r.id) : [];
export const activeAdminCount = () =>
  getDb().prepare(`SELECT COUNT(*) n FROM "User" u JOIN "Role" r ON r.role_id = u.role_id WHERE r.role_name = 'System Administrator' AND u.status = 'Active'`).get().n;
/** Active users who can be named as a requester (coordinator/staff creating a request on someone's behalf). */
export function requesters(labId) {
  return getDb().prepare(`
    SELECT u.user_id id, u.first_name || ' ' || u.last_name name, r.role_name roleName
    FROM "User" u JOIN "Role" r ON r.role_id = u.role_id
    JOIN User_Laboratory ul ON ul.user_id = u.user_id AND ul.laboratory_id = ?
    WHERE u.status = 'Active' AND r.role_name IN ('Teacher','Laboratory Staff','Laboratory Coordinator')
    ORDER BY u.last_name, u.first_name`).all(labId);
}
