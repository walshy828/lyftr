<p align="center">
  <a href="https://github.com/Cawlumm/lyftr/releases/latest"><img src="https://img.shields.io/github/v/release/Cawlumm/lyftr?include_prereleases&label=release&color=6366f1" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/status-beta-orange" alt="Beta" />
  <a href="https://selfh.st/weekly/2026-04-24/"><img src="https://img.shields.io/badge/Featured%20in-selfh.st%20%C2%B7%20Apr%202026-6366f1" alt="Featured in selfh.st" /></a>
  <img src="https://img.shields.io/badge/iOS-planned-black?logo=apple&logoColor=white" alt="iOS Planned" />
  <a href="https://discord.gg/hfFWsrebQA"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Join Discord" /></a>
</p>

<p align="center">
  <img src="docs/banner.png" alt="Lyftr — Self-hosted workout tracking" width="100%" />
</p>

> 🎉 **First beta release is live — [`v0.1.0-beta.1`](https://github.com/Cawlumm/lyftr/releases/tag/v0.1.0-beta.1).** Workouts, programs, gym mode, dashboard, weight, and the new nutrition tracker are all in. Pin this tag for a stable self-host target instead of tracking `main`.

> **Beta** — actively being built. Expect rough edges and frequent updates. Issues and feedback are welcome. The software equivalent of going to the gym for the first time.

> 🌐 **[Live demo → lyftr-demo.fly.dev](https://lyftr-demo.fly.dev)** — log in with `demo@lyftr.local` / `password123`. Shared instance, resets every hour.

---

## Runs on

Tested and working on:

- **Raspberry Pi 4** (2 GB RAM, arm64 Docker image)
- **Any x86 VPS** — Hetzner CAX11, DigitalOcean Droplet, Oracle Free Tier
- **Synology NAS** via Docker (Container Manager)
- **Proxmox LXC** with Docker installed
- **Local machine** — Mac, Linux, Windows (WSL2)

Single SQLite file, minimal RAM, no external services required.

---

## Why Lyftr?

**Hevy and Strong** are polished apps but cloud-only, increasingly paywalled, and your data lives on someone else's server. **Wger** is a solid self-hosted option with a lot of features — Lyftr's focus is a more modern, mobile-first UI and a simpler deployment story. **FitNotes** is local-only with no sync or server deployment story.

Lyftr is for people who want a modern, mobile-first workout tracker that they fully own and can run on a $5 VPS or a Raspberry Pi in the corner. No subscription. No vendor lock-in. No "your export is a Pro feature."

---

## Features

| Feature | Status |
|---------|--------|
| Workout logging with 800+ exercise library | ✓ |
| Program builder — reusable workout templates | ✓ |
| Active workout mode — guided set-by-set flow | ✓ |
| Gym Mode — full-screen card layout, one exercise at a time | ✓ |
| Exercise detail — personal records, progression chart, muscle diagram | ✓ |
| Dashboard — volume trends, consistency heatmap, muscle balance | ✓ |
| Weight tracking with trend graph | ✓ |
| lbs / kg unit support across all data | ✓ |
| Self-hosted — all data stays on your server | ✓ |
| Nutrition tracking — calories, macros, barcode scan, food search | ✓ |
| PWA — installable on any device | Planned |
| Strong / Hevy CSV import | Planned |
| iOS app (Swift) | Planned |

---

## Live Demo

**[lyftr-demo.fly.dev](https://lyftr-demo.fly.dev)**

| Field | Value |
|-------|-------|
| Email | `demo@lyftr.local` |
| Password | `password123` |

Pre-loaded with 8 weeks of PPL workouts, 90 days of weight logs, and food logs so every page has data to explore. Shared instance — resets automatically every hour so any changes are wiped clean.

Or **register your own account** on the demo — your data persists until the next hourly reset, and nobody else can see it.

---

## Quick Start

> No clone. No build. No Go install required. Just Docker.

```bash
curl -o docker-compose.yml https://raw.githubusercontent.com/Cawlumm/lyftr/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/Cawlumm/lyftr/main/.env.example
```

Edit `.env` and set a strong `JWT_SECRET` (`openssl rand -hex 32`), then:

```bash
docker compose up -d
```

Open `http://localhost` in your browser and create your account. Registration is
closed by default, but a brand-new instance always allows the *first* account to
be created — so just sign up. To add more people later, set
`ALLOW_REGISTRATION=true` (optionally with `REGISTRATION_INVITE_CODE`), create
the accounts, then set it back to `false`. If running on a VPS, replace `localhost` with your server IP or domain.

---

## More Screenshots

<p align="center">
  <img src="docs/screenshots/workouts-mobile.png" width="160" alt="Workouts" />
  <img src="docs/screenshots/active-workout-mobile.png" width="160" alt="Active Workout" />
  <img src="docs/screenshots/gym-mode-overview-mobile.png" width="160" alt="Gym Mode Overview" />
  <img src="docs/screenshots/programs-mobile.png" width="160" alt="Programs" />
  <img src="docs/screenshots/settings-mobile.png" width="160" alt="Settings" />
</p>

<p align="center">
  <img src="docs/screenshots/gym-mode-overview-desktop.png" width="700" alt="Gym Mode desktop" />
</p>

---

## Configuration

All variables live in `.env` at the project root.

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | *required* | Min 32-char secret for signing tokens. Generate with `openssl rand -hex 32`. Production refuses to start without one; outside production a random ephemeral secret is generated per boot. Rotating it logs everyone out |
| `ALLOW_REGISTRATION` | `false` | Opens `POST /auth/register`. Closed by default — a self-hosted instance has a fixed set of accounts, so open signup is attack surface with no upside. A brand-new instance with no accounts can always create its first user |
| `REGISTRATION_INVITE_CODE` | *(none)* | When set, registration additionally requires this code. Lets you onboard household members without leaving signup open |
| `TRUSTED_PROXIES` | *(none)* | Comma-separated CIDRs allowed to set `X-Forwarded-For`. Empty means trust no proxy. The compose file sets the Docker bridge range so the auth rate limiter sees real client IPs. Never widen this to a range you don't control — anything inside it can forge its source IP and bypass rate limiting |
| `AI_HEALTH_INSIGHTS_ENABLED` | `false` | Allows blood-pressure history and body metrics to be sent to your configured AI provider for written insights. Separate from `VISION_PROVIDER` on purpose, so enabling meal-photo scanning doesn't also export health records. Each user must additionally opt in under **Settings → Privacy** |
| `REFRESH_EXPIRY` | `168` | Refresh-token lifetime in hours (7 days) |
| `SEED_DEMO` | `false` | Seeds the demo account. Opt-in everywhere; never enable it on an instance holding real data |
| `CORS_ORIGIN` | `http://localhost` | Comma-separated allow-list of client origins. Use `*` to allow any (the API is Bearer-token based, no cookies) |
| `PORT` | `80` | Host port for the web interface |
| `BACKEND_ORIGIN` | `backend:3000` | Docker **service name**:port the frontend proxies `/api` to — not a host IP. Only change the port, to match a custom backend `PORT` |

> **Self-hosting note:** `BACKEND_ORIGIN` is resolved over the internal Docker network, so it must use the backend's **service name** (`backend`), not your server's host or LAN IP. The default compose only *exposes* the backend on the Docker network — it isn't published to the host — so pointing `BACKEND_ORIGIN` at something like `192.168.1.10:3000` produces a `502 Bad Gateway` (`connect() failed (111: Connection refused)`). If you set a custom backend `PORT`, change only the port (e.g. `backend:3008`).

---

## Exercise Library

On first startup, Lyftr automatically seeds 800+ exercises from [free-exercise-db](https://github.com/yuhonas/free-exercise-db) in the background. No API key. No setup required. It just works.

```
[startup] exercises table empty — fetching from free-exercise-db...
[startup] seed: synced 868 exercises
```

The seed runs async so the server is immediately available. Exercises appear in the UI within a few seconds.

**Re-sync exercises:** Go to **Settings → Exercise Library** — shows current exercise count and a progress indicator while seeding. Hit **Re-sync** to pull the latest exercises (safe upsert, existing workout data is untouched).

---

## Upgrading from an earlier version

Two changes need a moment of your attention:

**1. Everyone is signed out on first start.** Tokens issued before this release
carry no revocation ID, so they can't be revoked and are rejected rather than
trusted indefinitely. Just log in again.

**2. The backend now runs as a non-root user (uid 10001).** No action needed —
the container fixes ownership of `./data` on startup. If you back up or inspect
those files from the host, note they are now owned by uid 10001 and mode `0600`.

Also check that `JWT_SECRET` is at least 32 characters — production now refuses
to start with a weak or placeholder secret rather than quietly accepting one.
Registration is closed by default; existing accounts are unaffected.

---

## Data & Backups

All your data lives in `./data/lyftr.db` (SQLite). Back it up regularly. It's one file. You have no excuse.

```bash
# Backup. Use .backup, not cp: it takes a consistent snapshot of a database
# that may be mid-write, and it captures the WAL. A plain cp of a live SQLite
# file can produce a torn copy that only fails when you try to restore it.
sqlite3 ./data/lyftr.db ".backup './data/lyftr-$(date +%F).db'"

# Update to latest
docker compose pull && docker compose up -d
```

**Encrypt the volume.** Lyftr stores blood-pressure readings, weight history,
body composition and food logs. SQLite does not encrypt anything at rest, and
neither would PostgreSQL — the file is only as private as the disk it sits on.
Put `./data` on an encrypted filesystem (LUKS on Linux, FileVault on macOS, an
encrypted ZFS dataset on a NAS). That single step covers the database, its
`-wal`/`-shm` sidecars, your meal photos, and every backup you take from it.

Lyftr sets `0700` on the data directory and `0600` on the database so other
accounts on the host can't read it, and the containers run as a non-root user.
Neither of those helps if someone gets the disk — encryption is what does.

## Privacy: what leaves your server

Self-hosted doesn't mean nothing goes out. Everything Lyftr sends externally:

| Feature | Goes to | What is sent |
|---------|---------|--------------|
| Exercise library seed | `raw.githubusercontent.com` | Nothing — an outbound fetch on first boot |
| Food search | Open Food Facts (+ USDA FDC if `FDC_API_KEY` is set) | Your search terms |
| Barcode scan | Open Food Facts | The scanned barcode |
| Meal photo / label scan | Your configured AI provider | The photo |
| **AI health insights** | Your configured AI provider | Blood-pressure history, weight, BMI, age, sex |

The last row is the sensitive one, so it is **off by default and gated twice**:
the operator sets `AI_HEALTH_INSIGHTS_ENABLED=true`, *and* each user opts in
under **Settings → Privacy**. Your exact date of birth is never sent — age is
derived and sent as a number. Leave `VISION_PROVIDER` unset and no health data
leaves the machine at all.

## Security

- **Registration is closed by default.** A fresh instance lets you create the
  first account, then closes. Use `ALLOW_REGISTRATION` + `REGISTRATION_INVITE_CODE`
  to add people.
- **Sessions are revocable.** Logging out, changing your password, or deleting
  your account invalidates tokens server-side immediately. A password change
  signs you out everywhere else.
- **`JWT_SECRET` must be strong.** Production won't boot without a 32+ character
  secret. Generate one with `openssl rand -hex 32`.
- **Set `TRUSTED_PROXIES`** if you run behind a reverse proxy, or the login rate
  limiter can't see real client IPs. Never list a range you don't control.
- **Put TLS in front of it.** Lyftr speaks plain HTTP; a reverse proxy
  (Caddy, nginx, Cloudflare Tunnel) terminates TLS. Don't expose it to the
  internet without one.

---

## Running on a VPS

> Because paying $15/month for a fitness app subscription is money better spent on protein powder.

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin

mkdir lyftr && cd lyftr
curl -o docker-compose.yml https://raw.githubusercontent.com/Cawlumm/lyftr/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/Cawlumm/lyftr/main/.env.example
nano .env   # set JWT_SECRET and CORS_ORIGIN

docker compose up -d
```

For HTTPS, put Lyftr behind Caddy or nginx with a Let's Encrypt certificate.

---

## Roadmap

- [x] Workout logging + program builder
- [x] Active workout mode (list + gym mode layouts)
- [x] Exercise detail — PRs, progression chart, muscle diagram
- [x] Dashboard with charts and trends
- [x] Weight tracking with trend graph + lbs/kg support
- [x] Docker deployment with E2E test pipeline
- [x] Nutrition tracking — calories, macros, Open Food Facts search, barcode scan, history
- [ ] PWA — installable on any device without an app store
- [ ] Strong / Hevy CSV import — so you don't lose years of data switching
- [ ] Apple Health / Google Fit export
- [ ] iOS app (Swift)
- [ ] Hosted option (no self-hosting required)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Go, Gin, SQLite |
| Frontend | React, TypeScript, Tailwind CSS, Vite |
| Auth | JWT with refresh tokens |
| Deployment | Docker, nginx |

---

## Development

```bash
# Backend (runs on :3000)
cd backend && go run main.go

# Frontend (runs on :5173, proxies /api to :3000)
cd web && npm install && npm run dev
```

See `backend/config/config.go` for all supported environment variables.

---

## Contributing

Bug reports, feature requests, and pull requests are all welcome. Open an issue before submitting large changes — unlike leg day, communication should not be skipped.

---

## License

[MIT](LICENSE)
