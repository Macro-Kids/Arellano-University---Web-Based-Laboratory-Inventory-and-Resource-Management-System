// format.js — escaping and display formatting. Dates from the API are either
// ISO timestamps (UTC, shown in the user's local time) or YYYY-MM-DD business dates.
export const esc = (v = '') => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtDate(v) {
  if (!v) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}
export function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const fmtTime = (v) => (v ? new Date(v).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '');
// "Today" for business rules (due dates, return dates) must use the SERVER's timezone,
// not the browser's — otherwise a date picked near midnight can disagree with the server.
let businessTz;
export const setBusinessTimezone = (tz) => { businessTz = tz || undefined; };
export const todayStr = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: businessTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const addDaysStr = (n) => { const [y, m, d] = todayStr().split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
export const num = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 }));
export const qty = (n, unit) => `${num(n)}${unit ? ' ' + unit : ''}`;
export const plural = (n, one, many = one + 's') => `${num(n)} ${n === 1 ? one : many}`;
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
export function relative(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso.slice(0, 10));
}
export const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const labShort = (type = '') => (/sci/i.test(type) ? 'SCI' : /tle|tech/i.test(type) ? 'TLE' : type.slice(0, 3).toUpperCase() || 'LAB');
