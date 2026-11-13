# Architecture

## The layers (SRS MR-002)

```
Browser ──▶ public/js/pages  ──▶ services/index.js ──▶ core/api.js ──── HTTP /api ────┐
 (screens)   (what to show)      (one fn per endpoint)  (CSRF, errors)                  │
                                                                                         ▼
 SQLite ◀── modules/*/repo.js ◀── modules/*/service.js ◀── modules/*/routes.js ◀── middleware
 (tables)    (SQL only)           (business rules)         (HTTP + validation)     (session, CSRF, ids)
```

| Layer | Knows about | Must NOT |
|---|---|---|
| `routes.js` | HTTP, zod validation, permission guard | contain business rules or SQL |
| `service.js` | rules (BR-xxx), transactions, audit calls | know about HTTP/Express |
| `repo.js` | SQL, column ↔ field mapping (camelCase aliases) | decide anything |
| `schemas.js` | field shapes and friendly messages | |

Front end: `pages/` never call `fetch`; they call `services/` which call `core/api.js`.

## Anatomy of one request — "release items" (UC-010)

1. UI: *Release* modal collects asset choices → `borrowingApi.release(id, {items})` → `POST /api/borrowing/:id/release`.
2. `middleware`: assigns `X-Request-Id`, loads the session, checks Origin + CSRF token.
3. `routes.js`: `requirePermission(borrowing.release)` **before** validation, then `parse(releaseSchema, body)`.
4. `service.release()`: lab-scope check → state check (must be *Approved*, BR-006) → validates every asset (exists, right item/lab, *Available*, serviceable — BR-004/005) →
   **one DB transaction**: insert Release + Release_Items, set assets *Borrowed*, post stock-outs for bulk items, set request *Released*, write the audit row.
5. Any failure throws `AppError` → error handler → `{error:{code,message,fields,requestId}}`; the transaction rolls back so **nothing** half-happened.
6. UI shows the toast, refreshes the list + open drawer + notification badges from the server (nothing is cached client-side).

## Data-integrity rules (DIR-001/002) — how "clean data" is guaranteed

* **One door for quantities.** Only `inventory/ledger.js` changes `Inventory_Item.quantity`. Every change writes a **signed**
  `Inventory_Transaction` carrying the running balance → `quantity = SUM(ledger)` always.
* **Equipment is derived.** For `Equipment` items quantity = number of owned assets (not Lost/Retired); `syncEquipmentQuantity()` posts the difference to the ledger after every asset change.
* **One door for asset state.** Only `assets/state.js → applyAssetState()` changes status/condition; release, return, maintenance, damage and manual edits all go through it, so BR-004/005 live in one place.
* **Atomic.** Every workflow runs in a single `db.transaction`, including its audit record.
* **The DB defends itself.** CHECK constraints (no negative stock, valid statuses), foreign keys, UNIQUE asset tags, and triggers that forbid UPDATE/DELETE on audit, ledger, requests, releases, returns and incidents.
* **Verified continuously.** `db/integrity.js` (17 checks) runs at startup, after seeding, in every test, via `npm run db:check`, and from Settings → *Run integrity check*.

## Roles & permissions

`server/modules/auth/permissions.js` is the single matrix (SRS §5). The server enforces it on every route (and again in services);
the UI receives the list only to hide buttons. Scope: everyone but the System Administrator is limited to assigned laboratories (BR-011);
teachers see only their own requests (BR-012).

## Conventions

* IDs are integers; display codes (`ITM-0007`, `BR-2026-0014`, `MNT-0003`, …) are computed by `lib/codes.js` in both directions (also used by search).
* Timestamps are ISO-8601 UTC strings; business dates (`expectedReturnDate`) are `YYYY-MM-DD` and "today" uses `APP_TIMEZONE`.
* API shape: success `{data, meta?}`, error `{error:{code,message,fields?,requestId}}`. Lists are paginated server-side (`page`, `pageSize`).
* Money-like decimals are rounded to 2 dp in the service layer (`round2`).

## Recipes

**Add a field to inventory items** — (1) new migration `002_add_x.sql` (`ALTER TABLE Inventory_Item ADD COLUMN …`); (2) `inventory/schemas.js`; (3) the `SELECT`/`insert`/`updateMeta` in `inventory/repo.js`; (4) the form in `public/js/pages/inventory.js`; (5) a test line.
**Add an endpoint** — add to the module's `routes.js` (guard + `parse`), logic in `service.js`, SQL in `repo.js`; add a one-liner in `public/js/services/index.js`.
**Add a module** — create `server/modules/<name>/{routes,service,repo,schemas}.js`, add one `api.use('/<name>', router)` line in `server/app.js`.
**Add a page** — create `public/js/pages/<name>.js` calling `registerPage({id,title,perm,render,mount})`, add one `import` in `public/js/main.js` and an entry in `NAV` (`components/shell.js`).
**Change who can do what** — edit `permissions.js` (server) and, if a button should show/hide, `public/js/core/permissions.js` is only names.
**Change a rule** — find it by its BR/FR number: `grep -rn "BR-005" server/`.
