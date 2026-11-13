// -----------------------------------------------------------------------------
// state.js — the small amount of client state. SERVER DATA IS NEVER CACHED HERE
// (except reference lists). Everything business-related is fetched fresh, so
// what you see is what is stored. localStorage holds UI preferences only.
// -----------------------------------------------------------------------------
import { setCsrf } from './api.js';

const PREFS_KEY = 'aulab:prefs';
const LAB_KEY = 'aulab:lab';

export const state = {
  me: null,                       // { id, username, name, roleName, permissions[], laboratories[], isGlobal }
  workspaceLab: '',               // '' = all of my laboratories
  prefs: { dense: true, dark: false },
  badges: { pending: 0, notifications: 0 },
  meta: null,                     // /system/meta
};

export const can = (permission) => !!state.me?.permissions.includes(permission);
export const canAny = (...permissions) => permissions.flat().some(can);
export const labs = () => state.me?.laboratories ?? [];
export const activeLabs = () => labs().filter((l) => l.status === 'Operational');

export function setSession(payload) {
  state.me = payload.user;
  setCsrf(payload.csrfToken);
  let saved = ''; try { saved = localStorage.getItem(LAB_KEY) || ''; } catch { /* storage blocked */ }
  state.workspaceLab = labs().some((l) => String(l.id) === saved) ? saved : '';
}
export function clearSession() { state.me = null; setCsrf(''); state.badges = { pending: 0, notifications: 0 }; }

export function setWorkspaceLab(id) {
  state.workspaceLab = id ? String(id) : '';
  try { localStorage.setItem(LAB_KEY, state.workspaceLab); } catch { /* ignore */ }
}
/** Query params that scope a list/report request to the chosen workspace. */
export const wsParams = () => (state.workspaceLab ? { laboratoryId: state.workspaceLab } : {});

export function loadPrefs() {
  try { Object.assign(state.prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { /* ignore */ }
  applyPrefs();
}
export function setPref(key, value) {
  state.prefs[key] = value;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch { /* ignore */ }
  applyPrefs();
}
export function applyPrefs() {
  document.documentElement.classList.toggle('dark', !!state.prefs.dark);
  document.body.classList.toggle('dense', !!state.prefs.dense);
}
