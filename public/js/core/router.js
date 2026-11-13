// -----------------------------------------------------------------------------
// router.js — tiny hash router:  #/inventory?status=Pending
//   registerPage({ id, title, eyebrow, perm, actions(), render(ctx) -> html, mount?(ctx) })
// `render` may fetch data (async). Stale renders (user navigated away) are dropped.
// A permission failure or render error never blanks the app — it shows a message.
// -----------------------------------------------------------------------------
import { canAny } from './state.js';
import { errorBanner, loading } from './ui.js';
import { handle } from './debug.js';
import { onClick } from './events.js';

const pages = new Map();
let seq = 0;
let chrome = { update() {}, body: () => document.getElementById('page-body') };
export const registerPage = (page) => pages.set(page.id, page);
export const setChrome = (c) => { chrome = c; };
export const allPages = () => [...pages.values()];

export function parseHash(hash = location.hash) {
  const [path, qs = ''] = hash.replace(/^#\/?/, '').split('?');
  return { id: path || 'dashboard', query: Object.fromEntries(new URLSearchParams(qs)) };
}
export const current = () => parseHash();
export function navigate(to) { const target = to.startsWith('#') ? to : `#/${to}`; if (location.hash === target) renderRoute(); else location.hash = target; }

export async function renderRoute() {
  if (!chrome.body()) return; // signed out (no shell on screen) — nothing to render into
  const mine = ++seq;
  const { id, query } = parseHash();
  let page = pages.get(id);
  if (!page) { location.replace('#/dashboard'); return; }
  if (page.perm && !canAny(page.perm)) { location.replace('#/dashboard'); return; }
  chrome.update(page, query);
  const body = chrome.body();
  if (!body) return;
  body.innerHTML = loading();
  const ctx = { query };
  try {
    const html = await page.render(ctx);
    if (mine !== seq) return;
    body.innerHTML = html;
    page.mount?.(ctx);
    window.scrollTo({ top: 0 });
  } catch (err) {
    if (mine !== seq) return;
    if (err?.status !== 401) { handle(err, `render ${id}`); body.innerHTML = errorBanner(err); }
  }
}
let listening = false;
export const startRouter = () => {
  if (!listening) { window.addEventListener('hashchange', renderRoute); listening = true; } // register once, even across sign-ins
  return renderRoute();
};
onClick('ui:retry', () => renderRoute());
