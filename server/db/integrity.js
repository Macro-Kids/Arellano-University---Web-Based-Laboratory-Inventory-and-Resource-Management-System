// -----------------------------------------------------------------------------
// integrity.js — verifies the invariants the application promises (DIR-001).
// Run via:  npm run db:check     |    GET /api/system/integrity (admin)
// and automatically after seeding and in the test-suite. Returns a list of
// human-readable problems; an empty list means the data is consistent.
// -----------------------------------------------------------------------------
const rows = (db, sql) => db.prepare(sql).all();

export function checkIntegrity(db) {
  const issues = [];
  const add = (check, message, ref) => issues.push({ check, message, ...(ref ? { ref } : {}) });
  let checks = 0;
  const run = (name, sql, fmt) => { checks++; for (const r of rows(db, sql)) add(name, fmt(r), r); };

  checks++;
  const sqliteIntegrity = db.pragma('integrity_check', { simple: true });
  if (sqliteIntegrity !== 'ok') add('sqlite.integrity_check', String(sqliteIntegrity));
  checks++;
  for (const r of db.pragma('foreign_key_check')) add('sqlite.foreign_key_check', `Row in ${r.table} references a missing ${r.parent}`, r);

  run('quantity.non_negative', `SELECT item_id id, item_name name, quantity FROM Inventory_Item WHERE quantity < 0`,
    (r) => `Item #${r.id} “${r.name}” has negative quantity ${r.quantity}`);
  run('ledger.matches_quantity', `
    SELECT i.item_id id, i.item_name name, i.quantity, IFNULL(SUM(t.quantity),0) ledger FROM Inventory_Item i
    LEFT JOIN Inventory_Transaction t ON t.item_id = i.item_id GROUP BY i.item_id HAVING ABS(i.quantity - IFNULL(SUM(t.quantity),0)) > 0.005`,
    (r) => `Item #${r.id} “${r.name}”: quantity ${r.quantity} ≠ ledger total ${r.ledger}`);
  run('equipment.quantity_matches_assets', `
    SELECT i.item_id id, i.item_name name, i.quantity, (SELECT COUNT(*) FROM Asset a WHERE a.item_id=i.item_id AND a.status NOT IN ('Lost','Retired')) owned
    FROM Inventory_Item i WHERE i.item_type='Equipment' AND i.quantity <> (SELECT COUNT(*) FROM Asset a WHERE a.item_id=i.item_id AND a.status NOT IN ('Lost','Retired'))`,
    (r) => `Equipment #${r.id} “${r.name}”: quantity ${r.quantity} ≠ ${r.owned} owned assets`);
  run('asset.lab_matches_item', `SELECT a.asset_id id, a.asset_tag tag FROM Asset a JOIN Inventory_Item i ON i.item_id=a.item_id WHERE a.laboratory_id <> i.laboratory_id`,
    (r) => `Asset ${r.tag} is in a different laboratory than its item`);
  run('asset.only_for_equipment', `SELECT a.asset_id id, a.asset_tag tag FROM Asset a JOIN Inventory_Item i ON i.item_id=a.item_id WHERE i.item_type <> 'Equipment'`,
    (r) => `Asset ${r.tag} belongs to a non-equipment item`);
  run('asset.available_is_serviceable', `SELECT asset_id id, asset_tag tag FROM Asset WHERE status='Available' AND "condition" IN ('Damaged','Non-functional')`,
    (r) => `Asset ${r.tag} is Available but damaged/non-functional`);
  run('asset.maintenance_status_matches_record', `
    SELECT a.asset_id id, a.asset_tag tag FROM Asset a WHERE a.status='Under Maintenance'
      AND NOT EXISTS (SELECT 1 FROM Maintenance_Record m WHERE m.asset_id=a.asset_id AND m.maintenance_status <> 'Completed')`,
    (r) => `Asset ${r.tag} is Under Maintenance but has no open maintenance record`);
  run('maintenance.open_asset_status', `
    SELECT m.maintenance_id id, a.asset_tag tag, a.status FROM Maintenance_Record m JOIN Asset a ON a.asset_id=m.asset_id
    WHERE m.maintenance_status <> 'Completed' AND a.status <> 'Under Maintenance'`,
    (r) => `Open maintenance #${r.id}: asset ${r.tag} is ${r.status}, expected Under Maintenance`);
  run('asset.borrowed_has_open_release', `
    SELECT a.asset_id id, a.asset_tag tag FROM Asset a WHERE a.status='Borrowed' AND NOT EXISTS (
      SELECT 1 FROM Release_Item ri JOIN "Release" rl ON rl.release_id=ri.release_id JOIN Borrowing_Request r ON r.request_id=rl.request_id
      WHERE ri.asset_id=a.asset_id AND r.status IN ('Released','Overdue'))`,
    (r) => `Asset ${r.tag} is Borrowed but not held by any open request`);
  run('request.released_has_release', `
    SELECT r.request_id id, r.status FROM Borrowing_Request r WHERE r.status IN ('Released','Overdue','Returned')
      AND NOT EXISTS (SELECT 1 FROM "Release" rl WHERE rl.request_id=r.request_id)`,
    (r) => `Request #${r.id} is ${r.status} but has no release record`);
  run('request.approved_before_release', `
    SELECT r.request_id id FROM Borrowing_Request r WHERE EXISTS (SELECT 1 FROM "Release" rl WHERE rl.request_id=r.request_id) AND r.approved_by IS NULL`,
    (r) => `Request #${r.id} was released without approval (BR-006)`);
  run('return.not_exceeding_release', `
    SELECT r.request_id id, ri.item_id itemId,
      (SELECT IFNULL(SUM(x.quantity_released),0) FROM Release_Item x JOIN "Release" rl ON rl.release_id=x.release_id WHERE rl.request_id=r.request_id AND x.item_id=ri.item_id) rel,
      (SELECT IFNULL(SUM(y.quantity_returned + y.missing_quantity),0) FROM Return_Item y JOIN "Return" t ON t.return_id=y.return_id WHERE t.request_id=r.request_id AND y.item_id=ri.item_id) ret
    FROM Borrowing_Request r JOIN Borrowing_Request_Item ri ON ri.request_id=r.request_id WHERE ret > rel + 0.005`,
    (r) => `Request #${r.id}, item #${r.itemId}: returned+missing ${r.ret} exceeds released ${r.rel}`);
  run('request.returned_is_complete', `
    SELECT r.request_id id,
      (SELECT IFNULL(SUM(x.quantity_released),0) FROM Release_Item x JOIN "Release" rl ON rl.release_id=x.release_id WHERE rl.request_id=r.request_id) rel,
      (SELECT IFNULL(SUM(y.quantity_returned + y.missing_quantity),0) FROM Return_Item y JOIN "Return" t ON t.return_id=y.return_id WHERE t.request_id=r.request_id) ret
    FROM Borrowing_Request r WHERE r.status='Returned' AND ABS(rel - ret) > 0.005`,
    (r) => `Request #${r.id} is Returned but ${r.rel} released vs ${r.ret} accounted for`);
  run('user.active_admin_exists', `SELECT 1 x WHERE (SELECT COUNT(*) FROM "User" u JOIN "Role" r ON r.role_id=u.role_id WHERE r.role_name='System Administrator' AND u.status='Active') = 0`,
    () => 'No active System Administrator exists');
  checks++;
  const triggers = db.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_%'`).get().n;
  if (triggers < 12) add('schema.immutability_triggers', `Expected 12 immutability triggers, found ${triggers}`);

  return { ok: issues.length === 0, checks, issues, checkedAt: new Date().toISOString() };
}
