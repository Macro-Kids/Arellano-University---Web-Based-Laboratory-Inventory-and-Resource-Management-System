// pages/auth.js — sign-in screen and sign-out (UC-001).
import { esc } from '../core/format.js';
import { icon } from '../core/icons.js';
import { onClick, onSubmit } from '../core/events.js';
import { submitForm, closeAllLayers } from '../core/ui.js';
import { auth } from '../services/index.js';
import { clearSession, setSession, state } from '../core/state.js';
import { ApiError } from '../core/api.js';

let onSignedIn = () => {};
export const setSignedInHandler = (fn) => { onSignedIn = fn; };

export async function showLogin(message = '') {
  closeAllLayers();
  const app = document.getElementById('app');
  app.innerHTML = `<main class="login-screen"><div class="login-card">
    <div class="brand login-brand"><div class="brand-mark"><img src="assets/arellano-logo.png" alt="Arellano University"/></div><div><strong style="color:var(--navy)">AU<span>·</span>LAB</strong><small>Inventory command center</small></div></div>
    <p class="eyebrow">Secure workspace access</p><h1>Welcome back.</h1>
    <p class="login-copy">Sign in to continue to the Arellano University laboratory register.</p>
    <form data-form="auth:login" novalidate>
      <label>Username or email<input name="identifier" autocomplete="username" required autofocus></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <div class="form-error" role="alert">${esc(message)}</div>
      <button class="btn btn-primary">Enter workspace ${icon('arrow')}</button>
    </form>
    <div class="demo-box" id="demo-box" hidden></div>
    <small class="login-note">Your session ends automatically after a period of inactivity.</small>
  </div><div class="login-aside"><span>PRECISION / READINESS / CARE</span><strong>Know what exists.<br>Know what needs attention.</strong><p>Inventory, borrowing, and equipment care in one quiet command center.</p></div></main>`;
  try {
    if (state.meta?.demo) {
      const { password, accounts } = await auth.demoAccounts();
      const box = document.getElementById('demo-box');
      if (box) {
        box.hidden = false;
        box.innerHTML = `<small>Demo accounts (password <code>${esc(password)}</code>) — click to fill in:</small><div class="demo-chips">${accounts.map((a) =>
          `<button type="button" class="demo-chip" data-action="auth:fill" data-u="${esc(a.username)}" data-p="${esc(password)}">${esc(a.name)}<em>${esc(a.roleName.replace('Laboratory ', 'Lab '))}</em></button>`).join('')}</div>`;
      }
    }
  } catch { /* demo list is optional */ }
}

onClick('auth:fill', (el) => {
  const f = document.querySelector('form[data-form="auth:login"]');
  f.elements.identifier.value = el.dataset.u; f.elements.password.value = el.dataset.p; f.elements.password.focus();
});
onSubmit('auth:login', (form) => submitForm(form, async (v) => {
  if (!v.identifier || !v.password) throw new ApiError(400, { error: { message: 'Enter your username and password.' } });
  let payload;
  try { payload = await auth.login(v.identifier, v.password); }
  catch (err) {
    // A 401 here means "wrong credentials", not "session expired" — show it on the form.
    if (err instanceof ApiError && err.status === 401) throw new ApiError(400, { error: { message: err.message } });
    throw err;
  }
  setSession(payload);
  await onSignedIn();
}));
onClick('auth:sign-out', async () => {
  try { await auth.logout(); } catch { /* already signed out */ }
  clearSession();
  location.hash = '';
  showLogin();
});
