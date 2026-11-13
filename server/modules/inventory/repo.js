// -----------------------------------------------------------------------------
// inventory/repo.js — data access for Inventory_Item and Inventory_Transaction.
// Equipment "quantity", "availableQuantity", "condition" and "attentionCount" are
// DERIVED from the Asset table inside BASE_SELECT, so list/filter/sort always
// agree with the asset register (DIR-001).
// -----------------------------------------------------------------------------
import { getDb } from '../../db/connection.js';

const OWNED = `a.status NOT IN ('Lost','Retired')`;
const BASE_SELECT = `
  SELECT i.item_id AS id, i.item_name AS name, i.description, i.category_id AS categoryId, c.name AS categoryName,
         i.laboratory_id AS laboratoryId, l.name AS laboratoryName, i.item_type AS itemType, i.unit_of_measurement AS unit,
         i.quantity, i.minimum_stock_level AS minimumStock,
         CASE WHEN i.item_type = 'Equipment'
              THEN COALESCE((SELECT a."condition" FROM Asset a WHERE a.item_id = i.item_id AND ${OWNED}
                             GROUP BY a."condition" ORDER BY COUNT(*) DESC, a."condition" LIMIT 1), i."condition")
              ELSE i."condition" END AS "condition",
         i.location, i.acquisition_date AS acquisitionDate, i.acquisition_source AS acquisitionSource, i.remarks,
         i.status, i.created_at AS createdAt, i.updated_at AS updatedAt, i.archived_at AS archivedAt, i.asset_prefix AS assetPrefix,
         CASE WHEN i.item_type = 'Equipment'
              THEN (SELECT COUNT(*) FROM Asset a WHERE a.item_id = i.item_id AND a.status = 'Available')
              ELSE i.quantity END AS availableQuantity,
         CASE WHEN i.item_type = 'Equipment'
              THEN (SELECT COUNT(*) FROM Asset a WHERE a.item_id = i.item_id AND ${OWNED}
                    AND (a.status IN ('Damaged','Under Maintenance','Under Inspection') OR a."condition" IN ('Damaged','Non-functional')))
              ELSE 0 END AS attentionCount
  FROM Inventory_Item i
  JOIN Category c ON c.category_id = i.category_id
  JOIN Laboratory l ON l.laboratory_id = i.laboratory_id`;

const SORTS = {
  name: 't.name COLLATE NOCASE', quantity: 't.quantity', added: 't.createdAt', code: 't.id',
  status: 't.status', laboratory: 't.laboratoryName COLLATE NOCASE', category: 't.categoryName COLLATE NOCASE',
  condition: `CASE t."condition" WHEN 'Excellent' THEN 1 WHEN 'Good' THEN 2 WHEN 'Fair' THEN 3 WHEN 'Damaged' THEN 4 WHEN 'Non-functional' THEN 5 ELSE 6 END`,
};

