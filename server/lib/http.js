// -----------------------------------------------------------------------------
// http.js — response envelope, pagination and CSV helpers shared by all routes.
//   success: { data, meta? }      error: { error: { code, message, fields?, requestId } }
// -----------------------------------------------------------------------------
export const send = (res, data, meta, status = 200) => res.status(status).json(meta ? { data, meta } : { data });
export const created = (res, data, meta) => send(res, data, meta, 201);

export function pageParams(query, { defaultSize = 25, maxSize = 200 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number.parseInt(query.pageSize, 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export const pageMeta = (total, { page, pageSize }) => ({ total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) });

/** Escape one CSV cell. Cells starting with = + - @ are prefixed to block spreadsheet formula injection. */
function cell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** columns: [{ key, label }] ; rows: array of objects. */
export function toCsv(columns, rows) {
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
  return '\uFEFF' + [head, ...body].join('\r\n') + '\r\n'; // BOM so Excel opens UTF-8 correctly
}
export function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}
/** Escape LIKE wildcards for user-supplied search text. */
export const likeTerm = (s) => `%${String(s).trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
