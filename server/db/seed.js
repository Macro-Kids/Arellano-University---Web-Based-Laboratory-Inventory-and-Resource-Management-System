// -----------------------------------------------------------------------------
// seed.js — demo dataset (development / evaluation only; see SEED_DEMO in .env).
// Mirrors the original static prototype (Dr. Maria Santos, Science + TLE labs,
// microscopes, the overdue request …) but with REAL relationships:
//   * dates are relative to "today", so the demo always looks current
//   * every quantity has a matching ledger (Inventory_Transaction) history
//   * every asset has a unique tag (MIC-003 …) and a consistent status
//   * audit history is written for every seeded action
// The integrity checker runs at the end; seeding fails loudly if anything is off.
// -----------------------------------------------------------------------------
import { config } from '../config.js';
import { hashPasswordSync } from '../lib/password.js';
import { addDays, todayLocal } from '../lib/time.js';
import { checkIntegrity } from './integrity.js';

export const hasDemoData = (db) => !!db.prepare('SELECT 1 FROM Laboratory LIMIT 1').get();

export function seedDemo(db) {
  const pw = hashPasswordSync(config.demoPassword);
  const at = (daysAgo, hour = 1) => { const d = new Date(); d.setUTCHours(hour, 15, 0, 0); d.setUTCDate(d.getUTCDate() - daysAgo); return d.toISOString(); };
  const dateOf = (daysAgo) => addDays(todayLocal(), -daysAgo);
  const events = [];                       // audit events, inserted chronologically at the end
  const audit = (when, userId, action, entity, recordId, labId, previous, next, reason) =>
    events.push({ when, userId, action, entity, recordId, labId, previous: previous ? JSON.stringify(previous) : null, next: next ? JSON.stringify(next) : null, reason: reason ?? null });

  db.transaction(() => {
    const roleId = (n) => db.prepare('SELECT role_id id FROM "Role" WHERE role_name = ?').get(n).id;
    const catId = (n) => db.prepare('SELECT category_id id FROM Category WHERE name = ?').get(n).id;

    // ---- laboratories ---------------------------------------------------------------
    const insLab = db.prepare('INSERT INTO Laboratory (name, type, location, description, status, created_at) VALUES (?,?,?,?,?,?)');
    const sci = Number(insLab.run('Science Laboratory', 'Science', 'St. Jose Building · Room 204', 'Junior High School Science Laboratory', 'Operational', at(400)).lastInsertRowid);
    const tle = Number(insLab.run('TLE Laboratory', 'Technology & Livelihood Education', 'St. Jose Building · Room 108', 'Junior High School TLE Laboratory', 'Operational', at(400)).lastInsertRowid);

    // ---- users (same demo password for all; see README) ------------------------------------
    const insUser = db.prepare(`INSERT INTO "User" (role_id, username, password_hash, first_name, last_name, email, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`);
    const insUL = db.prepare('INSERT INTO User_Laboratory (user_id, laboratory_id) VALUES (?,?)');
    const mk = (role, username, first, last, email, labs, status = 'Active') => {
      const id = Number(insUser.run(roleId(role), username, pw, first, last, email, status, at(380), at(380)).lastInsertRowid);
      for (const l of labs) insUL.run(id, l);
      return id;
    };
    const admin = mk('System Administrator', config.adminUsername, 'Ricardo', 'Bautista', 'ricardo.bautista@arellano.edu.ph', []);
    const maria = mk('Laboratory Coordinator', 'msantos', 'Maria', 'Santos', 'maria.santos@arellano.edu.ph', [sci, tle]);
    const elena = mk('Laboratory Coordinator', 'ecruz', 'Elena', 'Cruz', 'elena.cruz@arellano.edu.ph', [tle]);
    const ramon = mk('Laboratory Staff', 'rvillanueva', 'Ramon', 'Villanueva', 'ramon.villanueva@arellano.edu.ph', [sci, tle]);
    const anna = mk('Teacher', 'areyes', 'Anna', 'Reyes', 'anna.reyes@arellano.edu.ph', [sci]);
    const carla = mk('Teacher', 'clim', 'Carla', 'Lim', 'carla.lim@arellano.edu.ph', [sci]);
    const paulo = mk('Teacher', 'pdizon', 'Paulo', 'Dizon', 'paulo.dizon@arellano.edu.ph', [tle]);
    const noel = mk('Teacher', 'ngarcia', 'Noel', 'Garcia', 'noel.garcia@arellano.edu.ph', [tle]);
    mk('Laboratory Staff', 'jmendoza', 'J.', 'Mendoza', 'j.mendoza@arellano.edu.ph', [tle], 'Inactive');
    audit(at(380), admin, 'User created', 'User', maria, null, null, { username: 'msantos', role: 'Laboratory Coordinator' });

    // ---- ledger helper (keeps quantity == SUM(ledger)) ---------------------------------------------
    const insTrx = db.prepare(`INSERT INTO Inventory_Transaction (item_id, user_id, transaction_type, quantity, transaction_date, reason, source, remarks, balance_after) VALUES (?,?,?,?,?,?,?,?,?)`);
    const post = (itemId, userId, type, delta, when, reason, source = null, remarks = null) => {
      const cur = db.prepare('SELECT quantity q FROM Inventory_Item WHERE item_id = ?').get(itemId).q;
      const next = Math.round((cur + delta) * 100) / 100;
      db.prepare('UPDATE Inventory_Item SET quantity = ?, updated_at = ? WHERE item_id = ?').run(next, when, itemId);
      insTrx.run(itemId, userId, type, delta, when, reason, source, remarks, next);
    };

    // ---- items & assets ------------------------------------------------------------------------------
    const insItem = db.prepare(`INSERT INTO Inventory_Item (item_name, description, category_id, laboratory_id, item_type, unit_of_measurement, quantity, minimum_stock_level, "condition",
      location, acquisition_date, acquisition_source, remarks, status, created_at, updated_at, asset_prefix) VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?, 'Active', ?, ?, ?)`);
    const insAsset = db.prepare(`INSERT INTO Asset (item_id, laboratory_id, asset_tag, serial_number, status, "condition", remarks, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`);
    const labCode = new Map([[sci, 'SCI'], [tle, 'TLE']]);
    const assetsByTag = {};
    const addItem = (o) => {
      const when = `${o.acq}T01:15:00.000Z`;
      const id = Number(insItem.run(o.name, o.desc, catId(o.cat), o.lab, o.type, o.unit, o.min, o.cond, o.loc, o.acq, o.src, o.remarks ?? null, when, when, o.prefix ?? null).lastInsertRowid);
      audit(when, o.by ?? maria, 'Inventory created', 'Inventory Item', id, o.lab, null, { name: o.name, itemType: o.type, quantity: o.qty }, null);
      if (o.type === 'Equipment') addAssets(id, o, o.qty, 1, when);
      else if (o.qty > 0) post(id, o.by ?? maria, 'Stock-in', o.qty, when, 'Opening balance', o.src);
      return id;
    };
    const addAssets = (itemId, o, count, startNo, when) => {
      for (let n = startNo; n < startNo + count; n++) {
        const tag = `${o.prefix}-${String(n).padStart(3, '0')}`;
        const id = Number(insAsset.run(itemId, o.lab, tag, `AU-${labCode.get(o.lab)}-${tag}`, 'Available', o.cond === 'Fair' ? 'Fair' : 'Good', null, when, when).lastInsertRowid);
        assetsByTag[tag] = id;
        audit(when, maria, 'Asset registered', 'Asset', id, o.lab, null, { tag, item: o.name }, 'Initial registration');
      }
      post(itemId, maria, 'Stock-in', count, when, startNo === 1 ? 'Initial registration' : 'New procurement delivery', o.src);
    };

    const microscope = addItem({ name: 'Digital Compound Microscope', desc: 'Binocular microscope with LED illumination', cat: 'Laboratory Equipment', lab: sci, type: 'Equipment', unit: 'unit', qty: 12, min: 4, cond: 'Good', loc: 'Science Lab · Instrument cabinet A', acq: '2024-06-18', src: 'University procurement', remarks: 'Calibration due in September', prefix: 'MIC' });
    const filter = addItem({ name: 'Filter Paper No. 1', desc: '11 cm qualitative filter paper', cat: 'Consumables', lab: sci, type: 'Consumable', unit: 'pack', qty: 12, min: 12, cond: 'Good', loc: 'Science Lab · Supply shelf 2', acq: '2025-01-12', src: 'JFE Scientific', remarks: 'Reorder before next term' });
    const beaker = addItem({ name: 'Borosilicate Beaker Set', desc: '50–500 ml graduated glassware set', cat: 'Glassware', lab: sci, type: 'Consumable', unit: 'set', qty: 24, min: 10, cond: 'Good', loc: 'Science Lab · Glassware bay', acq: '2024-03-14', src: 'LabMart Philippines', remarks: 'Count after each practical' });
    addItem({ name: 'Copper Sulfate Pentahydrate', desc: 'Laboratory reagent, ACS grade', cat: 'Chemicals', lab: sci, type: 'Consumable', unit: 'bottle', qty: 3, min: 2, cond: 'Good', loc: 'Science Lab · Chemical cabinet C', acq: '2024-11-02', src: 'ChemSource', remarks: 'Controlled access' });
    const goggles = addItem({ name: 'Safety Goggles', desc: 'Anti-fog splash resistant eye protection', cat: 'Safety Equipment', lab: sci, type: 'Consumable', unit: 'unit', qty: 38, min: 24, cond: 'Good', loc: 'Science Lab · PPE rack', acq: '2024-07-20', src: 'Safety First' });
    addItem({ name: 'Digital Weighing Scale', desc: '0.01 g precision balance', cat: 'Measuring Instruments', lab: sci, type: 'Equipment', unit: 'unit', qty: 4, min: 2, cond: 'Good', loc: 'Science Lab · Instrument cabinet B', acq: '2024-02-02', src: 'LabMart Philippines', prefix: 'WS' });

    const solder = addItem({ name: 'Soldering Iron 60W', desc: 'Temperature-controlled soldering iron', cat: 'Power Tools', lab: tle, type: 'Equipment', unit: 'unit', qty: 12, min: 6, cond: 'Good', loc: 'TLE Lab · Electronics wall', acq: '2023-08-22', src: 'TechEd Supplies', remarks: 'Store with stand', prefix: 'SOL' });
    const sewing = addItem({ name: 'Portable Sewing Machine', desc: 'Mechanical sewing machine for textile activities', cat: 'Sewing Equipment', lab: tle, type: 'Equipment', unit: 'unit', qty: 10, min: 3, cond: 'Fair', loc: 'TLE Lab · Textile bay', acq: '2022-09-05', src: 'School facilities', remarks: 'Two units awaiting inspection', prefix: 'SEW' });
    const meter = addItem({ name: 'Digital Multimeter', desc: 'Bench multimeter for basic electronics', cat: 'Measuring Instruments', lab: tle, type: 'Equipment', unit: 'unit', qty: 8, min: 4, cond: 'Fair', loc: 'TLE Lab · Electronics cabinet', acq: '2023-10-16', src: 'TechEd Supplies', remarks: 'Lead probes replaced recently', prefix: 'DMM' });
    const glasses = addItem({ name: 'Safety Glasses', desc: 'Impact-resistant eye protection', cat: 'Safety Equipment', lab: tle, type: 'Consumable', unit: 'unit', qty: 24, min: 12, cond: 'Good', loc: 'TLE Lab · PPE rack', acq: '2024-07-20', src: 'Safety First', by: elena });
    addItem({ name: 'Cotton Thread Spool', desc: 'Assorted colours, 500 m spools', cat: 'Raw Materials', lab: tle, type: 'Consumable', unit: 'spool', qty: 40, min: 15, cond: 'Good', loc: 'TLE Lab · Textile bay', acq: '2025-02-10', src: 'Fabric Depot', by: elena });
    addItem({ name: 'Electrical Tape', desc: 'PVC insulation tape, black', cat: 'Electrical Components', lab: tle, type: 'Consumable', unit: 'roll', qty: 6, min: 10, cond: 'Good', loc: 'TLE Lab · Electronics cabinet', acq: '2025-03-01', src: 'TechEd Supplies', by: elena });

    // later stock movements (ledger history)
    post(filter, maria, 'Stock-out', -4, at(2), 'Consumption', null, 'Grade 9 Biology practical');
    audit(at(2), maria, 'Stock-out', 'Inventory Item', filter, sci, { quantity: 12 }, { quantity: 8 }, 'Consumption');
    post(goggles, maria, 'Adjustment', -2, at(14), 'Damaged beyond use', null, 'Physical count 36');
    audit(at(14), maria, 'Stock adjusted', 'Inventory Item', goggles, sci, { quantity: 38 }, { quantity: 36 }, 'Damaged beyond use');

    // ---- extra procurement for soldering irons (6 new assets 11 days ago) ------------------------
    addAssets(solder, { name: 'Soldering Iron 60W', lab: tle, prefix: 'SOL', cond: 'Good', src: 'TechEd Supplies' }, 6, 13, at(11));

    // ---- helpers for workflow data ----------------------------------------------------------------------
    const A = (tag) => assetsByTag[tag];
    const setAsset = (tag, status, cond, when, reason, by = maria) => {
      const row = db.prepare('SELECT status s, "condition" c, laboratory_id l FROM Asset WHERE asset_id = ?').get(A(tag));
      db.prepare('UPDATE Asset SET status = ?, "condition" = ?, updated_at = ? WHERE asset_id = ?').run(status, cond, when, A(tag));
      audit(when, by, status !== row.s ? 'Asset status changed' : 'Asset condition changed', 'Asset', A(tag), row.l,
        { tag, ...(status !== row.s ? { status: row.s } : {}), ...(cond !== row.c ? { condition: row.c } : {}) },
        { ...(status !== row.s ? { status } : {}), ...(cond !== row.c ? { condition: cond } : {}) }, reason);
    };
    const insReq = db.prepare(`INSERT INTO Borrowing_Request (requester_id, laboratory_id, purpose, request_date, expected_return_date, status, approved_by, approval_date, approval_reason, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,NULL)`);
    const insReqItem = db.prepare('INSERT INTO Borrowing_Request_Item (request_id, item_id, requested_quantity, remarks) VALUES (?,?,?,NULL)');
    const insRel = db.prepare('INSERT INTO "Release" (request_id, released_by, release_date, remarks) VALUES (?,?,?,?)');
    const insRelItem = db.prepare('INSERT INTO Release_Item (release_id, item_id, asset_id, quantity_released, remarks) VALUES (?,?,?,?,NULL)');
    const insRet = db.prepare('INSERT INTO "Return" (request_id, processed_by, return_date, remarks) VALUES (?,?,?,?)');
    const insRetItem = db.prepare(`INSERT INTO Return_Item (return_id, item_id, asset_id, quantity_returned, missing_quantity, damaged_quantity, "condition", remarks) VALUES (?,?,?,?,0,0,?,NULL)`);
    const reqYear = (iso) => iso.slice(0, 4);
    const code = (id, iso) => `BR-${reqYear(iso)}-${String(id).padStart(4, '0')}`;

    // ---- R1 · RETURNED (history): Noel Garcia, 3 sewing machines ------------------------------------------------------
    {
      const t0 = at(24), tApprove = at(23), tRel = at(23, 2), tRet = at(18);
      const id = Number(insReq.run(noel, tle, 'Textile construction activity', t0, dateOf(17), 'Returned', maria, tApprove, 'Equipment available').lastInsertRowid);
      insReqItem.run(id, sewing, 3);
      audit(t0, noel, 'Request submitted', 'Borrowing Request', id, tle, null, { purpose: 'Textile construction activity', items: 1 });
      audit(tApprove, maria, 'Request approved', 'Borrowing Request', id, tle, { status: 'Pending' }, { status: 'Approved' }, 'Equipment available');
      const rel = Number(insRel.run(id, ramon, tRel, null).lastInsertRowid);
      for (const tag of ['SEW-001', 'SEW-002', 'SEW-003']) { insRelItem.run(rel, sewing, A(tag), 1); setAsset(tag, 'Borrowed', 'Fair', tRel, `Released for ${code(id, t0)}`, ramon); }
      audit(tRel, ramon, 'Items released', 'Borrowing Request', id, tle, { status: 'Approved' }, { status: 'Released' });
      const ret = Number(insRet.run(id, ramon, tRet, null).lastInsertRowid);
      for (const tag of ['SEW-001', 'SEW-002', 'SEW-003']) { insRetItem.run(ret, sewing, A(tag), 1, 'Fair'); setAsset(tag, 'Available', 'Fair', tRet, `Returned: ${code(id, t0)}`, ramon); }
      audit(tRet, ramon, 'Items returned', 'Borrowing Request', id, tle, { status: 'Released' }, { status: 'Returned', returned: 3, damaged: 0, missing: 0, complete: true });
    }
    // ---- R5 · REJECTED: Anna Reyes asked for 30 beaker sets ----------------------------------------------------------------
    {
      const t0 = at(9), tDec = at(9, 3);
      const id = Number(insReq.run(anna, sci, 'Grade 10 Chemistry · titration practical', t0, dateOf(5), 'Rejected', maria, tDec, 'Not available for requested date').lastInsertRowid);
      insReqItem.run(id, beaker, 20);
      audit(t0, anna, 'Request submitted', 'Borrowing Request', id, sci, null, { purpose: 'Grade 10 Chemistry · titration practical', items: 1 });
      audit(tDec, maria, 'Request rejected', 'Borrowing Request', id, sci, { status: 'Pending' }, { status: 'Rejected' }, 'Not available for requested date');
    }
    // ---- R2 · OVERDUE: Carla Lim, 2 microscopes (MIC-001/002 still out) ---------------------------------------------------------
    {
      const t0 = at(18), tApprove = at(17), tRel = at(14, 2);
      const id = Number(insReq.run(carla, sci, 'Chemistry demonstration', t0, dateOf(3), 'Overdue', maria, tApprove, 'Equipment available').lastInsertRowid);
      insReqItem.run(id, microscope, 2);
      audit(t0, carla, 'Request submitted', 'Borrowing Request', id, sci, null, { purpose: 'Chemistry demonstration', items: 1 });
      audit(tApprove, maria, 'Request approved', 'Borrowing Request', id, sci, { status: 'Pending' }, { status: 'Approved' }, 'Equipment available');
      const rel = Number(insRel.run(id, ramon, tRel, null).lastInsertRowid);
      for (const tag of ['MIC-001', 'MIC-002']) { insRelItem.run(rel, microscope, A(tag), 1); setAsset(tag, 'Borrowed', 'Good', tRel, `Released for ${code(id, t0)}`, ramon); }
      audit(tRel, ramon, 'Items released', 'Borrowing Request', id, sci, { status: 'Approved' }, { status: 'Released' });
      audit(at(2, 16), 1, 'Request marked overdue', 'Borrowing Request', id, sci, { status: 'Released' }, { status: 'Overdue' }, 'Expected return date has passed');
    }
    // ---- R3 · APPROVED (awaiting release): Paulo Dizon, 12 soldering irons + 12 safety glasses --------------------------------------
    {
      const t0 = at(4), tApprove = at(3, 3);
      const id = Number(insReq.run(paulo, tle, 'Basic electronics practical', t0, dateOf(-3), 'Approved', elena, tApprove, 'Equipment available').lastInsertRowid);
      insReqItem.run(id, solder, 12); insReqItem.run(id, glasses, 12);
      audit(t0, paulo, 'Request submitted', 'Borrowing Request', id, tle, null, { purpose: 'Basic electronics practical', items: 2 });
      audit(tApprove, elena, 'Request approved', 'Borrowing Request', id, tle, { status: 'Pending' }, { status: 'Approved' }, 'Equipment available');
    }
    // ---- R4 · PENDING: Anna Reyes, 4 microscopes ---------------------------------------------------------------------------------------------------------
    {
      const t0 = at(1, 6);
      const id = Number(insReq.run(anna, sci, 'Grade 9 Biology · Cell observation', t0, dateOf(-5), 'Pending', null, null, null).lastInsertRowid);
      insReqItem.run(id, microscope, 4);
      audit(t0, anna, 'Request submitted', 'Borrowing Request', id, sci, null, { purpose: 'Grade 9 Biology · Cell observation', items: 1, expectedReturnDate: dateOf(-5) });
    }

    // ---- maintenance & damage ------------------------------------------------------------------------------------------------------------------------
    const insMnt = db.prepare(`INSERT INTO Maintenance_Record (asset_id, reported_issue, date_reported, maintenance_action, responsible_person, date_completed, maintenance_status, remarks) VALUES (?,?,?,?,?,?,?,NULL)`);
    {
      const t = at(5, 2);
      const id = Number(insMnt.run(A('MIC-003'), 'Illumination flickers at high magnification', t, 'Replace LED driver and recalibrate', 'R. Villanueva', null, 'Open').lastInsertRowid);
      audit(t, ramon, 'Maintenance logged', 'Maintenance Record', id, sci, null, { asset: 'MIC-003', issue: 'Illumination flickers at high magnification' });
      setAsset('MIC-003', 'Under Maintenance', 'Fair', t, 'Maintenance logged: Illumination flickers at high magnification', ramon);
    }
    {
      const t = at(9, 2);
      const id = Number(insMnt.run(A('DMM-005'), 'Display does not power on', t, 'Awaiting replacement fuse', 'J. Mendoza', null, 'In Progress').lastInsertRowid);
      audit(t, maria, 'Maintenance logged', 'Maintenance Record', id, tle, null, { asset: 'DMM-005', issue: 'Display does not power on' });
      setAsset('DMM-005', 'Under Maintenance', 'Non-functional', t, 'Maintenance logged: Display does not power on');
    }
    {
      const t = at(20, 2), done = at(17, 8);
      const id = Number(insMnt.run(A('SEW-008'), 'Needle alignment inconsistent', t, 'Cleaned and adjusted timing', 'R. Villanueva', done, 'Completed').lastInsertRowid);
      audit(t, ramon, 'Maintenance logged', 'Maintenance Record', id, tle, null, { asset: 'SEW-008', issue: 'Needle alignment inconsistent' });
      audit(done, ramon, 'Maintenance completed', 'Maintenance Record', id, tle, { status: 'Open' }, { status: 'Completed', assetStatus: 'Available', assetCondition: 'Good' }, 'Cleaned and adjusted timing');
      setAsset('SEW-008', 'Available', 'Good', done, 'Maintenance completed: Cleaned and adjusted timing', ramon);
    }
    setAsset('SEW-004', 'Under Inspection', 'Fair', at(6), 'Scheduled inspection', ramon);
    setAsset('SEW-009', 'Under Inspection', 'Fair', at(6), 'Scheduled inspection', ramon);
    {
      const t = at(7, 4);
      const id = Number(db.prepare(`INSERT INTO Damage_Loss_Record (item_id, asset_id, record_type, date_recorded, description, reported_by, current_condition, action_taken, remarks, quantity)
        VALUES (?,?,?,?,?,?,?,?,NULL,1)`).run(solder, A('SOL-016'), 'Damage', t, 'Heating element burnt out during practical', ramon, 'Damaged', 'Set aside for repair quote').lastInsertRowid);
      audit(t, ramon, 'Damage recorded', 'Damage/Loss Record', id, tle, null, { assetId: A('SOL-016'), description: 'Heating element burnt out during practical' }, 'Set aside for repair quote');
      setAsset('SOL-016', 'Damaged', 'Damaged', t, 'Heating element burnt out during practical', ramon);
    }

    // ---- audit flush (chronological so audit_id order == time order) ---------------------------------------------------------------------------------------------------
    const insAudit = db.prepare(`INSERT INTO Audit_Log (user_id, "timestamp", action, affected_entity, record_id, previous_value, new_value, reason, laboratory_id) VALUES (?,?,?,?,?,?,?,?,?)`);
    events.sort((a, b) => a.when.localeCompare(b.when));
    for (const e of events) insAudit.run(e.userId, e.when, e.action, e.entity, e.recordId, e.previous, e.next, e.reason, e.labId);
  })();

  // Equipment quantity = owned assets: re-sync (seed edits statuses directly) then verify everything.
  const result = checkIntegrity(db);
  if (!result.ok) throw new Error('Demo seed is inconsistent:\n' + result.issues.map((i) => ` - ${i.message}`).join('\n'));
  return result;
}
