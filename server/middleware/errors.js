// -----------------------------------------------------------------------------
// errors.js — the single place errors become HTTP responses.
// Unexpected errors are logged with stack + request id and returned as a generic
// 500 (plus the stack in development only).
// -----------------------------------------------------------------------------
import { AppError } from '../lib/errors.js';
import { config } from '../config.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('error');

export function apiNotFound(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `No such endpoint: ${req.method} ${req.originalUrl.split('?')[0]}`));
}

export function errorHandler(err, req, res, _next) {
  const requestId = req.ctx?.requestId;
  let status = 500, code = 'INTERNAL', message = 'Something went wrong on our side. Please try again.', fields, details;

  if (err instanceof AppError) {
    ({ status, code, message, fields, details } = err);
  } else if (err?.type === 'entity.parse.failed') {
    status = 400; code = 'BAD_JSON'; message = 'The request body is not valid JSON.';
  } else if (err?.type === 'entity.too.large') {
    status = 413; code = 'TOO_LARGE'; message = 'The request is too large.';
  } else if (typeof err?.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
    // Safety net: services should pre-check, but the DB is the final guard.
    status = err.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 422;
    code = err.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'CONFLICT' : 'BUSINESS_RULE';
    message = err.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ? 'That value already exists. Please use a different one.'
      : 'The database rejected this change because it would break a data rule.';
    log.warn('constraint violation reached error handler', { sqliteCode: err.code, message: err.message, rid: requestId, url: req.originalUrl });
    details = config.isProd ? undefined : { sqlite: err.message };
  }

  if (status >= 500) {
    log.error(`unhandled error on ${req.method} ${req.originalUrl}`, { err, rid: requestId, user: req.ctx?.user?.username });
  }
  const body = { error: { code, message, ...(fields ? { fields } : {}), ...(details ? { details } : {}), requestId } };
  if (status >= 500 && !config.isProd) body.error.debug = { message: err?.message, stack: String(err?.stack || '').split('\n').slice(0, 8) };
  if (res.headersSent) return;
  res.status(status).json(body);
}
