// -----------------------------------------------------------------------------
// api.js — the ONLY place the browser talks to the server.
//   const { data, meta } = await api.get('/inventory', { search: 'micro' });
// Handles: JSON, the CSRF header, request ids, network failures and typed errors.
// Every failure becomes an ApiError { status, code, message, fields, requestId }.
// 401 responses (expired session) fire the 'unauthorized' event so the app can
// return to the sign-in screen from anywhere.
// -----------------------------------------------------------------------------
import { dlog } from './debug.js';

let csrfToken = '';
export const setCsrf = (t) => { csrfToken = t || ''; };
export const events = new EventTarget();

export class ApiError extends Error {
  constructor(status, body = {}, fallback = '') {
    const e = body.error || {};
    super(e.message || fallback || 'Something went wrong.');
    this.name = 'ApiError';
    this.status = status;
    this.code = e.code || (status === 0 ? 'NETWORK' : 'UNKNOWN');
    this.fields = e.fields || null;
    this.requestId = e.requestId || null;
    this.details = e.details || null;
  }
}

const qs = (query) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

async function request(method, path, { query, body } = {}) {
  const started = performance.now();
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  let res;
  try {
    res = await fetch(`/api${path}${qs(query)}`, { method, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (err) {
    dlog('network error', method, path, err);
    throw new ApiError(0, {}, 'Cannot reach the server. Check your connection and try again.');
  }
  let json = null;
  try { json = await res.json(); } catch { /* empty or non-JSON body */ }
  dlog(`${method} ${path} → ${res.status} (${Math.round(performance.now() - started)}ms)`, json?.error ? json.error : '');
  if (!res.ok) {
    const err = new ApiError(res.status, json || {}, `Request failed (${res.status})`);
    if (res.status === 401 && !path.startsWith('/auth/login')) events.dispatchEvent(new CustomEvent('unauthorized'));
    throw err;
  }
  return json ?? { data: null };
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body = {}) => request('POST', path, { body }),
  patch: (path, body = {}) => request('PATCH', path, { body }),
  /** URL for a browser download (CSV etc). Same-origin cookie authenticates it. */
  url: (path, query) => `/api${path}${qs(query)}`,
};
