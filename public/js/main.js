// -----------------------------------------------------------------------------
// main.js — application entry point.
//   1. install global error handling + delegated events
//   2. ask the server who is signed in (/api/auth/me)
//   3. signed in → render the shell and start the router; otherwise → sign-in screen
// Pages register themselves when imported below. To add a page: create
// pages/<name>.js (registerPage) and add ONE import line here.
// -----------------------------------------------------------------------------
import { ApiError, events } from './core/api.js';
import { installErrorHandlers, handle } from './core/debug.js';
import { installEvents, setErrorSink, onClick } from './core/events.js';
import { installLayerEvents, toast, toastError } from './core/ui.js';
import { loadPrefs, setSession, clearSession, state } from './core/state.js';
import { setChrome, startRouter } from './core/router.js';
import { renderShell, chrome } from './components/shell.js';
import { auth, system } from './services/index.js';
import { setBusinessTimezone } from './core/format.js';
import { showLogin, setSignedInHandler } from './pages/auth.js';

import './pages/dashboard.js';
import './pages/inventory.js';
import './pages/requests.js';
import './pages/assets.js';
import './pages/maintenance.js';
import './pages/reports.js';
import './pages/audit.js';
import './pages/users.js';
import './pages/settings.js';

async function startApp() {
  renderShell();
  setChrome(chrome);
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/dashboard');
  await startRouter();
}
setSignedInHandler(startApp);
onClick('app:reload', () => location.reload());

function reportToServer(err, context) {
  if (!state.me) return;
  system.clientLog({ message: String(err?.message || err).slice(0, 480), stack: String(err?.stack || '').slice(0, 2900), url: location.hash, context }).catch(() => {});
}

export async function boot() {
  loadPrefs();
  installErrorHandlers(reportToServer);
  installEvents(document);
  installLayerEvents();
  setErrorSink((err) => {
    if (err instanceof ApiError) { if (err.status !== 401) toastError(err); return; }
    handle(err, 'ui');
    toast('Something unexpected went wrong. It has been logged — please try again.', 'info');
  });
  let expired = false;
  events.addEventListener('unauthorized', () => {
    if (expired || !state.me) return;
    expired = true; clearSession(); showLogin('Your session has expired. Please sign in again.');
    setTimeout(() => { expired = false; }, 1000);
  });
  window.__aulab = { state, system }; // handy in the browser console while debugging

  try { state.meta = await system.meta(); setBusinessTimezone(state.meta.timezone); } catch { /* sign-in still works */ }
  try {
    setSession(await auth.me());
    await startApp();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) showLogin();
    else { handle(err, 'boot'); document.getElementById('app').innerHTML = `<div class="boot"><div style="text-align:center"><p>AU·LAB could not reach the server.</p><button class="btn btn-primary" data-action="app:reload">Reload</button></div></div>`; }
  }
}
if (!globalThis.__AULAB_NO_AUTOBOOT) boot();