export function search({ scopeSql, scopeParams, q, codeId, categoryId, itemType, availability, condition, status, location, sort, dir, limit, offset }) {
  const db = getDb();
  const where = [scopeSql], params = [...scopeParams];
  if (status === 'archived') where.push(`t.status = 'Archived'`);
  else if (status !== 'all') where.push(`t.status = 'Active'`);
  if (q) {
    where.push(`(t.name LIKE @q ESCAPE '\\' OR IFNULL(t.description,'') LIKE @q ESCAPE '\\' OR t.categoryName LIKE @q ESCAPE '\\'
                 OR t.laboratoryName LIKE @q ESCAPE '\\' OR IFNULL(t.location,'') LIKE @q ESCAPE '\\' OR IFNULL(t."condition",'') LIKE @q ESCAPE '\\'
                 OR t.status LIKE @q ESCAPE '\\'
                 OR EXISTS (SELECT 1 FROM Asset a WHERE a.item_id = t.id AND (a.asset_tag LIKE @q ESCAPE '\\' OR IFNULL(a.serial_number,'') LIKE @q ESCAPE '\\'))
                 ${codeId ? 'OR t.id = @codeId' : ''})`);
  }
  if (categoryId) where.push('t.categoryId = @categoryId');
  if (itemType) where.push('t.itemType = @itemType');
  if (condition) where.push('t."condition" = @condition');
  if (location) where.push(`IFNULL(t.location,'') LIKE @location ESCAPE '\\'`);
  if (availability === 'available') where.push('t.availableQuantity > 0');
  if (availability === 'unavailable') where.push('t.availableQuantity <= 0');
  if (availability === 'low') where.push('t.quantity > 0 AND t.quantity <= t.minimumStock');
  if (availability === 'out') where.push('t.quantity <= 0');
  const w = where.join(' AND ');
  const named = { q, codeId, categoryId, itemType, condition, location };
  const bind = Object.fromEntries(Object.entries(named).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  // positional scope params first, then named ones
  const run = (sql, extra = []) => db.prepare(sql).all(...params, bind, ...extra);
  const total = db.prepare(`SELECT COUNT(*) n FROM (${BASE_SELECT}) t WHERE ${w}`).get(...params, bind).n;
  const order = `${SORTS[sort] || SORTS.name} ${dir === 'desc' ? 'DESC' : 'ASC'}, t.id`;
  const rows = run(`SELECT * FROM (${BASE_SELECT}) t WHERE ${w} ORDER BY ${order} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`);
  return { total, rows };
}

export const getById = (id) => getDb().prepare(`SELECT * FROM (${BASE_SELECT}) t WHERE t.id = ?`).get(id);
/** Raw stored row (not derived) — used inside transactions for balance maths. */
export const getRaw = (id) => getDb().prepare(`SELECT item_id id, item_name name, laboratory_id laboratoryId, category_id categoryId, item_type itemType,
  unit_of_measurement unit, quantity, minimum_stock_level minimumStock, status, asset_prefix assetPrefix, "condition", location
  FROM Inventory_Item WHERE item_id = ?`).get(id);

export function lookup({ scopeSql, scopeParams, q, laboratoryId }) {
  return getDb().prepare(`
    SELECT t.id, t.name, t.itemType, t.unit, t.quantity, t.availableQuantity, t.laboratoryId, t.laboratoryName, t.categoryName, t.assetPrefix, t.minimumStock
    FROM (${BASE_SELECT}) t
    WHERE t.status = 'Active' AND ${scopeSql}
      ${laboratoryId ? 'AND t.laboratoryId = ' + Number(laboratoryId) : ''} ${q ? `AND t.name LIKE ? ESCAPE '\\'` : ''}
    ORDER BY t.name COLLATE NOCASE LIMIT 500`).all(...scopeParams, ...(q ? [q] : []));
}

export function insert(i) {
  return getDb().prepare(`
    INSERT INTO Inventory_Item (item_name, description, category_id, laboratory_id, item_type, unit_of_measurement, quantity, minimum_stock_level,
      "condition", location, acquisition_date, acquisition_source, remarks, status, created_at, updated_at, asset_prefix)
    VALUES (@name,@description,@categoryId,@laboratoryId,@itemType,@unit,0,@minimumStock,@condition,@location,@acquisitionDate,@acquisitionSource,@remarks,'Active',@now,@now,@assetPrefix)`).run(i).lastInsertRowid;
}
export function updateMeta(id, i) {
  getDb().prepare(`UPDATE Inventory_Item SET item_name=@name, description=@description, category_id=@categoryId, unit_of_measurement=@unit,
    minimum_stock_level=@minimumStock, "condition"=@condition, location=@location, acquisition_date=@acquisitionDate,
    acquisition_source=@acquisitionSource, remarks=@remarks, updated_at=@now WHERE item_id=@id`).run({ ...i, id });
}
export const setQuantity = (id, qty, now) => getDb().prepare('UPDATE Inventory_Item SET quantity = ?, updated_at = ? WHERE item_id = ?').run(qty, now, id);
export const setArchived = (id, archivedAt, now) =>
  getDb().prepare(`UPDATE Inventory_Item SET status = ?, archived_at = ?, updated_at = ? WHERE item_id = ?`).run(archivedAt ? 'Archived' : 'Active', archivedAt, now, id);
export const nameTaken = (labId, name, exceptId = 0) =>
  !!getDb().prepare(`SELECT 1 FROM Inventory_Item WHERE laboratory_id = ? AND lower(item_name) = lower(?) AND status = 'Active' AND item_id <> ?`).get(labId, name, exceptId);
export const findActiveByName = (labId, name) =>
  getDb().prepare(`SELECT item_id id FROM Inventory_Item WHERE laboratory_id = ? AND lower(item_name) = lower(?) AND status = 'Active'`).get(labId, name);
export const categoryById = (id) => getDb().prepare('SELECT category_id id, name, status FROM Category WHERE category_id = ?').get(id);
export const labById = (id) => getDb().prepare('SELECT laboratory_id id, name, status FROM Laboratory WHERE laboratory_id = ?').get(id);
export const ownedAssetCount = (itemId) => getDb().prepare(`SELECT COUNT(*) n FROM Asset a WHERE a.item_id = ? AND ${OWNED}`).get(itemId).n;
export const assetStatusCounts = (itemId) =>
  getDb().prepare('SELECT status, COUNT(*) n FROM Asset WHERE item_id = ? GROUP BY status').all(itemId).reduce((o, r) => ({ ...o, [r.status]: r.n }), {});
export const assetConditionCounts = (itemId) =>
  getDb().prepare(`SELECT "condition" c, COUNT(*) n FROM Asset a WHERE a.item_id = ? AND ${OWNED} GROUP BY "condition"`).all(itemId).reduce((o, r) => ({ ...o, [r.c]: r.n }), {});
/** Requests that still hold or will use this item (block archiving). */
export const openRequestsForItem = (itemId) => getDb().prepare(`
  SELECT r.request_id id, r.status FROM Borrowing_Request r JOIN Borrowing_Request_Item ri ON ri.request_id = r.request_id
  WHERE ri.item_id = ? AND r.status IN ('Pending','Approved','Released','Overdue')`).all(itemId);
/** Consumable units currently out on loan = released − (returned + missing) over open requests. */
export const onLoanQuantity = (itemId) => getDb().prepare(`
  SELECT IFNULL(SUM(x.out_qty),0) n FROM (
    SELECT IFNULL((SELECT SUM(rl.quantity_released) FROM Release_Item rl JOIN "Release" r ON r.release_id = rl.release_id
                   WHERE r.request_id = br.request_id AND rl.item_id = @id),0)
         - IFNULL((SELECT SUM(rt.quantity_returned + rt.missing_quantity) FROM Return_Item rt JOIN "Return" t ON t.return_id = rt.return_id
                   WHERE t.request_id = br.request_id AND rt.item_id = @id),0) AS out_qty
    FROM Borrowing_Request br WHERE br.status IN ('Released','Overdue')) x`).get({ id: itemId }).n;

// ---- transactions -------------------------------------------------------------
export function insertTransaction(t) {
  return getDb().prepare(`INSERT INTO Inventory_Transaction (item_id, user_id, transaction_type, quantity, transaction_date, reason, source, remarks, balance_after)
    VALUES (@itemId,@userId,@type,@quantity,@date,@reason,@source,@remarks,@balanceAfter)`).run(t).lastInsertRowid;
}
const TRX_SELECT = `
  SELECT t.transaction_id AS id, t.item_id AS itemId, i.item_name AS itemName, i.unit_of_measurement AS unit, i.laboratory_id AS laboratoryId, l.name AS laboratoryName,
         t.user_id AS userId, u.first_name || ' ' || u.last_name AS userName, t.transaction_type AS type, t.quantity,
         t.transaction_date AS date, t.reason, t.source, t.remarks, t.balance_after AS balanceAfter
  FROM Inventory_Transaction t
  JOIN Inventory_Item i ON i.item_id = t.item_id JOIN Laboratory l ON l.laboratory_id = i.laboratory_id
  JOIN "User" u ON u.user_id = t.user_id`;
export function queryTransactions({ where, params, limit, offset }) {
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) n FROM Inventory_Transaction t JOIN Inventory_Item i ON i.item_id = t.item_id WHERE ${where}`).get(...params).n;
  const rows = db.prepare(`${TRX_SELECT} WHERE ${where} ORDER BY t.transaction_id DESC ${limit ? 'LIMIT ? OFFSET ?' : ''}`).all(...params, ...(limit ? [limit, offset] : []));
  return { total, rows };
}
export const ledgerSum = (itemId) => getDb().prepare('SELECT IFNULL(SUM(quantity),0) s FROM Inventory_Transaction WHERE item_id = ?').get(itemId).s;
