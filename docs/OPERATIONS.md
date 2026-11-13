# Operations guide

## Running in production
```bash
npm ci --omit=dev
NODE_ENV=production ADMIN_INITIAL_PASSWORD='choose-a-strong-one1' TRUST_PROXY=1 npm start
```
In production: **no demo data, no demo logins**, cookies are `Secure` (so serve over HTTPS), logs default to `info`.
If `ADMIN_INITIAL_PASSWORD` is empty a random one is generated and printed **once** in the log. Sign in as `admin`, then create real accounts and change the password.
Keep it running with a process manager (systemd, pm2, Docker restart policy). `SIGTERM` shuts down cleanly.

Put it behind HTTPS (Caddy/nginx) and set `TRUST_PROXY=1`. Example Caddy: `lab.example.edu { reverse_proxy localhost:3000 }`.

## Files that matter
| Path | What | Back up? |
|---|---|---|
| `data/aulab.sqlite` (+ `-wal`, `-shm`) | the database | **yes** (use the backup tool, don't copy while running) |
| `data/backups/` | verified backups, newest 14 kept | copy off-machine regularly |
| `logs/app.log` | JSON-lines log | rotate/ship as you like |
| `.env` | configuration | yes (contains no secrets by default) |

## Backups (BRR-001)
* **Automatic:** at startup if none in the last 24 h, then every `BACKUP_INTERVAL_HOURS`. Each backup is opened read-only and `integrity_check`ed; failures are logged at ERROR.
* **Manual:** `npm run db:backup`, or Settings → *Back up now* (administrators). Download from Settings.
* **Restore:** stop the server → `npm run db:restore -- aulab-YYYYMMDD-HHMMSS.sqlite` → start. The current DB is saved as `aulab.sqlite.before-restore-<time>` first.
* **Test your backups** now and then: `npm run db:restore` into a spare folder using `DB_PATH=/tmp/x.sqlite`.

## Health & data checks
* `GET /api/system/health` — public, for uptime monitors (200 `{"status":"ok"}`).
* `npm run db:check` — verifies ledger = quantity, assets ↔ statuses ↔ open requests, etc. Exit code 1 on problems.
* Settings → *System* (administrators): version, DB size, sessions, backups, recent warnings/errors, table sizes.

## Configuration
Every option is documented in `.env.example` and read only in `server/config.js`.

## Upgrades & schema changes
Add a new numbered file in `server/db/migrations/` (never edit an applied one). It is applied automatically at startup inside a transaction (all-or-nothing). **Take a backup before upgrading.**

## Security checklist
- [x] Passwords hashed with scrypt; strength rules; lockout after 5 failures / 15 min
- [x] HttpOnly + SameSite=Lax session cookie, server-side sessions (hashed), idle expiry (12 h), sessions end when a user is deactivated or their password/role changes
- [x] CSRF token on every state change + same-origin check
- [x] Role & laboratory scope enforced server-side on every route
- [x] Parameterised SQL everywhere; CSV export neutralises spreadsheet formulas
- [x] CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`
- [x] Append-only audit trail enforced by the database
- [ ] **You:** serve over HTTPS, change the admin password, restrict server access, copy backups off-machine.

## Capacity
SQLite in WAL mode with one Node process comfortably handles a school's lab traffic (hundreds of users, tens of thousands of records). Writes are serialised, which is what keeps stock counts exact. If you outgrow it, only the `repo.js` files and migrations need porting.
