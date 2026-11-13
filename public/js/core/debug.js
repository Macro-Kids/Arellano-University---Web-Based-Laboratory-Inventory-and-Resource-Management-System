// -----------------------------------------------------------------------------
// debug.js — front-end diagnostics.
//   Turn on verbose console logging:   localStorage.setItem('aulab:debug','1')  (or add ?debug=1 to the URL)
//   Inspect live state in the console: window.__aulab   (state, api, route)
// Uncaught errors are shown as a toast and also POSTed to /api/system/client-log
// so they land in the same server log (logs/app.log) as back-end errors.
// -----------------------------------------------------------------------------
const KEY = 'aulab:debug';
export const debugOn = () => { try { return localStorage.getItem(KEY) === '1' || /[?&]debug=1/.test(location.search); } catch { return false; } };
export const dlog = (...args) => { if (debugOn()) console.debug('%c[aulab]', 'color:#1f65a9;font-weight:700', ...args); };

let reporter = null;
let sent = 0;
export function installErrorHandlers(report) {
  reporter = report;
  window.addEventListener('error', (e) => handle(e.error || new Error(e.message), 'window.onerror'));
  window.addEventListener('unhandledrejection', (e) => handle(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), 'unhandledrejection'));
}
export function handle(err, context = '') {
  console.error(`[aulab] ${context}`, err);
  if (sent++ > 20) return; // never flood the server
  reporter?.(err, context);
}
