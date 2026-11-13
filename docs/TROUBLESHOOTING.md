# "Something broke" — a debugging playbook

## 1. Find the request
Every API response has an `X-Request-Id`, and every error body (and the red banner / toast the user sees: *"ref ab12cd34"*) includes it.
```bash
grep ab12cd34 logs/app.log          # the request line, the audit entry, and any stack trace share this id
```
Log lines are JSON: `{"time","level","scope","message","meta"}` — `scope` is the module (`http`, `auth`, `ledger`, `borrowing`, `audit`, `backup`, `client`…).

## 2. Turn the volume up
| Where | How |
|---|---|
| Server | `LOG_LEVEL=debug` (default in development): logs every request with status/duration/user, every ledger movement, every audit write |
| SQL | `DEBUG_SQL=1` prints each statement |
| Browser | `localStorage.setItem('aulab:debug','1')` (or Settings → *Debug logging*) → API calls and timings in the console. Inspect state via `window.__aulab` |
| Browser errors | Uncaught front-end errors are POSTed to the server and appear in `logs/app.log` with scope `client` |

## 3. Is the data itself OK?
```bash
npm run db:check
```
Tells you in words what is inconsistent (e.g. *"Item #4 'Filter Paper': quantity 8 ≠ ledger total 12"*). The same check is in Settings → *Run integrity check*.
Inspect the database directly: `sqlite3 data/aulab.sqlite` (read-only is safest) — start with `.tables`, `SELECT * FROM Audit_Log ORDER BY audit_id DESC LIMIT 20;`.

## 4. Common symptoms
| Symptom | Likely cause / fix |
|---|---|
| "Your session token is missing or invalid" | Page open across a restart/sign-out; reload. Behind a proxy: make sure it forwards `Host` and `Origin` unchanged |
| Cannot sign in right after many tries | Throttle (5 failures/15 min per username+IP). Wait, or restart the server |
| "Only N … available — cannot remove M" | Working as designed (BR-003): stock can't go negative |
| Asset can't be released | Its status isn't *Available* (borrowed / maintenance / damaged / lost) — the message names the asset and status |
| A request says *Overdue* the day after the due date | Correct; the check uses `APP_TIMEZONE` calendar days |
| `SQLITE_BUSY` / "database is locked" | Another process has the DB open (e.g. a `sqlite3` shell writing). Close it. The app waits 5 s before failing |
| Startup: "Migration … failed" | Nothing was changed (transactional). Read the message; restore from backup if a migration was edited |
| "INTEGRITY PROBLEMS DETECTED AT STARTUP" | Run `npm run db:check`; restore the latest backup if the cause is unclear |
| Port in use | `PORT=3001 npm start` |
| `better-sqlite3` install error | Needs Node ≥ 20 and a prebuilt binary or a C++ toolchain; try `npm rebuild better-sqlite3` |

## 5. Run the tests
`npm test` runs the real server against a throw-away DB: **API** tests (auth, RBAC, rules, ledger invariants, workflows, reports, audit, backups) and **UI** tests
(the real front-end modules in a DOM, clicking through sign-in, every page and a complete borrowing workflow). A failing test names the rule that broke.
```bash
node --test tests/borrowing.test.js        # one file
```

## 6. Where is X implemented?
`grep -rn "BR-005" server/` finds each business rule by its SRS number. See `docs/TRACEABILITY.md` for the full map.
