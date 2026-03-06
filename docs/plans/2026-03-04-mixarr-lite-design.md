# Mixarr Lite — Design Document

> **Created:** March 4, 2026  
> **Status:** Design Approved  
> **Origin:** Competitive analysis against [Aurral](https://github.com/lklynet/aurral) (March 2026)

---

## Vision

Mixarr Lite is a simplified fork of Mixarr targeting users who would choose Aurral today because it's simple and "just works." It keeps Mixarr's core strengths (subscription engine, review queue, SkyHook cache warming, library health) while matching Aurral's deployment simplicity (single container, SQLite, zero external deps) and adopting Aurral's best UX ideas (Weekly Flow playlists, tag-based discovery, artist audio previews).

**Target User:** Self-hosters running Lidarr who want music discovery with minimal config. May be switching from Aurral. Values ease of setup over breadth of integrations. Likely runs on a Raspberry Pi, NAS, or small homelab.

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Database | SQLite (Prisma) | Zero deps, single file backup, Aurral-grade simplicity |
| Job Queue | In-process (node-cron + FIFO queue) | No Redis dependency |
| Frontend | Vite + React SPA | No SSR needed for a dashboard; single process serves everything |
| Project Structure | Flat (no monorepo) | One package.json, one install, one build |
| Auth | Local + reverse-proxy headers | Covers 95% of self-hosted use cases, zero auth libraries |
| Sessions | Signed cookies | Stateless, no session store needed |
| Soulseek | Built-in client (slsk-client) | No external slskd instance to manage |
| TLS | User's own reverse proxy | No embedded Caddy; document HTTPS requirement for Spotify OAuth |

---

## Service Integrations (8, down from 10+)

| Service | Role | Subscription Types |
|---|---|---|
| **Lidarr** | Target (add artists) + library health | — |
| **Spotify** | Discovery source | Playlists, Followed Artists, New Releases, Discover Weekly, Daily Mix, Saved Albums |
| **Last.fm** | Discovery + tags + metadata | Charts, Tag/Genre feeds, Geo charts, User Library, Similar Artists |
| **MusicBrainz** | Metadata + search | New Releases |
| **Deezer** | Audio previews + album art | (Not a subscription source — preview/art API only) |
| **Jellyfin** | Recommendations from listening history | Similar Artist recommendations |
| **Tautulli/Plex** | Recommendations from listening history | Top artists, recommendations |
| **Navidrome** | Weekly Flow playlist delivery | (Not a subscription source — library/playlist integration only) |

**Dropped:** Tidal, Discogs, Bandcamp, ListenBrainz, AI recommendations.

---

## Architecture & Project Structure

Single Node.js process serving both API and frontend:

```
mixarr-lite/
├── backend/
│   ├── config/          # DB setup, constants, env loading
│   ├── middleware/       # Auth, rate-limit, error handling
│   ├── routes/          # Express route handlers
│   ├── services/        # Business logic (one file per integration)
│   ├── jobs/            # In-process job scheduler + strategies
│   └── server.ts        # Entry point — Express + static serving
├── frontend/
│   ├── src/
│   │   ├── components/  # Shared UI components
│   │   ├── pages/       # React Router pages
│   │   ├── hooks/       # React Query hooks, useWebSocket, etc.
│   │   ├── contexts/    # Auth, Toast, Theme
│   │   └── utils/       # API client, helpers
│   ├── public/          # PWA manifest, icons
│   └── index.html       # Vite entry
├── prisma/
│   └── schema.prisma    # SQLite schema
├── Dockerfile           # Single, simple Dockerfile
├── docker-compose.yml   # ~8 lines
├── package.json         # Single root package.json
├── tsconfig.json        # Single TS config
└── vite.config.ts       # Frontend build config
```

Express serves the Vite build output via `express.static('frontend/dist')` with a catchall to `index.html` for SPA routing. API routes live under `/api/*`. WebSocket (Socket.IO) attaches to the same HTTP server.

One `npm install`, one `npm run dev` (concurrently runs backend + Vite dev server with proxy), one `npm run build` produces a deployable artifact.

---

## Database Schema (SQLite via Prisma)

12 models (down from 18):

```
User              — id, username, passwordHash, role (admin/user), createdAt
Connection        — id, userId, type (enum: 7 types), name, config (JSON), createdAt
Subscription      — id, userId, connectionId, type (enum: ~18 types), name, config (JSON),
                    schedule, resultHandling, resultLimit, enabled, lastRunAt, createdAt
SubscriptionRun   — id, subscriptionId, status, resultCount, addedCount, skippedCount,
                    error, startedAt, completedAt
SubscriptionResult — id, runId, subscriptionId, artistName, artistMbid, albumName,
                    status (pending/added/skipped/queued/rejected), source
ReviewItem        — id, userId, artistName, artistMbid, source, status (pending/approved/rejected),
                    createdAt
GlobalSetting     — key, value (JSON)
UserSetting       — id, userId, key, value (JSON)
NotificationChannel — id, userId, type (discord/webhook), name, config (JSON), enabled
LogEntry          — id, level, category, message, meta (JSON), createdAt
Flow              — id, userId, name, mix (JSON), size, schedule, enabled,
                    nextRunAt, createdAt
FlowJob           — id, flowId, artistName, trackName, status
                    (queued/downloading/complete/failed), filePath, error,
                    createdAt, updatedAt
```

**Key differences from full Mixarr:**
- `ConnectionType` enum: 7 types (spotify, lastfm, musicbrainz, deezer, lidarr, jellyfin, tautulli)
- `SubscriptionType` enum: ~18 types (down from 45+)
- `Flow` and `FlowJob` are new models for Weekly Flow
- `NotificationType`: 2 types (discord, webhook)
- No `Session`, `SsoProvider`, `AuthIdentity`, `AISettings`, `ImportSource`, `SlskdDownload` tables

**SQLite-specific notes:**
- JSON fields stored as `String` with manual `JSON.parse/stringify` (Prisma SQLite doesn't have native JSON type)
- `@db.Text` annotations removed (not needed with SQLite)
- WAL journal mode enabled on startup (`PRAGMA journal_mode=WAL`) for concurrent read/write support
- `busy_timeout=5000` configured in Prisma connection string to handle concurrent write contention

---

## Job System

### Subscription Scheduler

- Uses `node-cron` to check for due subscriptions every minute
- On trigger: runs the subscription strategy in-process, writes results to `SubscriptionResult`
- Strategy pattern — one function per service type (spotify, lastfm, etc.)
- **FIFO queue with single active runner** (in-process mutex) — prevents concurrent subscription execution
- Configurable delay between runs to respect external API rate limits
- **Startup cleanup:** Check for `SubscriptionRun` records with `running` status older than 30 minutes, mark as `failed`

### Weekly Flow Pipeline

Multi-stage pipeline:

```
1. GENERATE  → Pick tracks from discovery cache / subscription results
              → Use Last.fm similar artists + Deezer top tracks to build tracklist
              → Write FlowJob rows (status: queued)

2. DOWNLOAD  → Built-in Soulseek client (slsk-client npm package)
              → Process jobs sequentially with 2s cooldown between downloads
              → Search → pick best match (format/bitrate scoring) → download to staging
              → 60s per-track download timeout to prevent hung connections
              → On success: move to final path, update FlowJob status
              → On failure: retry once, then mark failed

3. ORGANIZE  → Final path: /downloads/mixarr-flow/<flow-name>/<Artist>/<Track>.ext
              → Write Navidrome smart playlist files (.nsp) if Navidrome configured
              → Trigger Navidrome library scan via API

4. NOTIFY    → WebSocket push for real-time progress (queued → downloading → complete)
              → Discord/webhook notification on flow completion
```

**Soulseek client lifecycle:**
- Auto-generated random username/password on first run (stored in `GlobalSetting`), or user-provided via Settings UI
- Connects on-demand when a flow starts
- **5-minute idle timeout** after last download completes, then disconnects
- **Process exit handler** calls disconnect on shutdown
- **Connection failure handling:** On connect failure, mark all queued jobs as `failed` with error message, notify user via WebSocket

**Startup cleanup:**
- Delete `/data/downloads/mixarr-flow/_staging/` directory (orphaned partial downloads)
- Reset any `FlowJob` records with `downloading` status to `queued` for retry

**Key advantage over Aurral:** Flow can draw tracks from *any subscription result* (Spotify Discover Weekly, Last.fm tags, Jellyfin recommendations), not just Last.fm discovery cache.

---

## Frontend Pages (7 routes)

### `/` — Discover (home)
- **Recently Added** — last 6 artists added to Lidarr
- **Upcoming Releases** — future release dates for monitored artists
- **Recommended for You** — artists from subscription results
- **Because You Like [tag]** — genre sections from library tags (Last.fm)
- **Global Trending** — Last.fm top artists
- **Explore by Tag** — clickable tag pills navigating to tag search
- Customizable section order (drag-and-drop modal)
- "In Library" badge on artist cards

### `/search` — Search & Tag Browse
- Real-time artist search via MusicBrainz (Last.fm image enrichment)
- Tag search mode (`#rock`, `#shoegaze`) with scope toggle (recommended vs. all)
- Results show artist type, country, library status badge

### `/artist/:mbid` — Artist Detail
- Hero banner with image, bio (Last.fm), tags
- Release groups with album art, filterable by type
- **Audio preview player** — Deezer 30s top tracks, inline play/pause with progress bar
- Similar artists carousel (Last.fm)
- Add to Lidarr with monitor option selector + SkyHook cache warming

### `/queue` — Review Queue
- Pending items from subscriptions in `queue` mode
- Bulk approve/reject with multi-select
- Audio preview per item
- Source attribution (which subscription found this artist)

### `/flow` — Weekly Flow
- List of flows with status (idle/running/complete)
- Create flow: name, track count, mix mode, tag weights
- Per-flow job list with real-time WebSocket status
- Start/stop controls, manual refresh

### `/library` — Library Browser
- Lidarr library with search, sort (name/date added/album count)
- Library health indicators (missing metadata, incomplete artists)

### `/settings` — Settings
- Connections (Lidarr, Spotify, Last.fm, etc.) with test buttons
- Subscriptions management (CRUD + enable/disable)
- Soulseek credentials
- Navidrome integration
- Notification channels (Discord, webhook)
- User management (admin only)
- PUID/PGID display and guidance
- About/version

---

## Deployment

### Dockerfile (~40 lines)
```
Stage 1: Build frontend (Vite) + compile backend (tsc)
Stage 2: Production — Node 20 alpine, copy dist, npm ci --omit=dev
          EXPOSE 3000
          Entry: node backend/dist/server.js
```

### docker-compose.yml
```yaml
services:
  mixarr:
    image: ghcr.io/aquantumofdonuts/mixarr-lite:latest
    container_name: mixarr-lite
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      - PUID=1000
      - PGID=1000
    restart: unless-stopped
```

### Auto-configuration
- `SESSION_SECRET`: Auto-generated on first run, persisted to `/data/.session-secret`
- `DATABASE_URL`: Always `file:/data/mixarr.db` (not configurable — simplicity)
- `BASE_URL`: Optional, only needed for Spotify OAuth callback URL. Inferred from request headers otherwise.

### PUID/PGID Support
- Entrypoint script checks if running as root
- If root + PUID/PGID set: creates `mixarr` user with those IDs, `chown /data`, re-execs via `su-exec`
- If not root: runs as-is (Kubernetes/rootless Docker)
- Standard *arr ecosystem pattern

### Data Directory
```
/data/
├── mixarr.db          # SQLite database
├── .session-secret    # Auto-generated, persisted
├── logs/              # Application logs (optional)
└── downloads/         # Weekly Flow downloads
    └── mixarr-flow/
        └── <flow-name>/
            └── <Artist>/
                └── <Track>.ext
```

### First-Run Onboarding
1. Create admin account
2. Connect Lidarr (URL + API key, test button)
3. Set MusicBrainz contact email
4. Optional: Connect Spotify, Last.fm, Navidrome
5. Everything adjustable later in Settings

---

## Auth

- **Local auth:** Username/password with bcrypt. First-run onboarding creates admin.
- **Reverse-proxy header forwarding:** Support `X-Forwarded-User` header from Authentik/Authelia/Traefik Forward Auth. Configurable via env vars:
  ```
  AUTH_PROXY_ENABLED=true
  AUTH_PROXY_HEADER=X-Forwarded-User
  AUTH_PROXY_ADMIN_USERS=alice,bob
  ```
- **Sessions:** Signed cookies (stateless). Secret auto-generated and persisted to `/data/.session-secret`. If secret file deleted, all sessions invalidated (users re-login).
- **Roles:** `admin` and `user` only.

---

## Why Mixarr Lite Beats Aurral

| Advantage | Detail |
|---|---|
| **Review Queue** | Aurral has no staging area — artists go straight to Lidarr. Lite has subscription-fed queue with bulk approve/reject. |
| **More Discovery Sources** | 5 services (Spotify, Last.fm, MusicBrainz, Jellyfin, Tautulli) vs. Aurral's 2 (MusicBrainz, Last.fm). |
| **Subscription Scheduling** | Per-subscription cron schedules vs. Aurral's single 24-hour refresh interval. |
| **SkyHook Cache Warming** | Artist adds succeed first time. Aurral gets silent 503 failures on uncached artists. |
| **Smarter Weekly Flow** | Flow draws from all subscription results (Spotify, Last.fm, Jellyfin, etc.), not just Last.fm discovery cache. |
| **TypeScript + Tests** | Typed end-to-end with Prisma, Zod validation, test suite. Aurral is vanilla JS with zero tests. |
| **Library Health** | Detect and fix missing metadata, incomplete artists. Aurral doesn't touch existing library. |

**What Aurral still has that Lite doesn't:**
- Navidrome streaming proxy (Lite integrates for playlists/library but doesn't proxy audio)
- Gotify notifications (Lite has Discord + webhook instead)

---

## Design Attack Results

Seven implementation-level issues identified and resolved — no architectural contradictions:

| # | Issue | Fix |
|---|---|---|
| 1 | Staging file orphans on restart | Delete `_staging/` dir + reset `downloading` jobs to `queued` on startup |
| 2 | Soulseek connection failure | Explicit error → mark jobs failed, notify via WebSocket |
| 3 | Spotify OAuth needs HTTPS | Optional `BASE_URL` env var for OAuth callback; document HTTPS requirement |
| 4 | Soulseek client idle disconnect | 5-minute idle timeout + process exit cleanup handler |
| 5 | SQLite concurrent write contention | `busy_timeout=5000` + WAL journal mode on startup |
| 6 | Subscription concurrency | In-process FIFO queue with single active runner (mutex) |
| 7 | Download timeout | 60s per-track timeout to prevent hung Soulseek connections |

---

## What's NOT in Lite (Conscious Cuts)

| Feature | Why Dropped |
|---|---|
| AI recommendations | Two SDKs, API key config, model selection — complexity for a "nice to have" |
| Tidal integration | Niche; Spotify covers mainstream streaming discovery |
| Discogs integration | Label/style niche; power-user territory |
| Bandcamp integration | Specialized; limited API |
| ListenBrainz integration | Power-user tool; Last.fm covers similar ground |
| Google OAuth / LDAP / SAML / Plex SSO | Reverse-proxy headers handle SSO generically |
| 5 notification channels | Discord + webhook covers 90% of self-hosters |
| Caddy reverse proxy | Users bring their own; keeps container simple |
| MySQL / Redis | SQLite + in-process jobs eliminates both |
| Monorepo (Turborepo) | Flat structure, single package.json |
| Next.js SSR | No SEO benefit for a private dashboard |
