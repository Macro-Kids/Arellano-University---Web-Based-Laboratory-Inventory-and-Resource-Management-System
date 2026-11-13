// -----------------------------------------------------------------------------
// auth.js — session loading + the guards routes use.
//   loadSession          : fills req.ctx.user when a valid session cookie is present
//   requireAuth          : 401 unless signed in
//   requirePermission(p) : 403 unless the role has permission p   (server-side RBAC, SR-002)
//   csrfAndOrigin        : blocks cross-site state changes          (SR-003)
// -----------------------------------------------------------------------------
import crypto from 'node:crypto';
import { config } from '../config.js';
import { unauthenticated, forbidden } from '../lib/errors.js';
import { permissionsFor, isGlobalRole } from '../modules/auth/permissions.js';
import * as authRepo from '../modules/auth/repo.js';

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Turn a DB user row (+ lab ids) into the object stored at ctx.user. */
export function buildUser(row) {
  const labIds = authRepo.labIdsForUser(row.id);
  return {
    id: row.id, username: row.username, firstName: row.firstName, lastName: row.lastName,
    name: `${row.firstName} ${row.lastName}`, email: row.email, status: row.status,
    roleId: row.roleId, roleName: row.roleName,
    permissions: permissionsFor(row.roleName), isGlobal: isGlobalRole(row.roleName),
    labIds,
  };
}

export function loadSession(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[config.session.cookieName];
  if (!token) return next();
  const found = authRepo.findSession(hashToken(token));
  if (!found) return next();
  const { session, user } = found;
  if (session.expiresAt <= new Date().toISOString() || user.status !== 'Active') {
    authRepo.deleteSession(session.id); // expired or deactivated account (RA-002)
    return next();
  }
  authRepo.touchSession(session.id, config.session.ttlHours);
  req.ctx.sessionId = session.id;
  req.ctx.csrfToken = session.csrfToken;
  req.ctx.user = buildUser(user);
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.ctx.user) return next(unauthenticated());
  next();
}
export const requirePermission = (...permissions) => (req, _res, next) => {
  if (!req.ctx.user) return next(unauthenticated());
  if (!permissions.some((p) => req.ctx.user.permissions.has(p))) return next(forbidden());
  next();
};

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
export function csrfAndOrigin(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  // 1. Same-origin check: if the browser says where the request came from, it must be us.
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return next(forbidden('Cross-site request blocked.')); }
    catch { return next(forbidden('Cross-site request blocked.')); }
  }
  // 2. CSRF token (double-submit style, token bound to the session). Not needed before sign-in.
  if (req.ctx.user) {
    const sent = req.headers['x-csrf-token'];
    if (!sent || sent !== req.ctx.csrfToken) return next(forbidden('Your session token is missing or invalid. Please reload the page.'));
  }
  next();
}
