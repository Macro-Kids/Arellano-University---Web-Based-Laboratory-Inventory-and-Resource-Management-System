// -----------------------------------------------------------------------------
// dashboard/service.js — UC-015 Role-Based Dashboard (FR-026) + live notifications.
// Always filtered through labFilter(): nothing outside the user's scope is counted.
// Pure SQL aggregation — no AI/forecasting (SRS FR-026, FE-001).
//
// Laboratory readiness % = owned, usable equipment ÷ owned equipment, where
// "usable" = status not in (Damaged, Under Maintenance, Under Inspection).
// Ready ≥ 85 %, Review 70–84 %, Attention < 70 %.  (No equipment → 100 %.)
// -----------------------------------------------------------------------------
import { getDb } from '../../db/connection.js';
import { codes } from '../../lib/codes.js';
import { can, labFilter } from '../../lib/scope.js';
import { P } from '../auth/permissions.js';
import { sweepOverdue } from '../borrowing/service.js';
import { listAll as auditList } from '../audit/service.js';

const one = (sql, ...p) => getDb().prepare(sql).get(...p);
const all = (sql, ...p) => getDb().prepare(sql).all(...p);

function readiness(labScopeSql, params) {
  return all(`
    SELECT l.laboratory_id id, l.name, l.type, l.location, l.status,
      (SELECT COUNT(*) FROM Asset a WHERE a.laboratory_id = l.laboratory_id AND a.status NOT IN ('Lost','Retired')) total,
      (SELECT COUNT(*) FROM Asset a WHERE a.laboratory_id = l.laboratory_id AND a.status IN ('Available','Borrowed','In Use')) usable,
      (SELECT COUNT(*) FROM Inventory_Item i WHERE i.laboratory_id = l.laboratory_id AND i.status='Active' AND i.quantity <= i.minimum_stock_level) lowStock,
      (SELECT COUNT(*) FROM Borrowing_Request r WHERE r.laboratory_id = l.laboratory_id AND r.status='Pending') pending,
      (SELECT COUNT(*) FROM Borrowing_Request r WHERE r.laboratory_id = l.laboratory_id AND r.status='Overdue') overdue
    FROM Laboratory l WHERE ${labScopeSql} ORDER BY l.name`, ...params).map((l) => {
    const percent = l.total ? Math.round((l.usable / l.total) * 100) : 100;
    return { ...l, code: codes.lab(l.id), percent, state: percent >= 85 ? 'Ready' : percent >= 70 ? 'Review' : 'Attention' };
  });
}

