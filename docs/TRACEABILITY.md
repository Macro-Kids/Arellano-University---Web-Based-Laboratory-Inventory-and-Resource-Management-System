# SRS traceability — requirement → implementation → test

Test files: **A** `auth.test.js` · **I** `inventory.test.js` · **B** `borrowing.test.js` · **O** `operations.test.js` · **U** `ui.test.js` (all in `tests/`).

## Use cases
| UC | Where it lives | Tests |
|---|---|---|
| UC-001 Authenticate | `modules/auth/*`, `middleware/auth.js`, `pages/auth.js` | A, U |
| UC-002 Manage user | `modules/users/*`, `pages/users.js` | O, A |
| UC-003 Manage laboratory | `modules/laboratories/*`, Settings page | O |
| UC-004 Manage inventory | `modules/inventory/service.js` (create/update/archive/restore), `pages/inventory.js` | I, U |
| UC-005 Manage quantity | `inventory/ledger.js`, `service.moveStock` | I, U |
| UC-006 Equipment & assets | `modules/assets/*`, `assets/state.js`, `pages/assets.js` | I, O |
| UC-007 Search & filter | `inventory/repo.js → search()` (server-side) | I, U |
| UC-008 Create request | `borrowing/service.create` | B, U |
| UC-009 Approve / reject | `borrowing/service.approve/reject/cancel` | B, U |
| UC-010 Release | `borrowing/service.release` + `releasePlan` | B, U |
| UC-011 Return | `borrowing/service.processReturn`, `confirmReturn` | B, U |
| UC-012 Damage, loss, maintenance | `modules/damage/*`, `modules/maintenance/*` | O, B |
| UC-013 Reports | `modules/reports/*`, `pages/reports.js` | O, U |
| UC-014 Audit history | `modules/audit/*`, `audit/record.js`, `pages/audit.js` | O, I, U |
| UC-015 Dashboard | `modules/dashboard/service.js`, `pages/dashboard.js` | O, U |

## Functional requirements
| FR | Implementation |
|---|---|
| FR-001 authentication | `auth/service.login`, sessions in `Session` table |
| FR-002 user mgmt | `users/service` (roles, lab assignment, activate/deactivate, reset) |
| FR-003 RBAC | `auth/permissions.js` + `requirePermission` on routes + `lib/scope.js` |
| FR-004/005 register / modify item | `inventory/service.create/update` + `Inventory created/updated` audit |
| FR-006 archive | `service.archive/restore` (no delete; blocked while requests open) |
| FR-007 categories | `modules/categories/*` |
| FR-008/009/010 stock-in/out/adjust | `service.moveStock`; stock-out reasons Consumption/Damage/Loss/Disposal/Other; adjustment by physical count with reason + stale-screen guard |
| FR-011/012/013 asset, status, condition | `assets/*`; status and condition are separate fields |
| FR-014/015 request & statuses | `borrowing/service`; Overdue set by `sweepOverdue()` |
| FR-016 approve/reject | coordinators & staff; rejection needs a reason |
| FR-017/018 release / return | transactional; return records returned, missing, damaged, condition, date |
| FR-019/020 damage / loss | `damage/service` (asset: Damaged/Lost; bulk: stock-out + record) |
| FR-021/022 maintenance & history | `maintenance/service`; history in asset drawer |
| FR-023/024/025 search, filter, sort | `inventory/repo.search` (name, code, asset tag/serial, category, lab, location, condition, status) |
| FR-026 dashboard | role-based payload, scoped by laboratory |
| FR-027–030 reports | `reports/service` — one definition for screen, print, CSV |
| FR-031 output | print stylesheet + CSV (PDF via browser "Save as PDF") |
| FR-032 audit | `recordAudit()` in the same DB transaction as the change; DB triggers forbid edit/delete |
| FR-033 validation | zod schemas (`schemas.js`) + rule checks in services; friendly field-level messages |

## Business rules
| BR | Enforced by | Test |
|---|---|---|
| BR-001 item belongs to a lab | `NOT NULL laboratory_id` + service check | I |
| BR-002 unique Asset ID | `UNIQUE asset_tag` + friendly pre-check | O |
| BR-003 never negative | `CHECK(quantity >= 0)` + `ledger.postMovement` | I |
| BR-004 Lost not available | `applyAssetState`, release validation | O, B |
| BR-005 maintenance ⇒ not borrowable | release validation + maintenance flow | B, O |
| BR-006 approve before release | `service.release` status check | B |
| BR-007 only authorised change quantities | route guard + service `require()` | I, A |
| BR-008 no silent deletes | DB triggers; archive instead of delete | I |
| BR-009 audit important changes | `recordAudit` in every mutating service | O |
| BR-010 archived stays reportable | reports include archived (option); history kept | I, O |
| BR-011 lab scope | `lib/scope.js labFilter/assertLab` | I, O, B |
| BR-012 teachers see own requests | `borrowing/service.list/load` | B |

## Non-functional
| Req | How |
|---|---|
| SR-001 password hashing | scrypt, per-user salt; no plain text anywhere (tested) |
| SR-002 authorisation checks | server-side, route + service (tested for every role) |
| SR-003 input safety | zod validation, parameterised SQL, escaped HTML in UI, CSV formula neutralisation, CSP, CSRF |
| SR-004 HTTPS | secure cookies + HSTS in production; see OPERATIONS.md (TLS terminates at your proxy) |
| SR-005 auditability | audit log + request-id'd server log |
| DIR-001/002 consistency, atomic updates | ledger invariant, `db.transaction`, `db/integrity.js` (17 checks) |
| UR-002 clear validation | field-level server messages shown under each input |
| UR-003 available vs unavailable | availability shown in item pickers; unavailable options disabled; stock-state badges |
| UR-004 desktop & tablet | the prototype's responsive stylesheet is retained |
| UR-006 confirmations | confirm dialogs for approve, reject, cancel, archive, deactivate, reset |
| MR-001/002 modular, layered | `server/modules/*` with routes → service → repo |
| SC-001/002 more laboratories | laboratories are rows (Settings → Add laboratory), no code change |
| BRR-001 backups | `db/backup.js`: scheduled, verified, retained, restorable |
