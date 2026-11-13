// -----------------------------------------------------------------------------
// diff.js — compute { previous, next } holding only the fields that changed,
// so audit rows read "quantity 38 -> 36" instead of dumping whole records.
// -----------------------------------------------------------------------------
export function diffFields(before, after, keys) {
  const previous = {}, next = {};
  for (const k of keys ?? Object.keys(after)) {
    const a = before?.[k] ?? null, b = after?.[k] ?? null;
    if (String(a) !== String(b)) { previous[k] = a; next[k] = b; }
  }
  return { previous, next, changed: Object.keys(next).length > 0 };
}
