# Where this differs from (or extends) the design documents — and why

Nothing in your documents was changed; `development/` is untouched. These are the decisions made while building.
Each one is deliberate, small, and listed so you can approve or reverse it.

## 1. Database: SQLite instead of MySQL (as requested)
Same 17 tables, same table/column names, same relationships. Dialect changes only: `AUTOINCREMENT`, `CHECK` constraints for enumerations,
ISO-8601 text for `DATETIME`/`DATE`, tables named `"User"`, `"Role"`, `"Release"`, `"Return"` are quoted. Schema: `server/db/migrations/001_init.sql`
(its header lists every extension below). Moving to MySQL/Postgres later means re-implementing only `repo.js` files + migrations; services/routes/UI do not change.

## 2. Schema extensions (each marked `[EXT-n]` in the migration)
| # | Addition | Why |
|---|---|---|
| 1 | `Session` table | Server-side sessions (FR-001/SR-001). Stores a *hash* of the cookie token. |
| 2 | `Asset.asset_tag` (unique), `serial_number` | SRS §7.2 requires a human-readable unique Asset ID like `MIC-003`; the ERD only had a numeric key. |
| 3 | `Inventory_Item.asset_prefix` | Generates `MIC-001, MIC-002…` |
| 4 | `Inventory_Transaction.balance_after` | Running balance → ledger is auditable and checkable. |
| 5 | `Borrowing_Request.return_confirmed_at` | SRS §5.3: teachers "confirm or facilitate returns". |
| 6 | `Damage_Loss_Record.quantity` | Damage/loss of bulk items needs an amount. |
| 7 | `Audit_Log.laboratory_id` | Lets coordinators see only their laboratories' audit entries (BR-011). |
| 8 | `schema_migrations` | Safe, repeatable schema changes. |
| — | `Laboratory.name`, `Category.name`, `Asset.asset_tag` UNIQUE; unique active item name per lab | Prevents duplicates (BR-002 spirit). |
| — | DB triggers on audit/ledger/requests/releases/returns/incidents | Enforces BR-008 and FR-032 inside the database. |
| — | A `System` role and `system` user (cannot sign in) | Attributes automatic actions (overdue detection) in the audit log. |

## 3. Interpretations of ambiguous requirements
* **Inventory quantity.** `Equipment` = every unit is an individual Asset and quantity is *derived* from the asset register (SRS: "equipment that requires individual accountability shall be tracked separately").
  `Consumable` = tracked by quantity, and is also used for **bulk supplies such as goggles and beaker sets**. Quantity is never typed into an edit form (BR-007/FR-010) — it changes only through recorded movements.
  In the prototype some equipment (e.g. 12 microscopes) had only 2 assets; now each unit is registered, so counts can never disagree.
* **Stock-out of equipment** is expressed by changing an asset's status (Lost/Retired), which posts the ledger entry automatically.
* **Release/return of bulk items:** release = stock-out; return = stock-in of the undamaged part; damaged/missing quantities are written off with a Damage/Loss record.
* **Partial returns** are supported; a request becomes *Returned* only when every released unit is accounted for (returned or marked missing).
* **Overdue** is a stored status set automatically when the expected return date (local calendar day) has passed.
* **Approval roles.** FR-016 allows coordinators *or staff* to approve; both can. Nobody can approve their own request (separation of duties).
* **Administrator** can read inventory/requests/reports/audit system-wide and manage users, laboratories, categories and backups, but cannot move stock or file requests (SRS §5.1). Change this in `permissions.js` if your policy differs.
* **Laboratory readiness %** (dashboard) = usable equipment ÷ owned equipment; formula documented in `dashboard/service.js`.
* **Item condition** of equipment is derived from its assets (most common condition); consumables store their own.
* **Request lines** may only contain items from the request's laboratory (one request = one lab, as in the ERD).
* **Transfers** move *consumable/bulk* stock between laboratories (creating the destination item if needed). Equipment stays in its laboratory.

## 4. Deliberately not included (outside the SRS scope or explicitly future work)
* E-mail/SMS notifications — notifications are in-app and live. (FE-xxx future enhancement.)
* Barcode/QR scanning, forecasting/AI, mobile native app (SRS "future").
* PDF export — reports offer **print** (print-optimised CSS → "Save as PDF") and **CSV**.
* Self-service password reset by e-mail — administrators reset passwords (shown once). Users change their own in Settings.
* Restoring a backup from the web UI — intentionally a CLI operation with the server stopped (a mistaken click must not overwrite live data).
* Multi-server scaling — a single Node process with SQLite is the right size for a school lab system (see OPERATIONS.md).

## 5. Prototype features that changed
| Prototype | Now |
|---|---|
| Data in `localStorage`, "Reset demo data" button | Real database; reset is a CLI command (`npm run db:reset`) so it can't be clicked by accident |
| Quantity editable in the Edit form | Read-only; use *Move stock* (recorded, audited) |
| Inline status dropdown on assets | Status/condition dialog with a required reason; Damaged/Lost/Maintenance via their own workflows |
| Static notifications | Live notifications from the server |
| Lab switcher was decorative | Functional: scopes lists, dashboard, reports, audit |
| "Add laboratory — next release" | Implemented (Settings, administrators) |
