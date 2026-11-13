// -----------------------------------------------------------------------------
// auth/service.js — UC-001 Authenticate User (FR-001, SR-001).
// Passwords are verified with scrypt; sessions are random 256-bit tokens whose
// SHA-256 hash is stored server-side; failed attempts are throttled.
// -----------------------------------------------------------------------------
import crypto from 'node:crypto';
import { config } from '../../config.js';
import { createLogger } from '../../lib/logger.js';
import { unauthenticated, forbidden, tooMany, validationError } from '../../lib/errors.js';
import { verifyPassword, hashPassword, passwordProblem } from '../../lib/password.js';
import { FailureThrottle } from '../../lib/throttle.js';
import { nowIso } from '../../lib/time.js';
import { hashToken } from '../../middleware/auth.js';
import { recordAudit } from '../audit/record.js';
import { inTransaction } from '../../db/connection.js';
import * as repo from './repo.js';

const log = createLogger('auth');
export const throttle = new FailureThrottle(config.login.maxFailures, config.login.windowMinutes * 60e3);
// Verified against when the username does not exist, so response time does not reveal valid usernames.
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export function mePayload(user, csrfToken) {
  return {
    user: {
      id: user.id, username: user.username, name: user.name, firstName: user.firstName, lastName: user.lastName,
      email: user.email, roleName: user.roleName, isGlobal: user.isGlobal,
      permissions: [...user.permissions].sort(),
      laboratories: repo.laboratoriesFor(user),
    },
    csrfToken,
  };
}

export async function login(ctx, { identifier, password }) {
  const key = `${ctx.ip}|${identifier.toLowerCase()}`;
  const wait = throttle.blockedFor(key);
  if (wait) {
    log.warn('login blocked by throttle', { identifier, ip: ctx.ip, wait });
    throw tooMany(`Too many failed sign-in attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`, wait);
  }
  const row = repo.findUserByIdentifier(identifier);
  const passwordOk = await verifyPassword(password, row?.passwordHash ?? DUMMY_HASH);
  const eligible = row && row.roleName !== 'System' && passwordOk;
  if (!eligible) {
    throttle.fail(key);
    if (row && row.roleName !== 'System') recordAudit(ctx, { userId: row.id, action: 'Login failed', entity: 'User', recordId: row.id, reason: 'Incorrect password' });
    log.info('login failed', { identifier, ip: ctx.ip });
    throw unauthenticated('Incorrect username or password.');
  }
  if (row.status !== 'Active') {
    log.info('login refused: inactive account', { username: row.username });
    throw forbidden('This account has been deactivated. Please contact the system administrator.');
  }
  throttle.reset(key);

  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const created = nowIso();
  inTransaction(() => {
    repo.purgeExpiredSessions();
    repo.createSession({
      id: hashToken(token), userId: row.id, csrfToken, createdAt: created,
      expiresAt: new Date(Date.now() + config.session.ttlHours * 3600e3).toISOString(), ip: ctx.ip, userAgent: ctx.userAgent.slice(0, 200),
    });
    recordAudit(ctx, { userId: row.id, action: 'Login', entity: 'User', recordId: row.id });
  });
  log.info('login ok', { username: row.username, role: row.roleName });
  return { token, csrfToken, userId: row.id };
}

export function logout(ctx) {
  inTransaction(() => {
    recordAudit(ctx, { action: 'Logout', entity: 'User', recordId: ctx.user.id });
    repo.deleteSession(ctx.sessionId);
  });
}

export function updateOwnProfile(ctx, input) {
  return inTransaction(() => {
    const before = repo.findUserById(ctx.user.id);
    repo.updateProfile(ctx.user.id, input);
    recordAudit(ctx, {
      action: 'Profile updated', entity: 'User', recordId: ctx.user.id,
      previous: { firstName: before.firstName, lastName: before.lastName, email: before.email },
      next: input,
    });
    return repo.findUserById(ctx.user.id);
  });
}

export async function changePassword(ctx, { currentPassword, newPassword }) {
  const row = repo.findUserById(ctx.user.id);
  if (!(await verifyPassword(currentPassword, row.passwordHash))) throw validationError({ currentPassword: 'Current password is incorrect.' });
  const problem = passwordProblem(newPassword);
  if (problem) throw validationError({ newPassword: problem });
  if (newPassword === currentPassword) throw validationError({ newPassword: 'Choose a password different from the current one.' });
  const hash = await hashPassword(newPassword);
  inTransaction(() => {
    repo.setPasswordHash(ctx.user.id, hash);
    repo.deleteUserSessions(ctx.user.id, ctx.sessionId); // sign out other devices
    recordAudit(ctx, { action: 'Password changed', entity: 'User', recordId: ctx.user.id });
  });
}
