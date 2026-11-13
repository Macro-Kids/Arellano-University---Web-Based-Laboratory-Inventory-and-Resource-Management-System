// -----------------------------------------------------------------------------
// ui.js — building blocks shared by every page: toasts, modal/drawer layers,
// confirm dialogs, form fields + server-error display, badges, pager, empty states.
// -----------------------------------------------------------------------------
import { ApiError } from './api.js';
import { esc, slug } from './format.js';
import { icon } from './icons.js';
import { onClick } from './events.js';

// ---- toasts --------------------------------------------------------------------
let toastTimer;
export function toast(message, tone = 'success') {
  const region = document.querySelector('.toast-region');
  if (!region) return;
  clearTimeout(toastTimer);
  region.innerHTML = `<div class="toast ${tone === 'success' ? '' : tone}" role="status"><span class="toast-mark">${tone === 'success' ? '✓' : '!'}</span><span>${esc(message)}</span><button data-action="ui:close-toast" aria-label="Dismiss">×</button></div>`;
  toastTimer = setTimeout(() => { region.innerHTML = ''; }, tone === 'success' ? 3600 : 7000);
}
export const closeToast = () => { document.querySelector('.toast-region').innerHTML = ''; };
/** Show any error to the user in plain words, with the support reference when there is one. */
export function toastError(err) {
  const ref = err instanceof ApiError && err.requestId && err.status >= 500 ? ` (ref ${err.requestId})` : '';
  toast(`${err?.message || 'Something went wrong.'}${ref}`, 'info');
}

// ---- layers (modals & drawers) -----------------------------------------------------
const overlay = () => document.getElementById('overlay');
export function openLayer(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  const el = wrap.firstElementChild;
  overlay().appendChild(el);
  const first = el.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
  (first || el.querySelector('button'))?.focus({ preventScroll: true });
  return el;
}
export const layers = () => [...overlay().querySelectorAll(':scope > [data-layer]')];
export const topLayer = () => layers().at(-1) || null;
export function closeLayer(el = topLayer()) { el?.remove(); }
export function closeAllLayers() { overlay().innerHTML = ''; }
/** Replace the contents of the top drawer/modal (used after an action changed the data). */
export function replaceLayer(el, html) {
  const wrap = document.createElement('div'); wrap.innerHTML = html.trim();
  const next = wrap.firstElementChild;
  el.replaceWith(next);
  return next;
}
export function installLayerEvents() {
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && topLayer()) closeLayer(); });
  overlay().addEventListener('mousedown', (e) => { if (e.target.matches('[data-layer]')) closeLayer(e.target); });
}

export function modalHtml({ eyebrow = '', title, subtitle = '', body, size = '' }) {
  return `<div class="modal-backdrop" data-layer><div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h2>${esc(title)}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
    <button class="icon-btn" data-action="ui:close" aria-label="Close">${icon('close')}</button></div>${body}</div></div>`;
}
export function drawerHtml({ eyebrow = '', title, subtitle = '', body }) {
  return `<div class="modal-backdrop" data-layer><aside class="drawer wide" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="drawer-head"><div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h2>${esc(title)}</h2>${subtitle ? `<p class="muted-small">${subtitle}</p>` : ''}</div>
    <button class="icon-btn" data-action="ui:close" aria-label="Close">${icon('close')}</button></div><div class="drawer-body">${body}</div></aside></div>`;
}

/** Promise-based confirmation. Resolves { reason } on confirm, null on cancel. */
export function confirmDialog({ title, message, label = 'Confirm', danger = true, reasonLabel = '', reasonRequired = false, reasonPlaceholder = '' }) {
  return new Promise((resolve) => {
    const el = openLayer(`<div class="modal-backdrop" data-layer><div class="modal confirm-modal" role="alertdialog" aria-modal="true">
      <span class="confirm-icon">${icon(danger ? 'alert' : 'check')}</span><h2>${esc(title)}</h2><p>${message}</p>
      ${reasonLabel ? `<label class="field ${reasonRequired ? '' : ''}"><span>${esc(reasonLabel)}${reasonRequired ? ' *' : ''}</span><textarea rows="2" data-reason placeholder="${esc(reasonPlaceholder)}"></textarea><span class="field-error" data-reason-error></span></label>` : ''}
      <div class="modal-actions"><button class="btn btn-quiet" data-cancel>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(label)}</button></div></div></div>`);
    let observer;
    const done = (v) => { observer?.disconnect(); el.remove(); resolve(v); };
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-cancel]') || e.target.matches('[data-layer]')) return done(null);
      if (e.target.closest('[data-ok]')) {
        const reason = el.querySelector('[data-reason]')?.value.trim() ?? '';
        if (reasonRequired && reason.length < 3) { el.querySelector('[data-reason-error]').textContent = 'Please enter a reason.'; return; }
        done({ reason });
      }
    });
    observer = new MutationObserver(() => { if (!el.isConnected) { observer.disconnect(); resolve(null); } });
    observer.observe(document.getElementById('overlay'), { childList: true });
  });
}

// ---- forms ----------------------------------------------------------------------------------
const optionList = (options, value) => (options || []).map((o) => {
  const v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
  return `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''} ${o?.disabled ? 'disabled' : ''}>${esc(l)}</option>`;
}).join('');

