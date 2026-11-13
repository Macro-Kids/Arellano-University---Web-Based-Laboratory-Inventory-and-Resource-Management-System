// -----------------------------------------------------------------------------
// events.js — one set of delegated listeners for the whole app, so pages never
// re-bind handlers after re-rendering and input focus is never lost.
//   markup:  <button data-action="inventory:edit" data-id="4">
//            <input data-on-input="inventory:search">   <select data-on-change="…">
//            <form data-form="inventory:save">
//   code:    onClick('inventory:edit', (el) => …)   onInput / onChange / onSubmit
// Handler errors are caught and reported (toast + server log); they never leave the UI dead.
// -----------------------------------------------------------------------------
import { handle } from './debug.js';

const reg = { click: new Map(), change: new Map(), input: new Map(), submit: new Map() };
let errorSink = (err) => handle(err, 'event handler');
export const setErrorSink = (fn) => { errorSink = fn; };

export const onClick = (name, fn) => reg.click.set(name, fn);
export const onChange = (name, fn) => reg.change.set(name, fn);
export const onInput = (name, fn) => reg.input.set(name, fn);
export const onSubmit = (name, fn) => reg.submit.set(name, fn);

const run = async (fn, ...args) => { try { await fn(...args); } catch (err) { errorSink(err); } };
const debounced = new WeakMap();

export function installEvents(root = document) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = reg.click.get(el.dataset.action);
    if (fn) run(fn, el, e);
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-on-change]');
    const fn = el && reg.change.get(el.dataset.onChange);
    if (fn) run(fn, el, e);
  });
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-on-input]');
    const fn = el && reg.input.get(el.dataset.onInput);
    if (!fn) return;
    clearTimeout(debounced.get(el));
    debounced.set(el, setTimeout(() => run(fn, el, e), Number(el.dataset.debounce ?? 250)));
  });
  root.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const fn = reg.submit.get(form.dataset.form);
    if (fn) run(fn, form, e);
  });
}
