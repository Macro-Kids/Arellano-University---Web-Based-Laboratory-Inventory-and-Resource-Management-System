// -----------------------------------------------------------------------------
// errors.js — every expected failure is an AppError with a stable `code`.
// The error-handler middleware turns it into:
//   { error: { code, message, fields?, requestId } }
// Throw these from services; never build error responses by hand.
// -----------------------------------------------------------------------------
export class AppError extends Error {
  constructor(status, code, message, { fields, details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}
export const validationError = (fields, message = 'Please correct the highlighted fields.') =>
  new AppError(400, 'VALIDATION_ERROR', message, { fields });
export const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, { details });
export const unauthenticated = (message = 'Please sign in to continue.') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to do that.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} was not found.`);
export const conflict = (message, details) => new AppError(409, 'CONFLICT', message, { details });
/** A business rule from the SRS (BR-xxx / FR-033) prevented the operation. */
export const ruleViolation = (message, details) => new AppError(422, 'BUSINESS_RULE', message, { details });
export const tooMany = (message, retryAfterSeconds) => new AppError(429, 'RATE_LIMITED', message, { details: { retryAfterSeconds } });
