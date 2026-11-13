// -----------------------------------------------------------------------------
// context.js — assigns every request an id + ctx, and logs one line per request:
//   GET /api/inventory 200 12ms user=msantos rid=ab12cd34
// The same rid is returned in the X-Request-Id header and inside every error
// body, so "it broke at 10:42" becomes a one-grep investigation in logs/app.log.
// -----------------------------------------------------------------------------
import crypto from 'node:crypto';
import { createLogger } from '../lib/logger.js';

const log = createLogger('http');

export function requestContext(req, res, next) {
  const requestId = (req.headers['x-request-id'] && String(req.headers['x-request-id']).slice(0, 40).replace(/[^\w-]/g, '')) || crypto.randomBytes(4).toString('hex');
  req.ctx = { requestId, ip: req.ip, user: null, sessionId: null, userAgent: req.headers['user-agent'] || '' };
  res.setHeader('X-Request-Id', requestId);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (!req.originalUrl.startsWith('/api')) return; // don't log static files
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    log[level](`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(0)}ms`, { user: req.ctx.user?.username, rid: requestId });
  });
  next();
}