export function dashboard(ctx, query) {
  sweepOverdue();
  const labId = Number(query.laboratoryId) || null;
  const out = { role: ctx.user.roleName, generatedAt: new Date().toISOString(), scope: { laboratoryId: labId } };

  // Teachers: personal view (BR-012).
  if (!can(ctx, P.BORROW_VIEW_ALL)) {
    const mine = all(`SELECT status, COUNT(*) n FROM Borrowing_Request WHERE requester_id = ? GROUP BY status`, ctx.user.id).reduce((o, r) => ({ ...o, [r.status]: r.n }), {});
    const s = labFilter(ctx, 'i.laboratory_id', labId);
    out.kind = 'personal';
    out.metrics = {
      myOpen: (mine.Pending || 0) + (mine.Approved || 0) + (mine.Released || 0) + (mine.Overdue || 0),
      myPending: mine.Pending || 0, myApproved: mine.Approved || 0, myBorrowed: (mine.Released || 0) + (mine.Overdue || 0), myOverdue: mine.Overdue || 0,
      availableItems: one(`SELECT COUNT(*) n FROM Inventory_Item i WHERE i.status='Active' AND ${s.sql} AND (CASE WHEN i.item_type='Equipment'
        THEN (SELECT COUNT(*) FROM Asset a WHERE a.item_id=i.item_id AND a.status='Available') ELSE i.quantity END) > 0`, ...s.params).n,
    };
    out.upcoming = all(`SELECT r.request_id id, r.request_date requestDate, r.status, r.expected_return_date expectedReturnDate, l.name laboratoryName, r.purpose
      FROM Borrowing_Request r JOIN Laboratory l ON l.laboratory_id = r.laboratory_id
      WHERE r.requester_id = ? AND r.status IN ('Pending','Approved','Released','Overdue') ORDER BY r.expected_return_date LIMIT 6`, ctx.user.id)
      .map((r) => ({ ...r, code: codes.request(r.id, r.requestDate) }));
    return out;
  }

  const items = labFilter(ctx, 'i.laboratory_id', labId);
  const assets = labFilter(ctx, 'a.laboratory_id', labId);
  const reqs = labFilter(ctx, 'r.laboratory_id', labId);
  const labs = labFilter(ctx, 'l.laboratory_id', labId);
  out.kind = ctx.user.isGlobal ? 'school' : 'laboratory';
  out.metrics = {
    totalItems: one(`SELECT COUNT(*) n FROM Inventory_Item i WHERE i.status='Active' AND ${items.sql}`, ...items.params).n,
    totalAssets: one(`SELECT COUNT(*) n FROM Asset a WHERE a.status NOT IN ('Lost','Retired') AND ${assets.sql}`, ...assets.params).n,
    availableAssets: one(`SELECT COUNT(*) n FROM Asset a WHERE a.status = 'Available' AND ${assets.sql}`, ...assets.params).n,
    lowStock: one(`SELECT COUNT(*) n FROM Inventory_Item i WHERE i.status='Active' AND i.quantity <= i.minimum_stock_level AND ${items.sql}`, ...items.params).n,
    underMaintenance: one(`SELECT COUNT(*) n FROM Asset a WHERE a.status = 'Under Maintenance' AND ${assets.sql}`, ...assets.params).n,
    pendingRequests: one(`SELECT COUNT(*) n FROM Borrowing_Request r WHERE r.status='Pending' AND ${reqs.sql}`, ...reqs.params).n,
    overdueReturns: one(`SELECT COUNT(*) n FROM Borrowing_Request r WHERE r.status='Overdue' AND ${reqs.sql}`, ...reqs.params).n,
    openRequests: one(`SELECT COUNT(*) n FROM Borrowing_Request r WHERE r.status IN ('Pending','Approved','Released','Overdue') AND ${reqs.sql}`, ...reqs.params).n,
    openMaintenance: one(`SELECT COUNT(*) n FROM Maintenance_Record m JOIN Asset a ON a.asset_id = m.asset_id WHERE m.maintenance_status <> 'Completed' AND ${assets.sql}`, ...assets.params).n,
  };
  out.attention = [
    ...all(`SELECT i.item_id id, i.item_name name, l.name laboratoryName, i.quantity, i.unit_of_measurement unit, i.minimum_stock_level minimum
            FROM Inventory_Item i JOIN Laboratory l ON l.laboratory_id = i.laboratory_id WHERE i.status='Active' AND i.quantity <= i.minimum_stock_level AND ${items.sql}
            ORDER BY i.quantity - i.minimum_stock_level LIMIT 6`, ...items.params).map((r) => ({ type: 'low-stock', ...r, code: codes.item(r.id) })),
    ...all(`SELECT m.maintenance_id id, a.asset_tag tag, a.asset_id assetId, i.item_name name, m.reported_issue issue, l.name laboratoryName
            FROM Maintenance_Record m JOIN Asset a ON a.asset_id = m.asset_id JOIN Inventory_Item i ON i.item_id = a.item_id JOIN Laboratory l ON l.laboratory_id = a.laboratory_id
            WHERE m.maintenance_status <> 'Completed' AND ${assets.sql} ORDER BY m.maintenance_id DESC LIMIT 6`, ...assets.params).map((r) => ({ type: 'maintenance', ...r, code: codes.maintenance(r.id) })),
    ...all(`SELECT r.request_id id, r.request_date requestDate, r.expected_return_date due, rq.first_name || ' ' || rq.last_name requester, l.name laboratoryName
            FROM Borrowing_Request r JOIN "User" rq ON rq.user_id = r.requester_id JOIN Laboratory l ON l.laboratory_id = r.laboratory_id
            WHERE r.status = 'Overdue' AND ${reqs.sql} ORDER BY r.expected_return_date LIMIT 6`, ...reqs.params).map((r) => ({ type: 'overdue', ...r, code: codes.request(r.id, r.requestDate) })),
    ...all(`SELECT r.request_id id, r.request_date requestDate, rq.first_name || ' ' || rq.last_name requester, r.purpose, l.name laboratoryName
            FROM Borrowing_Request r JOIN "User" rq ON rq.user_id = r.requester_id JOIN Laboratory l ON l.laboratory_id = r.laboratory_id
            WHERE r.status = 'Pending' AND ${reqs.sql} ORDER BY r.request_id LIMIT 6`, ...reqs.params).map((r) => ({ type: 'pending', ...r, code: codes.request(r.id, r.requestDate) })),
  ];
  out.readiness = readiness(labs.sql, labs.params);
  out.recentActivity = can(ctx, P.AUDIT_VIEW) ? auditList(ctx, { laboratoryId: labId }).slice(0, 6) : [];
  return out;
}

