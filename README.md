# AU·LAB — Laboratory Inventory & Resource Management

Arellano University · Web-based inventory, borrowing and equipment-care system for the Science and TLE laboratories.
A real backend (Node.js + Express), a **SQLite** database, role-based access, and every workflow from the SRS (v1.1).

> **Platform status.** This README covers **Linux**. A Windows guide is being prepared separately.
> The app has been **tested on Ubuntu 24.04**. The other distributions below use the same Node.js app and a
> database driver with prebuilt Linux binaries, so they are expected to work, but the per-distro commands have
> not been run on each one. If a step fails on your distro, see [Troubleshooting](#troubleshooting).

---

## Contents

1. [What you need](#1-what-you-need)
2. [Install guide by distribution](#2-install-guide-by-distribution)
   - [Debian family — Ubuntu, Linux Mint, Debian, Pop!_OS, Zorin, Raspberry Pi OS](#debian-family)
   - [Fedora](#fedora)
   - [RHEL family — RHEL, AlmaLinux, Rocky Linux, CentOS Stream](#rhel-family)
   - [Arch family — Arch, Manjaro, EndeavourOS](#arch-family)
   - [openSUSE / SUSE](#opensuse--suse)
   - [Alpine](#alpine)
   - [Other distributions — NixOS, Gentoo, Void](#other-distributions)
   - [Any distribution without root: nvm](#any-distribution-without-root-nvm)
3. [Get the project and run it](#3-get-the-project-and-run-it)
4. [Sign in and try it](#4-sign-in-and-try-it)
5. [Access from other computers (firewall)](#5-access-from-other-computers-firewall)
6. [Run it permanently (systemd)](#6-run-it-permanently-systemd)
7. [Backups, updates and health checks](#7-backups-updates-and-health-checks)
8. [Troubleshooting](#troubleshooting)
9. [What's inside the project](#9-whats-inside-the-project)
10. [Project layout and commands](#10-project-layout-and-commands)

---

## 1. What you need

| Requirement | Detail |
|---|---|
| **Node.js** | **20.12 or newer** (22 LTS recommended) |
| **CPU** | 64-bit Intel/AMD (x86-64) or 64-bit ARM (aarch64, e.g. Raspberry Pi 4/5 with a 64-bit OS) |
| **C library** | glibc (most distros) or musl (Alpine) — both are supported by the database driver's prebuilt binaries |
| **Disk / RAM** | Small. About 150 MB for the project and its libraries; 512 MB RAM is plenty |
| **Database server** | **None.** SQLite is a single file (`data/aulab.sqlite`) |
| **Compiler** | Not needed normally (only as a fallback — see [Troubleshooting](#troubleshooting)) |

**Check what you already have** (do this first — it can save you a step):

```bash
node --version      # needs v20.12.0 or higher
npm --version
unzip -v | head -1  # needed to unpack the zip (minimal systems may not have it)
```

> **Important:** many distributions ship an **older** Node.js in their default repositories (Node 18 on Ubuntu 24.04,
> Debian 12 and Linux Mint 22; older still on Ubuntu 22.04). If `node --version` prints something below 20.12, use
> the NodeSource or nvm option in your distro's section.

---

## 2. Install guide by distribution

Pick **one** section. Each ends with the same check: `node --version` must print 20.12 or higher. Then continue at
[step 3](#3-get-the-project-and-run-it).

### Debian family

**Ubuntu · Linux Mint · Debian · Pop!_OS · Zorin OS · Raspberry Pi OS** (and other Ubuntu/Debian derivatives)

First, the basics:

```bash
sudo apt update
sudo apt install -y unzip curl ca-certificates
```

**Option A — NodeSource (system-wide; best for servers).** Installs Node 22 from the official NodeSource repository:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

**Option B — nvm (per user, no root needed for Node itself).** See [nvm](#any-distribution-without-root-nvm).

**Option C — distro package.** Only if your version is new enough. As a rule of thumb, Debian 13 (Debian "trixie") ships
Node 20; Ubuntu 24.04 and Debian 12 ship Node 18 (too old). Check before relying on it:

```bash
sudo apt install -y nodejs npm
node --version        # if below v20.12, use Option A or B instead
```

> **Raspberry Pi OS:** use the **64-bit** image (`uname -m` should print `aarch64`). 32-bit images are not supported.

**Firewall on this family:** `ufw` (see [section 5](#5-access-from-other-computers-firewall)).

### Fedora

**Fedora 40 and newer** (including Fedora 44). Fedora normally ships a current Node.js.

```bash
sudo dnf install -y nodejs npm unzip
node --version
```

If the version is below 20.12 on an older Fedora, use [nvm](#any-distribution-without-root-nvm).
**Firewall:** `firewalld` (see [section 5](#5-access-from-other-computers-firewall)). **SELinux** is on by default — see the
note in [section 6](#6-run-it-permanently-systemd) if you run it as a service.

### RHEL family

**Red Hat Enterprise Linux · AlmaLinux · Rocky Linux · CentOS Stream**

RHEL 8 and 9 provide Node.js as selectable *module streams*; pick 22 (or 20):

```bash
sudo dnf install -y unzip
sudo dnf module list nodejs            # see which streams your release offers
sudo dnf module reset nodejs -y
sudo dnf module enable nodejs:22 -y    # use nodejs:20 if 22 is not listed
sudo dnf install -y nodejs npm
node --version
```

On newer releases (RHEL 10 and later) module streams may not exist; then simply run `sudo dnf install -y nodejs npm`
and check the version. If your release has no Node 20+, use NodeSource or nvm:

```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
```

**Firewall:** `firewalld`. **SELinux** is enforcing — see [section 6](#6-run-it-permanently-systemd).

### Arch family

**Arch Linux · Manjaro · EndeavourOS** (rolling release — Node is current)

```bash
sudo pacman -Syu --needed nodejs npm unzip
node --version
```

### openSUSE / SUSE

**openSUSE Tumbleweed · openSUSE Leap · SUSE Linux Enterprise**

Package names include the major version. Check what is available, then install a current one:

```bash
zypper search nodejs                          # look for nodejs22 / nodejs24
sudo zypper install -y nodejs22 npm22 unzip   # adjust the number to what is listed
node --version
```

**Firewall:** `firewalld` on current releases.

### Alpine

Alpine uses musl and OpenRC (not systemd), so the [systemd section](#6-run-it-permanently-systemd) does not apply.

```bash
apk add nodejs npm unzip
node --version          # Alpine 3.20+ has Node 20+; older releases may not
```

If `npm install` has to compile (see [Troubleshooting](#troubleshooting)): `apk add build-base python3`.
To keep it running, start it inside `tmux`/`screen`, or write an OpenRC service for `node server/index.js`.

### Other distributions

These should work because they only need Node.js 20.12+, but they are the least tested:

```bash
# NixOS (temporary shell with Node 22)
nix-shell -p nodejs_22

# Gentoo
sudo emerge --ask net-libs/nodejs

# Void Linux
sudo xbps-install -S nodejs unzip
```

If your distro's Node is too old, use [nvm](#any-distribution-without-root-nvm).

### Any distribution without root: nvm

[nvm](https://github.com/nvm-sh/nvm) installs Node into your home folder and works on every distribution. You need `curl` (or `wget`) and `bash`.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# close and re-open the terminal, then:
nvm install 22
node --version
```

(Check the nvm page for the latest install-script version number.) nvm is ideal for trying the app on a laptop. For a
permanent server prefer the system package or NodeSource, because a systemd service cannot easily use a per-user nvm Node.

---

## 3. Get the project and run it

**3.1 Unpack the zip** (adjust the paths to where you saved it):

```bash
cd ~/Documents
unzip au-lab.zip
cd au-lab
ls          # you should see package.json, server/, public/, docs/ …
```

> If `ls` shows only another `au-lab` folder, `cd au-lab` once more. `package.json` must be in your current folder.

**3.2 Install the libraries** (needs internet, takes under a minute):

```bash
npm install
```

**3.3 Start it:**

```bash
npm start
```

You should see log lines ending with `AU·LAB listening on http://localhost:3000`. Open **http://localhost:3000** in your browser.
Stop it with **Ctrl+C**.

**3.4 (Optional) Check everything works on your machine:**

```bash
npm test          # 59 automated tests, about 15 seconds
npm run db:check  # verifies the data is consistent
```

**Change the port or other settings:** copy `.env.example` to `.env` and edit it (works the same on every distro),
or for a single run: `PORT=3001 npm start`.

---

## 4. Sign in and try it

On first start the app creates `data/aulab.sqlite`, loads **demo data**, and shows one-click demo accounts on the sign-in
page. All demo accounts use the password **`Demo@2026`**.

| Username | Role | Laboratories |
|---|---|---|
| `msantos` | Laboratory Coordinator (Dr. Maria Santos) | Science, TLE |
| `ecruz` | Laboratory Coordinator | TLE |
| `rvillanueva` | Laboratory Staff | Science, TLE |
| `areyes`, `clim` | Teacher | Science |
| `pdizon`, `ngarcia` | Teacher | TLE |
| `admin` | System Administrator | all |

**Try the main workflow:** sign in as `areyes` (teacher) → **New request** → sign out → sign in as `msantos` (coordinator)
→ **Approve → Release → Process return**.

To start over with fresh demo data: `npm run db:reset` (this **deletes** the database).

---

## 5. Access from other computers (firewall)

By default the app listens on all network interfaces on port 3000, but your distro's firewall may block other computers.
Open the port only if you want others on your network to reach it, then browse to `http://<this-computer's-IP>:3000`
(find the IP with `hostname -I`).

| Distro family | Command |
|---|---|
| Ubuntu · Mint · Debian · Pop!_OS (`ufw`) | `sudo ufw allow 3000/tcp` |
| Fedora · RHEL family · openSUSE (`firewalld`) | `sudo firewall-cmd --add-port=3000/tcp --permanent && sudo firewall-cmd --reload` |
| Arch · Alpine · others | Usually no firewall by default. If you use `nftables`/`iptables`, allow TCP port 3000 |

> ⚠️ **In the default (development) mode the sign-in page lists demo accounts and their password.** Do not expose that to
> a shared or public network. For real use, run in **production mode** ([section 6](#6-run-it-permanently-systemd)).

---

## 6. Run it permanently (systemd)

`npm start` stops when you close the terminal. On distributions with **systemd** (Ubuntu, Debian, Mint, Fedora, RHEL
family, Arch, openSUSE, …) run it as a service. This example installs the project in `/opt/au-lab`.

**6.1 Put the project in place and create a service user**

```bash
sudo cp -r ~/Documents/au-lab /opt/au-lab
cd /opt/au-lab && sudo npm install --omit=dev
sudo useradd --system --home-dir /opt/au-lab --shell /usr/sbin/nologin aulab
sudo chown -R aulab:aulab /opt/au-lab
```

(On Debian-family systems the shell path may be `/usr/sbin/nologin`; on others `/sbin/nologin`. Either is fine.)

**6.2 Create `/etc/systemd/system/au-lab.service`** (find your Node path with `which node`):

```ini
[Unit]
Description=AU-LAB laboratory inventory
After=network.target

[Service]
Type=simple
User=aulab
WorkingDirectory=/opt/au-lab
ExecStart=/usr/bin/node server/index.js
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=ADMIN_INITIAL_PASSWORD=change-me-1-strong
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

**6.3 Start it and follow the log**

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now au-lab
sudo systemctl status au-lab
journalctl -u au-lab -f          # live log (also in /opt/au-lab/logs/app.log)
```

**Production mode notes — please read:**

- **No demo data, no demo accounts.** The first administrator is `admin` with the password you set in
  `ADMIN_INITIAL_PASSWORD` (if left empty a random one is printed once in the log). Sign in, then change it in Settings.
- **HTTPS is expected.** In production the session cookie is marked `Secure`, so sign-in only works over **HTTPS**.
  Put a reverse proxy such as **Caddy** or **nginx** in front, and add `Environment=TRUST_PROXY=1` to the service.
  Example Caddy file: `lab.example.edu { reverse_proxy localhost:3000 }`.
- **Only on a closed, trusted network without HTTPS:** add `Environment=COOKIE_SECURE=0` to the service. This is less secure.
- **Ports 80/443:** let Caddy/nginx listen there and forward to port 3000.
- **SELinux (Fedora, RHEL family):** keep the project in `/opt` as above (not in a home folder). If nginx is your proxy
  and returns "502 Bad Gateway", run `sudo setsebool -P httpd_can_network_connect 1`.
- **Firewall:** open the proxy's port (HTTPS), not 3000.
- **nvm Node cannot be used by the service easily** — install Node from your distro or NodeSource for server use.

Full checklist: [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

---

## 7. Backups, updates and health checks

Your data is **`data/aulab.sqlite`** (plus backups in `data/backups/`). Back up the `data/` folder.

```bash
npm run db:backup                     # create a verified backup now (saved in data/backups/)
npm run db:check                      # verify the data is consistent
curl localhost:3000/api/system/health # {"status":"ok",…}  — for uptime monitors
```

Automatic backups run daily and keep the newest 14. **Restore** (stop the app first):

```bash
sudo systemctl stop au-lab            # or Ctrl+C if running in a terminal
npm run db:restore -- aulab-YYYYMMDD-HHMMSS.sqlite
sudo systemctl start au-lab
```

**Updating to a new version:**

1. `npm run db:backup`
2. Stop the app.
3. Replace the project files with the new version, **keeping your `data/` folder and `.env`**.
4. `npm install` (add `--omit=dev` on a server), then start the app. Schema changes apply automatically and safely.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| `node: command not found` | Node is not installed — see [section 2](#2-install-guide-by-distribution) |
| `npm install` says it requires a newer Node, or the app prints a syntax/engine error | Node is too old. `node --version` must be 20.12+. Use NodeSource or nvm |
| `npm install` fails with `gyp`, `make`, `g++` or `python` errors | The prebuilt database binary could not be downloaded (blocked network or unusual CPU), so npm tried to compile it. Install build tools, then `rm -rf node_modules && npm install`: **Debian family** `sudo apt install build-essential python3` · **Fedora/RHEL** `sudo dnf install gcc-c++ make python3` · **Arch** `sudo pacman -S base-devel python` · **openSUSE** `sudo zypper install gcc-c++ make python3` · **Alpine** `apk add build-base python3` |
| `npm install` fails behind a proxy or school network | Check that your network allows downloads from `registry.npmjs.org` and `github.com`; set `npm config set proxy …` if needed |
| `unzip: command not found` | Install it: `sudo apt install unzip` / `sudo dnf install unzip` / `sudo pacman -S unzip` / `sudo zypper install unzip` / `apk add unzip` |
| `Port 3000 is already in use` | `PORT=3001 npm start` (and open `http://localhost:3001`) |
| Page doesn't open from another computer | Check the firewall ([section 5](#5-access-from-other-computers-firewall)) and use the server's IP, not `localhost` |
| In production, sign-in does nothing or says the session is invalid | The cookie is `Secure` and needs HTTPS ([section 6](#6-run-it-permanently-systemd)); also set `TRUST_PROXY=1` behind a proxy |
| Service won't start (`systemctl status au-lab`) | Run `journalctl -u au-lab -n 50`. Common causes: wrong Node path in `ExecStart` (`which node`), files not owned by `aulab`, SELinux (keep it in `/opt`) |
| `SQLITE_BUSY` / "database is locked" | Another program has the database open (for example a `sqlite3` shell). Close it |
| Too many failed sign-ins | After 5 failures per username it locks for 15 minutes; wait, or restart the server |
| Something else broke | Check `logs/app.log` — errors show a **reference ID** you can search for. See [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) |

---

## 9. What's inside the project

| Area (SRS) | What you can do |
|---|---|
| Sign-in / sessions (UC-001) | Username or email + password; lockout after repeated failures; server-side sessions; CSRF protection |
| Dashboards (UC-015) | Role-based: laboratory/school overview, readiness per lab, attention list, recent activity; teacher's personal view |
| Inventory (UC-004/005/007) | Create/edit/archive; search, filter, sort, paginate on the server; stock-in / stock-out / adjustment / transfer with a full ledger |
| Equipment & assets (UC-006) | Every unit has a unique Asset ID (`MIC-003`), status, condition, history and "who has it now" |
| Borrowing (UC-008–011) | Multi-item requests → approve/reject → release specific assets → partial/complete return, damaged & missing handling, overdue detection |
| Maintenance & damage/loss (UC-012) | Taking equipment offline, completion with new condition, incident records |
| Reports (UC-013) | Inventory, borrowing, equipment, stock movement — on screen, print, CSV |
| Audit trail (UC-014) | Append-only (enforced by the database), filterable, exportable |
| Users, labs, categories (UC-002/003) | Admin-managed; labs and categories are data, not code |
| Backups & health | Verified automatic backups, integrity checker, diagnostics page |

## 10. Project layout and commands

```
server/        Node + Express + SQLite backend
  config.js      the ONLY place that reads environment variables
  db/            connection, migrations, seed, backup, integrity checker
  lib/           shared helpers      middleware/   sessions, CSRF, errors
  modules/<x>/   one folder per feature: routes → service → repo (+ schemas)
public/        front end (plain ES modules, no build step): js/core, js/services, js/pages, css/
tests/         59 automated tests (API + browser-level UI)
scripts/       command-line tools (db:backup, db:restore, db:reset, db:check …)
docs/          ARCHITECTURE, API, DEVIATIONS, OPERATIONS, TROUBLESHOOTING, TRACEABILITY
development/   your original planning & design documents (untouched)
legacy/        the original static prototype, kept for reference
data/  logs/   the database + backups, and the server log (created at runtime)
```

| Command | Purpose |
|---|---|
| `npm start` | Run the app |
| `npm run dev` | Run with auto-restart on file changes |
| `npm test` | Run all 59 tests |
| `npm run check` | Syntax-check every file |
| `npm run db:check` | Verify data consistency |
| `npm run db:backup` / `db:restore -- <file>` | Backup / restore |
| `npm run db:reset` | **Delete** the database and reload demo data (development) |

**More documentation:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (how data flows, how to add features) ·
[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) · [`docs/DEVIATIONS.md`](docs/DEVIATIONS.md) (differences from the design documents) ·
[`docs/OPERATIONS.md`](docs/OPERATIONS.md) · [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) · [`docs/API.md`](docs/API.md)
