// -----------------------------------------------------------------------------
// throttle.js — in-memory failure throttle used for login brute-force defence.
// (A school-sized single-process app does not need Redis; see docs/OPERATIONS.md.)
// -----------------------------------------------------------------------------
export class FailureThrottle {
  constructor(maxFailures, windowMs) { this.max = maxFailures; this.windowMs = windowMs; this.hits = new Map(); }
  _prune(key, now) {
    const list = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list); else this.hits.delete(key);
    return list;
  }
  /** Seconds until retry is allowed, or 0 when not blocked. */
  blockedFor(key, now = Date.now()) {
    const list = this._prune(key, now);
    if (list.length < this.max) return 0;
    return Math.ceil((list[0] + this.windowMs - now) / 1000);
  }
  fail(key, now = Date.now()) { const list = this._prune(key, now); list.push(now); this.hits.set(key, list); }
  reset(key) { this.hits.delete(key); }
  clear() { this.hits.clear(); }
}
