// borrowing/repo.js — data access for Borrowing_Request, _Item, Release(_Item), Return(_Item).
import { getDb } from '../../db/connection.js';

const FROM = `FROM Borrowing_Request r
  JOIN "User" rq ON rq.user_id = r.requester_id JOIN Laboratory l ON l.laboratory_id = r.laboratory_id
  LEFT JOIN "User" ap ON ap.user_id = r.approved_by`;
const COLS = `r.request_id id, r.requester_id requesterId, rq.first_name || ' ' || rq.last_name requesterName, r.laboratory_id laboratoryId, l.name laboratoryName,
  r.purpose, r.request_date requestDate, r.expected_return_date expectedReturnDate, r.status, r.approved_by approvedBy,
  ap.first_name || ' ' || ap.last_name approverName, r.approval_date approvalDate, r.approval_reason approvalReason, r.remarks, r.return_confirmed_at returnConfirmedAt,
  (SELECT group_concat(ri.requested_quantity || ' × ' || i.item_name, ', ') FROM Borrowing_Request_Item ri JOIN Inventory_Item i ON i.item_id = ri.item_id WHERE ri.request_id = r.request_id) itemsSummary,
  (SELECT COUNT(*) FROM Borrowing_Request_Item ri WHERE ri.request_id = r.request_id) itemCount`;

export function query({ where, params, limit, offset }) {
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) n ${FROM} WHERE ${where}`).get(...params).n;
  const rows = db.prepare(`SELECT ${COLS} ${FROM} WHERE ${where} ORDER BY r.request_id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, rows };
}
export const statusCounts = (where, params) =>
  getDb().prepare(`SELECT r.status s, COUNT(*) n ${FROM} WHERE ${where} GROUP BY 1`).all(...params).reduce((o, x) => ({ ...o, [x.s]: x.n }), {});
export const getById = (id) => getDb().prepare(`SELECT ${COLS} ${FROM} WHERE r.request_id = ?`).get(id);

export const itemsOf = (requestId) => getDb().prepare(`
  SELECT ri.request_item_id id, ri.item_id itemId, i.item_name itemName, i.item_type itemType, i.unit_of_measurement unit, ri.requested_quantity quantity, ri.remarks,
         i.quantity onHand, i.status itemStatus, i.laboratory_id laboratoryId,
         CASE WHEN i.item_type = 'Equipment' THEN (SELECT COUNT(*) FROM Asset a WHERE a.item_id = i.item_id AND a.status = 'Available') ELSE i.quantity END availableQuantity
  FROM Borrowing_Request_Item ri JOIN Inventory_Item i ON i.item_id = ri.item_id WHERE ri.request_id = ? ORDER BY ri.request_item_id`).all(requestId);

export const releasesOf = (requestId) => getDb().prepare(`
  SELECT rl.release_id id, rl.release_date releaseDate, rl.remarks, u.first_name || ' ' || u.last_name releasedBy
  FROM "Release" rl JOIN "User" u ON u.user_id = rl.released_by WHERE rl.request_id = ? ORDER BY rl.release_id`).all(requestId);
export const releaseItemsOf = (requestId) => getDb().prepare(`
  SELECT ri.release_item_id id, ri.release_id releaseId, ri.item_id itemId, i.item_name itemName, i.item_type itemType, i.unit_of_measurement unit,
         ri.asset_id assetId, a.asset_tag assetTag, ri.quantity_released quantityReleased
  FROM Release_Item ri JOIN "Release" rl ON rl.release_id = ri.release_id JOIN Inventory_Item i ON i.item_id = ri.item_id LEFT JOIN Asset a ON a.asset_id = ri.asset_id
  WHERE rl.request_id = ? ORDER BY ri.release_item_id`).all(requestId);
export const returnsOf = (requestId) => getDb().prepare(`
  SELECT t.return_id id, t.return_date returnDate, t.remarks, u.first_name || ' ' || u.last_name processedBy
  FROM "Return" t JOIN "User" u ON u.user_id = t.processed_by WHERE t.request_id = ? ORDER BY t.return_id`).all(requestId);
