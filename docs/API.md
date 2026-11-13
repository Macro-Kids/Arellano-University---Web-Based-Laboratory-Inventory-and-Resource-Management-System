# API reference

Base path `/api`. JSON in/out. Authenticated by the `aulab_sid` cookie; every **non-GET** request must send `X-CSRF-Token` (returned by `POST /auth/login` and `GET /auth/me`).
Success: `{ "data": …, "meta": { total, page, pageSize, pages … } }`. Error: `{ "error": { "code", "message", "fields?", "requestId" } }`
with codes `VALIDATION_ERROR 400 · UNAUTHENTICATED 401 · FORBIDDEN 403 · NOT_FOUND 404 · CONFLICT 409 · BUSINESS_RULE 422 · RATE_LIMITED 429 · INTERNAL 500`.
Lists accept `page`, `pageSize`, plus the filters below. 🔒 = needs the named permission (see `permissions.js`).

| Area | Endpoint | Notes |
|---|---|---|
| **Auth** | `POST /auth/login` `{identifier,password}` · `POST /auth/logout` · `GET /auth/me` · `PATCH /auth/me` · `POST /auth/change-password` · `GET /auth/demo-accounts` (dev only) | |
| **System** | `GET /system/health` · `GET /system/meta` (public) · `POST /system/client-log` | |
| | `GET /system/diagnostics` · `GET /system/integrity` · `GET/POST /system/backups` · `GET /system/backups/:name/(verify\|download)` | 🔒 system.manage |
| **Dashboard** | `GET /dashboard?laboratoryId` · `GET /notifications` | role-based, scoped |
| **Laboratories** | `GET /laboratories` · `POST` · `PATCH /:id` | write 🔒 laboratories.manage |
| **Categories** | `GET /categories` · `POST` · `PATCH /:id` | write 🔒 categories.manage |
| **Users** | `GET /users?search&roleId&status` · `GET /users/roles` · `GET /users/:id` · `POST` · `PATCH /:id` · `POST /:id/status` · `POST /:id/reset-password` | 🔒 users.manage |
| | `GET /users/requesters?laboratoryId` | 🔒 borrowing.create_for_others |
| **Inventory** | `GET /inventory?search&laboratoryId&categoryId&itemType&availability&condition&status&location&sort&dir` · `GET /inventory/lookup` · `GET /inventory/movements` · `GET /inventory/:id` · `GET /:id/transactions` · `GET /:id/audit` | 🔒 inventory.view |
| | `POST /inventory` · `PATCH /:id` · `POST /:id/archive` · `POST /:id/restore` | 🔒 inventory.create / update / archive |
| | `POST /inventory/:id/movements` `{type: Stock-in\|Stock-out\|Adjustment\|Transfer, quantity, source, reason, newQuantity, expectedQuantity, targetLaboratoryId, remarks}` | 🔒 stock.move (adjust: stock.adjust) |
| **Assets** | `GET /assets?search&itemId&status&condition&laboratoryId&sort&dir` · `GET /assets/:id` (with history & current holder) | 🔒 assets.view |
| | `POST /assets` · `PATCH /:id` · `POST /:id/state` `{status?,condition?,reason}` | 🔒 assets.register / assets.update |
| **Borrowing** | `GET /borrowing?status&search&laboratoryId&mine` · `GET /:id` · `POST /borrowing` | teachers: own only |
| | `POST /:id/approve` · `/reject` (reason required) · `/cancel` · `GET /:id/release-plan` · `POST /:id/release` · `POST /:id/return` · `POST /:id/confirm-return` | 🔒 borrowing.approve / release / return / confirm_return |
| **Maintenance** | `GET /maintenance?status&assetId` · `POST` · `PATCH /:id` · `POST /:id/complete` | 🔒 maintenance.view / manage |
| **Damage/loss** | `GET /damage-loss?type&assetId` · `POST /damage-loss` | 🔒 damage.record |
| **Reports** | `GET /reports/(inventory\|borrowing\|equipment\|movements)?laboratoryId&from&to&format=csv` | 🔒 reports.view |
| **Audit** | `GET /audit?entity&action&userId&laboratoryId&from&to&search` · `GET /audit/facets` · `GET /audit/export.csv` | 🔒 audit.view (read-only; no write endpoints exist) |
