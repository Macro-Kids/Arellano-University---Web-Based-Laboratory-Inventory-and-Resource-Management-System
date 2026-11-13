// -----------------------------------------------------------------------------
// bootstrap.js — idempotent first-run setup. Safe to run on every start.
//   1. the internal "system" account (attributes automatic actions in the audit log)
//   2. default categories from SRS FR-007
//   3. the first administrator (only when no real users exist)
//   4. demo data (dev only, see config.seedDemo)
// -----------------------------------------------------------------------------
import { config } from '../config.js';
import { createLogger } from '../lib/logger.js';
import { hashPasswordSync, generatePassword, passwordProblem } from '../lib/password.js';

const log = createLogger('bootstrap');

export const DEFAULT_CATEGORIES = [
  // Science (SRS FR-007)
  ['Laboratory Equipment', 'Reusable scientific instruments and devices'],
  ['Glassware', 'Glass laboratory vessels and accessories'],
  ['Chemicals', 'Reagents and laboratory chemicals'],
  ['Measuring Instruments', 'Scales, thermometers, meters and gauges'],
  ['Specimens', 'Biological and mineral specimens'],
  ['Safety Equipment', 'Protective equipment for students and staff'],
  ['Consumables', 'Supplies used up during laboratory activities'],
  // TLE (SRS FR-007)
  ['Hand Tools', 'Manual tools'],
  ['Power Tools', 'Electrically powered tools'],
  ['Sewing Equipment', 'Sewing machines and textile equipment'],
  ['Cooking Equipment', 'Kitchen and food-preparation equipment'],
  ['Electrical Components', 'Electronic parts and components'],
  ['Raw Materials', 'Fabric, thread, wood and other materials'],
];

export function bootstrap(db) {
  const now = new Date().toISOString();
  const roleId = (name) => db.prepare('SELECT role_id id FROM "Role" WHERE role_name = ?').get(name)?.id;

  if (!db.prepare('SELECT 1 FROM "User" WHERE username = ?').get('system')) {
    db.prepare(`INSERT INTO "User" (role_id, username, password_hash, first_name, last_name, email, status, created_at, updated_at)
                VALUES (?, 'system', '!disabled', 'System', 'Process', NULL, 'Inactive', ?, ?)`).run(roleId('System'), now, now);
    log.info('created internal system account');
  }

  const insCat = db.prepare('INSERT OR IGNORE INTO Category (name, description, status) VALUES (?,?,\'Active\')');
  for (const [name, desc] of DEFAULT_CATEGORIES) insCat.run(name, desc);

  const realUsers = db.prepare(`SELECT COUNT(*) n FROM "User" WHERE username <> 'system'`).get().n;
  let adminCredentials = null;
  if (realUsers === 0 && !config.seedDemo) {
    let password = config.adminInitialPassword;
    const generated = !password;
    if (generated) password = generatePassword();
    else if (passwordProblem(password)) throw new Error(`ADMIN_INITIAL_PASSWORD rejected: ${passwordProblem(password)}`);
    db.prepare(`INSERT INTO "User" (role_id, username, password_hash, first_name, last_name, email, status, created_at, updated_at)
                VALUES (?,?,?,?,?,?, 'Active', ?, ?)`)
      .run(roleId('System Administrator'), config.adminUsername, hashPasswordSync(password), 'System', 'Administrator', null, now, now);
    adminCredentials = { username: config.adminUsername, password, generated };
    log.warn('first administrator created — sign in and change the password immediately', { username: config.adminUsername, ...(generated ? { temporaryPassword: password } : {}) });
  }
  return { adminCredentials };
}