/** One labelled input with its own error slot: <span data-error-for="name">. */
export function field({ name, label, type = 'text', value = '', required = false, options, hint = '', placeholder = '', span2 = false, rows = 3, attrs = '', disabled = false }) {
  const req = required ? ' *' : '';
  let control;
  if (type === 'select') control = `<select name="${name}" ${disabled ? 'disabled' : ''} ${attrs}>${optionList(options, value)}</select>`;
  else if (type === 'textarea') control = `<textarea name="${name}" rows="${rows}" placeholder="${esc(placeholder)}" ${disabled ? 'disabled' : ''} ${attrs}>${esc(value)}</textarea>`;
  else control = `<input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${disabled ? 'disabled' : ''} ${attrs}>`;
  return `<label class="field ${span2 ? 'span-2' : ''}" data-field="${name}"><span>${esc(label)}${req}</span>${control}${hint ? `<span class="field-hint">${hint}</span>` : ''}<span class="field-error" data-error-for="${name}"></span></label>`;
}

/** Read a form into a plain object. Numbers become numbers, empty numbers are omitted. */
export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.type === 'number') { if (el.value !== '') out[el.name] = Number(el.value); }
    else out[el.name] = typeof el.value === 'string' ? el.value.trim() : el.value;
  }
  return out;
}
export function clearErrors(form) {
  form.querySelectorAll('[data-error-for]').forEach((e) => { e.textContent = ''; });
  form.querySelectorAll('.has-error').forEach((e) => e.classList.remove('has-error'));
  const banner = form.querySelector('.form-error'); if (banner) banner.textContent = '';
}
/** Put a server error on the right fields (err.fields) or in the form banner. */
export function showErrors(form, err) {
  clearErrors(form);
  const banner = form.querySelector('.form-error');
  const unplaced = [];
  for (const [key, msg] of Object.entries(err.fields || {})) {
    const slot = form.querySelector(`[data-error-for="${CSS.escape(key)}"]`);
    if (slot) { slot.textContent = msg; slot.closest('.field, .line-row')?.classList.add('has-error'); } else unplaced.push(msg);
  }
  if (banner) banner.textContent = unplaced.length ? unplaced.join(' ') : (err.fields ? 'Please correct the highlighted fields.' : err.message);
  form.querySelector('.has-error input, .has-error select, .has-error textarea')?.focus();
}
/** Run an async submit handler with a busy state and automatic server-error display. */
export async function submitForm(form, fn) {
  if (form.dataset.busy) return undefined;
  form.dataset.busy = '1';
  const buttons = [...form.querySelectorAll('button:not([type=button])')];
  buttons.forEach((b) => { b.disabled = true; });
  clearErrors(form);
  try { return await fn(readForm(form)); }
  catch (err) {
    if (err instanceof ApiError && err.status !== 401 && err.status < 500) { showErrors(form, err); return undefined; }
    throw err;
  } finally { delete form.dataset.busy; buttons.forEach((b) => { b.disabled = false; }); }
}
export const formShell = (name, inner, { submit = 'Save', cancel = true, data = '', cls = 'form-stack' } = {}) =>
  `<form data-form="${name}" ${data} class="${cls}" novalidate>${inner}<div class="form-error" role="alert"></div>
   <div class="modal-actions">${cancel ? '<button type="button" class="btn btn-quiet" data-action="ui:close">Cancel</button>' : ''}<button class="btn btn-primary">${esc(submit)}</button></div></form>`;

// ---- display pieces ------------------------------------------------------------------------------
export const badge = (text) => `<span class="badge badge-${slug(text)}">${esc(text)}</span>`;
export const stockBadge = (state) => ({ out: badge('Out of stock'), low: badge('Low stock'), ok: '' }[state] ?? '');

export const loading = (text = 'Loading…') => `<div class="loading-block"><span class="spinner"></span>${esc(text)}</div>`;
export const emptyState = (iconName, title, text = '', actionHtml = '') =>
  `<div class="empty-state">${icon(iconName)}<h3>${esc(title)}</h3><p>${esc(text)}</p>${actionHtml}</div>`;
export const errorBanner = (err, retryAction = 'ui:retry') =>
  `<div class="err-banner">${esc(err?.message || 'Something went wrong.')}${err?.requestId ? `<small>Reference ${esc(err.requestId)} — quote this to support.</small>` : ''}
   <div style="margin-top:10px"><button class="btn btn-small btn-quiet" data-action="${retryAction}">${icon('refresh')}Try again</button></div></div>`;

export function pager(meta, action) {
  if (!meta) return '';
  const from = meta.total ? (meta.page - 1) * meta.pageSize + 1 : 0, to = Math.min(meta.total, meta.page * meta.pageSize);
  return `<div class="table-foot"><span>${meta.total ? `Showing ${from}–${to} of ${meta.total}` : 'No records'}</span>
    <div class="pager"><button class="btn btn-small btn-quiet" data-action="${action}" data-page="${meta.page - 1}" ${meta.page <= 1 ? 'disabled' : ''}>Previous</button>
    <span>Page ${meta.page} of ${meta.pages}</span>
    <button class="btn btn-small btn-quiet" data-action="${action}" data-page="${meta.page + 1}" ${meta.page >= meta.pages ? 'disabled' : ''}>Next</button></div></div>`;
}
export function sortTh(label, key, view, action) {
  const on = view.sort === key;
  return `<th class="sortable" data-action="${action}" data-sort="${key}" aria-sort="${on ? (view.dir === 'desc' ? 'descending' : 'ascending') : 'none'}">${esc(label)}<span class="sort-mark">${on ? (view.dir === 'desc' ? '▼' : '▲') : ''}</span></th>`;
}
export function kv(rows) {
  return `<dl class="kv">${rows.filter(([, v]) => v !== undefined).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v === null || v === '' ? '—' : v}</dd>`).join('')}</dl>`;
}
/** Re-render only `#id`'s inner HTML (keeps search box focus, scroll position, etc.). */
export function setHtml(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; return el; }
export const clickable = (el) => el;

// ---- built-in actions ------------------------------------------------------------------------------
onClick('ui:close', (el) => closeLayer(el.closest('[data-layer]')));
onClick('ui:close-toast', closeToast);