export function notifications(ctx) {
  sweepOverdue();
  const list = [];
  if (can(ctx, P.BORROW_VIEW_ALL)) {
    const reqs = labFilter(ctx, 'r.laboratory_id', null), items = labFilter(ctx, 'i.laboratory_id', null), assets = labFilter(ctx, 'a.laboratory_id', null);
    const n = (sql, p) => one(sql, ...p).n;
    const overdue = n(`SELECT COUNT(*) n FROM Borrowing_Request r WHERE r.status='Overdue' AND ${reqs.sql}`, reqs.params);
    const pending = n(`SELECT COUNT(*) n FROM Borrowing_Request r WHERE r.status='Pending' AND ${reqs.sql}`, reqs.params);
    const confirmed = n(`SELECT COUNT(*) n FROM Borrowing_Request r WHERE r.status IN ('Released','Overdue') AND r.return_confirmed_at IS NOT NULL AND ${reqs.sql}`, reqs.params);
    const low = n(`SELECT COUNT(*) n FROM Inventory_Item i WHERE i.status='Active' AND i.quantity <= i.minimum_stock_level AND ${items.sql}`, items.params);
    const maint = n(`SELECT COUNT(*) n FROM Maintenance_Record m JOIN Asset a ON a.asset_id=m.asset_id WHERE m.maintenance_status <> 'Completed' AND ${assets.sql}`, assets.params);
    if (overdue) list.push({ id: 'overdue', severity: 'urgent', icon: 'clipboard', title: `${overdue} overdue return${overdue > 1 ? 's' : ''}`, text: 'Borrowed items are past their expected return date.', link: '#/requests?status=Overdue' });
    if (confirmed) list.push({ id: 'confirmed', severity: 'info', icon: 'clipboard', title: `${confirmed} borrower${confirmed > 1 ? 's' : ''} returning items`, text: 'Teachers confirmed they are bringing items back — check them in.', link: '#/requests?status=Released' });
    if (pending && can(ctx, P.BORROW_APPROVE)) list.push({ id: 'pending', severity: 'info', icon: 'clipboard', title: `${pending} request${pending > 1 ? 's' : ''} awaiting approval`, text: 'Review and approve or reject.', link: '#/requests?status=Pending' });
    if (low) list.push({ id: 'low', severity: 'urgent', icon: 'box', title: `${low} item${low > 1 ? 's' : ''} at or below minimum stock`, text: 'Consider reordering soon.', link: '#/inventory?availability=low' });
    if (maint) list.push({ id: 'maint', severity: 'warn', icon: 'wrench', title: `${maint} open maintenance record${maint > 1 ? 's' : ''}`, text: 'Equipment is offline until maintenance is completed.', link: '#/maintenance' });
  } else {
    const rows = all(`SELECT r.request_id id, r.request_date requestDate, r.status, r.approval_reason reason, r.expected_return_date due FROM Borrowing_Request r
      WHERE r.requester_id = ? AND r.status IN ('Approved','Rejected','Overdue') ORDER BY r.request_id DESC LIMIT 8`, ctx.user.id);
    for (const r of rows) {
      const code = codes.request(r.id, r.requestDate);
      list.push({
        id: `${r.status}-${r.id}`, severity: r.status === 'Approved' ? 'info' : 'urgent', icon: 'clipboard', link: '#/requests',
        title: r.status === 'Approved' ? `${code} was approved` : r.status === 'Rejected' ? `${code} was rejected` : `${code} is overdue`,
        text: r.status === 'Overdue' ? `Please return the items — they were due ${r.due}.` : r.reason || (r.status === 'Approved' ? 'Collect the items from the laboratory.' : ''),
      });
    }
  }
  return list;
}
