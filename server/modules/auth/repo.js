// auth/repo.js — data access: login lookup, sessions, own-profile updates.
import { getDb } from '../../db/connection.js';

const USER_SELECT = `
  SELECT u.user_id AS id, u.username, u.first_name AS firstName, u.last_name AS lastName, u.email, u.status,
         u.role_id AS roleId, r.role_name AS roleName, u.password_hash AS passwordHash
  FROM "User" u JOIN "Role" r ON r.role_id = u.role_id`;

export const findUserByIdentifier = (identifier) =>
  getDb().prepare(`${USER_SELECT} WHERE u.username = ? COLLATE NOCASE OR (u.email IS NOT NULL AND lower(u.email) = lower(?)) LIMIT 1`).get(identifier, identifier);
export const findUserById = (id) => getDb().prepare(`${USER_SELECT} WHERE u.user_id = ?`).get(id);
export const labIdsForUser = (userId) =>
  getDb().prepare('SELECT laboratory_id id FROM User_Laboratory WHERE user_id = ? ORDER BY laboratory_id').all(userId).map((r) => r.id);

export function createSession(s) {
  getDb().prepare(`INSERT INTO Session (session_id, user_id, csrf_token, created_at, expires_at, last_seen_at, ip_address, user_agent)
                   VALUES (@id,@userId,@csrfToken,@createdAt,@expiresAt,@createdAt,@ip,@userAgent)`).run(s);
}
export function findSession(id) {
  const db = getDb();
  const s = db.prepare(`SELECT session_id id, user_id userId, csrf_token csrfToken, expires_at expiresAt, last_seen_at lastSeenAt FROM Session WHERE session_id = ?`).get(id);
  if (!s) return null;
  const user = findUserById(s.userId);
  return user ? { session: s, user } : null;
}
export function touchSession(id, ttlHours) {
  const now = Date.now();
  getDb().prepare(`UPDATE Session SET last_seen_at = ?, expires_at = ? WHERE session_id = ? AND last_seen_at < ?`)
    .run(new Date(now).toISOString(), new Date(now + ttlHours * 3600e3).toISOString(), id, new Date(now - 60e3).toISOString());
}
export const deleteSession = (id) => getDb().prepare('DELETE FROM Session WHERE session_id = ?').run(id);
export const deleteUserSessions = (userId, exceptId = '') => getDb().prepare('DELETE FROM Session WHERE user_id = ? AND session_id <> ?').run(userId, exceptId);
export const purgeExpiredSessions = () => getDb().prepare('DELETE FROM Session WHERE expires_at <= ?').run(new Date().toISOString()).changes;

export const setPasswordHash = (userId, hash) =>
  getDb().prepare('UPDATE "User" SET password_hash = ?, updated_at = ? WHERE user_id = ?').run(hash, new Date().toISOString(), userId);
export const updateProfile = (userId, { firstName, lastName, email }) =>
  getDb().prepare('UPDATE "User" SET first_name = ?, last_name = ?, email = ?, updated_at = ? WHERE user_id = ?')
    .run(firstName, lastName, email, new Date().toISOString(), userId);
export const laboratoriesFor = (user) => user.isGlobal
  ? getDb().prepare('SELECT laboratory_id id, name, type, location, status FROM Laboratory ORDER BY name').all()
  : getDb().prepare(`SELECT l.laboratory_id id, l.name, l.type, l.location, l.status FROM Laboratory l
                     JOIN User_Laboratory ul ON ul.laboratory_id = l.laboratory_id WHERE ul.user_id = ? ORDER BY l.name`).all(user.id);
export const demoAccounts = () => getDb().prepare(`
  SELECT u.username, u.first_name || ' ' || u.last_name AS name, r.role_name AS roleName, u.status
  FROM "User" u JOIN "Role" r ON r.role_id = u.role_id WHERE u.username <> 'system' AND u.status = 'Active'
  ORDER BY CASE r.role_name WHEN 'Laboratory Coordinator' THEN 1 WHEN 'System Administrator' THEN 2 WHEN 'Laboratory Staff' THEN 3 ELSE 4 END, u.user_id`).all();
