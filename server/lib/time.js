// -----------------------------------------------------------------------------
// time.js — all date logic in one place.
// Timestamps are ISO-8601 UTC strings. "Business dates" (due dates, today) use
// config.timezone (default Asia/Manila) so "overdue" flips at local midnight.
// -----------------------------------------------------------------------------
import { config } from '../config.js';

export const nowIso = () => new Date().toISOString();

/** Today's date (YYYY-MM-DD) in the configured timezone. */
export function todayLocal(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
/** Local calendar year of an ISO timestamp. */
export const yearOf = (iso) => (iso ? todayLocal(new Date(iso)).slice(0, 4) : String(new Date().getFullYear()));

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const daysAgoIso = (n) => new Date(Date.now() - n * 86400000).toISOString();
/** Start / end of a local calendar day expressed as UTC ISO bounds (for filtering timestamps). */
export function dayBoundsUtc(dateStr) {
  // Resolve the tz offset at that date by formatting; Asia/Manila has no DST but this stays correct for others.
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, timeZoneName: 'longOffset' }).formatToParts(probe);
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const m = tzName.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  const offsetMin = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
  const start = new Date(Date.parse(`${dateStr}T00:00:00Z`) - offsetMin * 60000);
  return { from: start.toISOString(), to: new Date(start.getTime() + 86400000).toISOString() };
}
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
