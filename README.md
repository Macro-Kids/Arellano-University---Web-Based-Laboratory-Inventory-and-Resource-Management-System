# AU·LAB — Laboratory Inventory & Resource Management

Arellano University · Web-based inventory, borrowing and equipment-care system for the Science and TLE laboratories.
This is the **functional version** of the static prototype: a real backend, a **SQLite** database, role-based
access, and every workflow from the SRS (v1.1) wired end-to-end — with the original look and feel kept.

## Quick start

```bash
npm install
npm start            # → http://localhost:3000
```

Requires **Node.js 20.12+** (22 or 24 recommended). On first start the app creates `data/aulab.sqlite`, applies the
schema, loads a demo dataset, runs a data-integrity self-check and takes a verified backup.

### Demo accounts (development only)

All use the password **`Demo@2026`**. The sign-in page shows one-click chips for them.

| Username | Role | Laboratories |
|---|---|---|
| `msantos` | Laboratory Coordinator (Dr. Maria Santos — the prototype's user) | Science, TLE |
| `ecruz` | Laboratory Coordinator | TLE |
| `rvillanueva` | Laboratory Staff | Science, TLE |
| `areyes`, `clim` | Teacher | Science |
| `pdizon`, `ngarcia` | Teacher | TLE |
| `admin` | System Administrator | all |

Try this: sign in as `areyes` → **New request** → sign out → sign in as `msantos` → **Approve → Release → Process return**.

## What's inside

| Area (SRS) | What you can do |
|---|---|
| Sign-in / sessions (UC-001) | Username or email + password; lockout after repeated failures; server-side sessions; CSRF protection |
| Dashboards (UC-015) | Role-based: laboratory/school overview, readiness per lab, attention list, recent activity; teacher's personal view |
| Inventory (UC-004/005/007) | Create/edit/archive; search, filter, sort, paginate on the server; **stock-in / stock-out / adjustment / transfer** with a full ledger |
| Equipment & assets (UC-006) | Every unit has a unique Asset ID (`MIC-003`), status, condition, history and "who has it now" |
| Borrowing (UC-008–011) | Multi-item requests → approve/reject → release specific assets → partial/complete return, damaged & missing handling, overdue detection, borrower "I'm returning" confirmation |
| Maintenance & damage/loss (UC-012) | Taking equipment offline, completion with new condition, incident records |
| Reports (UC-013) | Inventory, borrowing, equipment, stock-movement — on screen, **print**, **CSV** |
| Audit trail (UC-014) | Append-only (enforced by the database), filterable, exportable |
| Users, labs, categories (UC-002/003) | Admin-managed; labs & categories are data, not code |
| Backups & health | Verified automatic backups, integrity checker, diagnostics page |

## Project layout

```
server/                       Node + Express + SQLite (better-sqlite3)
  config.js                   ← the ONLY place that reads environment variables
  index.js / app.js           startup sequence / middleware + routes assembly
  db/                         connection, migrations/, seed, bootstrap, backup, integrity checker
  lib/                        small shared helpers (errors, validation, time, codes, logger…)
  middleware/                 sessions, CSRF, security headers, error handler, request ids
  modules/<name>/             one folder per SRS module:  routes → service → repo (+ schemas)
public/                       the front end (plain ES modules, no build step)
  js/core/                    api client, events, router, ui helpers, state
  js/services/                one function per API endpoint
  js/pages/                   one file per screen
  css/style.css               the original prototype stylesheet (unchanged)
  css/extras.css              additions for the functional version
tests/                        59 automated tests (API + browser-level UI)
scripts/                      db:migrate, db:seed, db:reset, db:backup, db:restore, db:check, check
docs/                         architecture, deviations, operations, troubleshooting, API, traceability
development/                  your original planning & design documents (untouched)
legacy/                       the original static prototype and Replit scaffold, kept for reference
```

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Run the app |
| `npm run dev` | Run with auto-restart on file changes |
| `npm test` | Run all 59 tests (≈ 15 s) |
| `npm run check` | Syntax-check every file |
| `npm run db:check` | Verify data consistency (ledger vs quantities, assets vs statuses, requests vs releases…) |
| `npm run db:backup` / `db:restore -- <file>` | Backup / restore |
| `npm run db:reset` | **Delete** the database and reload demo data (development) |

## Read next

* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how data flows; how to add a field, endpoint, or page
* [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — "something broke": where to look
* [`docs/DEVIATIONS.md`](docs/DEVIATIONS.md) — every place this differs from or extends your design documents, and why
* [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — deploying, configuration, backups, security checklist
* [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) — SRS requirement → code → test
* [`docs/API.md`](docs/API.md) — endpoint reference