export const returnItemsOf = (requestId) => getDb().prepare(`
  SELECT rt.return_item_id id, rt.return_id returnId, rt.item_id itemId, i.item_name itemName, rt.asset_id assetId, a.asset_tag assetTag,
         rt.quantity_returned quantityReturned, rt.missing_quantity missingQuantity, rt.damaged_quantity damagedQuantity, rt."condition" "condition", rt.remarks
  FROM Return_Item rt JOIN "Return" t ON t.return_id = rt.return_id JOIN Inventory_Item i ON i.item_id = rt.item_id LEFT JOIN Asset a ON a.asset_id = rt.asset_id
  WHERE t.request_id = ? ORDER BY rt.return_item_id`).all(requestId);

export const insertRequest = (r) => getDb().prepare(`INSERT INTO Borrowing_Request (requester_id, laboratory_id, purpose, request_date, expected_return_date, status, remarks)
  VALUES (@requesterId,@laboratoryId,@purpose,@now,@expectedReturnDate,'Pending',@remarks)`).run(r).lastInsertRowid;
export const insertRequestItem = (r) => getDb().prepare(`INSERT INTO Borrowing_Request_Item (request_id, item_id, requested_quantity, remarks) VALUES (@requestId,@itemId,@quantity,@remarks)`).run(r);
export const setDecision = (id, d) => getDb().prepare(`UPDATE Borrowing_Request SET status=@status, approved_by=@userId, approval_date=@now, approval_reason=@reason WHERE request_id=@id`).run({ ...d, id });
export const setStatus = (id, status) => getDb().prepare('UPDATE Borrowing_Request SET status = ? WHERE request_id = ?').run(status, id);
export const setReturnConfirmed = (id, now) => getDb().prepare('UPDATE Borrowing_Request SET return_confirmed_at = ? WHERE request_id = ?').run(now, id);
export const insertRelease = (r) => getDb().prepare(`INSERT INTO "Release" (request_id, released_by, release_date, remarks) VALUES (@requestId,@userId,@now,@remarks)`).run(r).lastInsertRowid;
export const insertReleaseItem = (r) => getDb().prepare(`INSERT INTO Release_Item (release_id, item_id, asset_id, quantity_released, remarks) VALUES (@releaseId,@itemId,@assetId,@quantity,NULL)`).run(r);
export const insertReturn = (r) => getDb().prepare(`INSERT INTO "Return" (request_id, processed_by, return_date, remarks) VALUES (@requestId,@userId,@returnDate,@remarks)`).run(r).lastInsertRowid;
export const insertReturnItem = (r) => getDb().prepare(`INSERT INTO Return_Item (return_id, item_id, asset_id, quantity_returned, missing_quantity, damaged_quantity, "condition", remarks)
  VALUES (@returnId,@itemId,@assetId,@returned,@missing,@damaged,@condition,@remarks)`).run(r);

export const overdueCandidates = (today) => getDb().prepare(`
  SELECT request_id id, laboratory_id laboratoryId FROM Borrowing_Request WHERE status = 'Released' AND expected_return_date IS NOT NULL AND expected_return_date < ?`).all(today);
export const requesterInfo = (userId) => getDb().prepare(`SELECT u.user_id id, u.status, r.role_name roleName FROM "User" u JOIN "Role" r ON r.role_id = u.role_id WHERE u.user_id = ?`).get(userId);
export const requesterHasLab = (userId, labId) => !!getDb().prepare('SELECT 1 FROM User_Laboratory WHERE user_id = ? AND laboratory_id = ?').get(userId, labId);
export const labStatus = (labId) => getDb().prepare('SELECT laboratory_id id, name, status FROM Laboratory WHERE laboratory_id = ?').get(labId);
export const availableAssets = (itemId) => getDb().prepare(`SELECT asset_id id, asset_tag tag, serial_number serialNumber, "condition" FROM Asset WHERE item_id = ? AND status = 'Available' ORDER BY asset_tag`).all(itemId);
export const assetsByIds = (ids) => ids.length ? getDb().prepare(`SELECT asset_id id, asset_tag tag, item_id itemId, laboratory_id laboratoryId, status, "condition", updated_at updatedAt, remarks, serial_number serialNumber
  FROM Asset WHERE asset_id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
