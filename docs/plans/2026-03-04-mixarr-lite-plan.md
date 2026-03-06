# Mixarr Lite — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a simplified fork of Mixarr as a new greenfield project — single container, SQLite, Vite SPA, flat structure — that matches Aurral's deployment simplicity while keeping Mixarr's core strengths and adding Weekly Flow.

**Architecture:** Single Node.js process serving Express API + Vite-built SPA. SQLite via Prisma. In-process job scheduling via node-cron. Built-in Soulseek client for Weekly Flow downloads. Socket.IO for real-time updates.

**Tech Stack:** TypeScript, Express, Prisma (SQLite), Vite, React 18, React Router, TanStack React Query, Tailwind CSS, Socket.IO, Zod, Vitest

**Design Document:** `docs/plans/2026-03-04-mixarr-lite-design.md`

**Source Reference:** Business logic ported from `apps/api/src/` in the main Mixarr repo. Frontend is a complete rewrite (Next.js App Router → Vite + React Router).

---

## Overview & Phases

This is a greenfield project, not a branch of full Mixarr. New repository, new structure.

| Phase | Name | Effort | Depends On |
|---|---|---|---|
| 0 | Project Scaffold | ~0.5 day | — |
| 1 | Backend Foundation (Auth, DB, Middleware) | ~1-2 days | Phase 0 |
| 2 | Lidarr Integration + Library Health | ~1-2 days | Phase 1 |
| 3 | Discovery Services (Spotify, Last.fm, MusicBrainz, Deezer, Jellyfin, Tautulli) | ~2-3 days | Phase 1 |
| 4 | Subscription Engine (Scheduler, Strategies, Results) | ~2-3 days | Phase 2, 3 |
| 5 | Review Queue | ~1 day | Phase 4 |
| 6 | Frontend Core (Auth, Layout, Settings, Onboarding) | ~2-3 days | Phase 1 |
| 7 | Frontend Discovery Pages (Discover, Search, Artist, Library, Queue) | ~3-4 days | Phase 5, 6 |
| 8 | Weekly Flow (Soulseek, Navidrome, Pipeline, UI) | ~3-4 days | Phase 4, 7 |
| 9 | Deployment (Docker, PUID/PGID, Notifications, Polish) | ~1-2 days | Phase 8 |

**Total estimated effort:** 15-25 days

---

## Phase 0: Project Scaffold

### Task 0.1: Initialize Repository & Package.json

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.nvmrc`

**Steps:**
1. Create new repository directory `mixarr-lite/`
2. `npm init` with name `mixarr-lite`, version `0.1.0`
3. Install core dependencies:
   ```
   # Backend
   npm i express cors helmet express-rate-limit cookie-parser
   npm i @prisma/client zod socket.io cron bcryptjs uuid
   npm i -D typescript @types/node @types/express @types/cookie-parser @types/bcryptjs @types/uuid
   npm i -D prisma vitest @types/cors

   # Frontend
   npm i react react-dom react-router-dom @tanstack/react-query lucide-react clsx
   npm i -D vite @vitejs/plugin-react tailwindcss postcss autoprefixer
   npm i -D @types/react @types/react-dom
   ```
4. Create `.nvmrc` with `20`
5. Create `.gitignore` (node_modules, dist, *.db, .session-secret)
6. Commit: `"chore: initialize project"`

---

### Task 0.2: TypeScript & Build Configuration

**Files:**
- Create: `tsconfig.json` (backend)
- Create: `tsconfig.frontend.json`
- Create: `vite.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`

**Steps:**
1. Create `tsconfig.json` — target ES2022, module NodeNext, strict, outDir `backend/dist`, rootDir `backend/src`
2. Create `vite.config.ts` — React plugin, proxy `/api` and `/socket.io` to `localhost:3005` in dev, build output to `frontend/dist`
3. Create `tailwind.config.ts` — content paths point to `frontend/src/**/*.{ts,tsx}`, dark mode class-based
4. Create `postcss.config.js` — tailwind + autoprefixer
5. Add npm scripts to `package.json`:
   ```json
   {
     "scripts": {
       "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\"",
       "dev:backend": "tsx watch backend/src/server.ts",
       "dev:frontend": "vite --config vite.config.ts",
       "build": "npm run build:frontend && npm run build:backend",
       "build:frontend": "vite build --config vite.config.ts",
       "build:backend": "tsc -p tsconfig.json",
       "start": "node backend/dist/server.js",
       "db:generate": "prisma generate",
       "db:push": "prisma db push",
       "db:migrate": "prisma migrate dev",
       "test": "vitest run",
       "test:watch": "vitest"
     }
   }
   ```
6. Install `concurrently` and `tsx` as dev deps
7. Commit: `"chore: add TypeScript, Vite, and Tailwind configuration"`

---

### Task 0.3: Directory Structure & Entry Points

**Files:**
- Create: `backend/src/server.ts` (minimal Express + static serving)
- Create: `frontend/src/main.tsx` (React entry)
- Create: `frontend/src/App.tsx` (React Router shell)
- Create: `frontend/index.html` (Vite entry)
- Create: `frontend/src/index.css` (Tailwind directives)

**Steps:**
1. Create directory structure:
   ```
   backend/src/
   backend/src/config/
   backend/src/middleware/
   backend/src/routes/
   backend/src/services/
   backend/src/jobs/
   frontend/src/
   frontend/src/components/
   frontend/src/pages/
   frontend/src/hooks/
   frontend/src/contexts/
   frontend/src/utils/
   frontend/public/
   prisma/
   ```
2. Create `backend/src/server.ts`:
   - Express app on port `process.env.PORT || 3000`
   - `express.static('frontend/dist')` for production
   - Catchall `res.sendFile('frontend/dist/index.html')` for SPA routing
   - API routes under `/api/*`
   - Health check at `/api/health` returning `{ status: 'ok' }`
3. Create `frontend/index.html` with Vite entry point
4. Create `frontend/src/main.tsx` rendering `<App />`
5. Create `frontend/src/App.tsx` with React Router and placeholder routes
6. Create `frontend/src/index.css` with Tailwind `@tailwind` directives
7. Verify: `npm run dev` starts both servers, `http://localhost:5173` shows React app, `/api/health` returns OK
8. Commit: `"feat: add Express server and Vite React SPA entry points"`

---

### Task 0.4: Prisma Schema & SQLite Setup

**Files:**
- Create: `prisma/schema.prisma`
- Create: `backend/src/config/db.ts`

**Steps:**
1. Create `prisma/schema.prisma` with SQLite provider:
   - All 12 models from design doc (User, Connection, Subscription, SubscriptionRun, SubscriptionResult, ReviewItem, GlobalSetting, UserSetting, NotificationChannel, LogEntry, Flow, FlowJob)
   - All enums (UserRole, ConnectionType, SubscriptionType, RunStatus, ResultHandling, ReviewStatus, FlowJobStatus, NotificationType, LogLevel)
   - JSON fields as `String` (SQLite limitation)
   - `datasource db { provider = "sqlite", url = "file:/data/mixarr.db" }` with env override
2. Create `backend/src/config/db.ts`:
   - Initialize PrismaClient with `busy_timeout=5000` in connection string
   - On connect: execute `PRAGMA journal_mode=WAL`
   - Export singleton `prisma` instance
3. Run `npx prisma generate` and `npx prisma db push`
4. Verify: SQLite file created, Prisma client generated
5. Commit: `"feat: add Prisma schema with SQLite and all 12 models"`

---

## Phase 1: Backend Foundation

### Task 1.1: Environment & Configuration

**Files:**
- Create: `backend/src/config/env.ts`
- Create: `backend/src/config/constants.ts`

**Steps:**
1. Create `env.ts`:
   - Load/generate `SESSION_SECRET` from `/data/.session-secret` (create file if missing, generate 64-char hex)
   - `PORT` (default 3000)
   - `BASE_URL` (optional, for Spotify OAuth callback)
   - `AUTH_PROXY_ENABLED`, `AUTH_PROXY_HEADER`, `AUTH_PROXY_ADMIN_USERS`
   - `MUSICBRAINZ_CONTACT_EMAIL`
   - `DATABASE_URL` (default `file:/data/mixarr.db`)
2. Create `constants.ts` — MusicBrainz API URL, Last.fm API URL, rate limit defaults, app name/version
3. Write tests for env loading (session secret generation, defaults)
4. Commit: `"feat: add environment configuration and constants"`

---

### Task 1.2: Auth Middleware (Local + Proxy Headers)

**Files:**
- Create: `backend/src/middleware/auth.ts`
- Create: `backend/src/routes/auth.ts`
- Test: `backend/tests/middleware/auth.test.ts`
- Test: `backend/tests/routes/auth.test.ts`

**Steps:**
1. Create `auth.ts` middleware:
   - Parse signed cookie `mixarr_session` containing `{ userId, username, role }`
   - If `AUTH_PROXY_ENABLED`: check `X-Forwarded-User` header, auto-create user if not exists, check admin list
   - Attach `req.user` with `{ id, username, role }`
   - Export `requireAuth` middleware (401 if no user)
   - Export `requireAdmin` middleware (403 if not admin)
2. Create auth routes (`/api/auth/*`):
   - `POST /api/auth/login` — validate username/password with bcrypt, set signed cookie
   - `POST /api/auth/logout` — clear cookie
   - `GET /api/auth/me` — return current user
   - `POST /api/auth/setup` — first-run admin creation (only works if zero users exist)
3. Write tests: login flow, cookie validation, proxy header auth, setup endpoint
4. Commit: `"feat: add local auth with signed cookies and proxy header support"`

---

### Task 1.3: Core Middleware Stack

**Files:**
- Create: `backend/src/middleware/error-handler.ts`
- Create: `backend/src/middleware/rate-limiter.ts`
- Create: `backend/src/middleware/request-logger.ts`
- Modify: `backend/src/server.ts` — wire middleware

**Steps:**
1. Error handler: catch-all Express error handler, log to console + `LogEntry` table, return structured JSON error
2. Rate limiter: `express-rate-limit` with 5000 req / 15 min window on `/api/*`
3. Request logger: log method, path, status, duration to console (structured JSON)
4. Wire into server.ts: `helmet()`, `cors()`, `express.json()`, rate limiter, request logger, auth middleware, routes, error handler
5. Global error handlers: `process.on('unhandledRejection')` and `process.on('uncaughtException')` with logging
6. Commit: `"feat: add error handling, rate limiting, and request logging middleware"`

---

### Task 1.4: User Management Routes

**Files:**
- Create: `backend/src/routes/users.ts`
- Create: `backend/src/schemas/users.ts` (Zod)
- Test: `backend/tests/routes/users.test.ts`

**Steps:**
1. Zod schemas for create/update user input
2. Routes (admin only):
   - `GET /api/users` — list all users
   - `POST /api/users` — create user (bcrypt hash password)
   - `PUT /api/users/:id` — update user (role, password)
   - `DELETE /api/users/:id` — delete user (prevent self-delete)
3. Routes (self):
   - `PUT /api/users/me` — update own password
4. Tests: CRUD operations, role enforcement, self-delete prevention
5. Commit: `"feat: add user management routes with Zod validation"`

---

### Task 1.5: Settings Routes (Global + User)

**Files:**
- Create: `backend/src/routes/settings.ts`
- Test: `backend/tests/routes/settings.test.ts`

**Steps:**
1. Routes:
   - `GET /api/settings` — return all GlobalSettings as key-value object
   - `PUT /api/settings` — update GlobalSettings (admin only)
   - `GET /api/settings/user` — return current user's UserSettings
   - `PUT /api/settings/user` — update current user's UserSettings
2. Settings include: MusicBrainz email, Soulseek credentials, onboarding state, Navidrome config
3. Tests: get/set, admin enforcement, user isolation
4. Commit: `"feat: add global and user settings routes"`

---

### Task 1.6: WebSocket Setup (Socket.IO)

**Files:**
- Create: `backend/src/config/websocket.ts`
- Modify: `backend/src/server.ts` — attach Socket.IO

**Steps:**
1. Create Socket.IO server attached to the Express HTTP server
2. Auth middleware on connection: validate signed cookie from handshake
3. Export `broadcast(channel, event, data)` helper for backend services to push updates
4. Channels: `subscription:progress`, `flow:progress`, `queue:update`
5. Verify: client can connect via `socket.io-client` in Vite dev
6. Commit: `"feat: add Socket.IO WebSocket server with auth"`

---

### Task 1.7: Connection Management Routes

**Files:**
- Create: `backend/src/routes/connections.ts`
- Create: `backend/src/schemas/connections.ts` (Zod)
- Test: `backend/tests/routes/connections.test.ts`

**Steps:**
1. Zod schemas for connection create/update (type, name, config JSON)
2. Routes:
   - `GET /api/connections` — list user's connections
   - `POST /api/connections` — create connection
   - `PUT /api/connections/:id` — update connection
   - `DELETE /api/connections/:id` — delete connection
   - `POST /api/connections/:id/test` — test connection (delegates to service)
3. Connection types: `lidarr`, `spotify`, `lastfm`, `musicbrainz`, `deezer`, `jellyfin`, `tautulli`
4. Config stored as JSON string in SQLite, parsed on read
5. Tests: CRUD, test endpoint, per-user isolation
6. Commit: `"feat: add connection management routes"`

---

## Phase 2: Lidarr Integration + Library Health

### Task 2.1: Lidarr Service

**Files:**
- Create: `backend/src/services/lidarr.ts`
- Test: `backend/tests/services/lidarr.test.ts`

**Port from:** `apps/api/src/services/lidarr.ts` (837 lines) — trim to essential methods.

**Steps:**
1. Port core methods:
   - `testConnection()` — verify URL + API key
   - `getArtists()` — fetch library artists
   - `getArtist(id)` — fetch single artist
   - `searchArtist(term)` — search Lidarr
   - `lookupArtist(mbid)` — lookup by MusicBrainz ID
   - `addArtist(mbid, options)` — add artist with options object pattern (monitored, searchForMissing, monitorOption)
   - `getQualityProfiles()` — for settings UI
   - `getMetadataProfiles()` — for settings UI
   - `getRootFolders()` — for settings UI
   - `getAlbums(artistId)` — for library view
   - `getRecentAlbums()` — for Discover page "Upcoming Releases"
2. All methods use `fetchWithTimeout` wrapper (60s default, AbortSignal.timeout)
3. Constructor takes `{ url, apiKey }` config
4. Tests: mock fetch, verify URL construction, error handling
5. Commit: `"feat: add Lidarr service with core artist and library methods"`

---

### Task 2.2: SkyHook Cache Warmer

**Files:**
- Create: `backend/src/services/skyhook-cache-warmer.ts`
- Test: `backend/tests/services/skyhook-cache-warmer.test.ts`

**Port from:** `apps/api/src/services/skyhook-cache-warmer.ts` (210 lines)

**Steps:**
1. Port the cache warming logic:
   - Before adding an artist, ping SkyHook (`https://skyhook.sonarr.tv/v1/musicbrainz/artist/{mbid}`)
   - If not cached (404), wait and retry (up to 3 attempts with exponential backoff)
   - If cached, proceed with add
2. Export `warmCache(mbid)` function
3. Tests: mock fetch, verify retry logic, timeout handling
4. Commit: `"feat: add SkyHook cache warmer for reliable artist adds"`

---

### Task 2.3: Library Health Service

**Files:**
- Create: `backend/src/services/library-health.ts`
- Create: `backend/src/routes/library.ts`
- Test: `backend/tests/services/library-health.test.ts`

**Steps:**
1. Library health analysis:
   - `analyzeLibrary()` — check for missing metadata, incomplete artists, unmonitored artists
   - `refreshArtist(id)` — trigger Lidarr refresh for single artist
   - `getLibraryStats()` — artist count, album count, track count, health issues
2. Library routes:
   - `GET /api/library` — list Lidarr artists with search/sort/pagination
   - `GET /api/library/stats` — library statistics
   - `GET /api/library/health` — health issues list
   - `POST /api/library/refresh/:id` — refresh single artist
   - `GET /api/library/recent` — recently added artists (for Discover page)
   - `GET /api/library/upcoming` — upcoming releases (for Discover page)
3. Commit: `"feat: add library health service and routes"`

---

## Phase 3: Discovery Services

### Task 3.1: Spotify Service

**Files:**
- Create: `backend/src/services/spotify.ts`
- Test: `backend/tests/services/spotify.test.ts`

**Port from:** `apps/api/src/services/spotify.ts` (736 lines)

**Steps:**
1. Port OAuth flow (authorization code flow):
   - `getAuthUrl(redirectUri)` — generate Spotify OAuth URL
   - `exchangeCode(code, redirectUri)` — exchange code for tokens
   - `refreshToken(refreshToken)` — refresh expired access token
2. Port data fetching methods:
   - `getPlaylists(token)` — user's playlists
   - `getPlaylistTracks(token, playlistId)` — tracks with artist extraction
   - `getFollowedArtists(token)`
   - `getNewReleases(token)`
   - `getSavedAlbums(token)`
3. Add Spotify OAuth callback route in connections routes
4. Note: `BASE_URL` env var required for OAuth redirect URI
5. Tests: mock responses, token refresh logic
6. Commit: `"feat: add Spotify service with OAuth and data fetching"`

---

### Task 3.2: Last.fm Service

**Files:**
- Create: `backend/src/services/lastfm.ts`
- Test: `backend/tests/services/lastfm.test.ts`

**Port from:** `apps/api/src/services/lastfm.ts` (638 lines)

**Steps:**
1. Port methods:
   - `getTopArtists(apiKey, options)` — charts
   - `getTagTopArtists(apiKey, tag, limit)` — tag-based discovery
   - `getGeoTopArtists(apiKey, country)` — geo charts
   - `getSimilarArtists(apiKey, artist)` — similar artists
   - `getArtistInfo(apiKey, artist)` — bio, tags, images
   - `getUserTopArtists(apiKey, username, period)` — user library
   - `getTopTags(apiKey)` — global top tags
   - `searchArtist(apiKey, query)` — artist search
2. All methods use `fetchWithTimeout` wrapper
3. Rate limiting: 1 request per second to Last.fm API
4. Tests: mock responses, rate limit behavior
5. Commit: `"feat: add Last.fm service with charts, tags, and similar artists"`

---

### Task 3.3: MusicBrainz Service

**Files:**
- Create: `backend/src/services/musicbrainz.ts`
- Test: `backend/tests/services/musicbrainz.test.ts`

**Port from:** `apps/api/src/services/musicbrainz.ts` (345 lines)

**Steps:**
1. Port methods:
   - `searchArtist(query, limit, offset)` — artist search
   - `getArtist(mbid)` — artist details
   - `getArtistReleaseGroups(mbid)` — release groups
   - `getNewReleases(days)` — recent releases
2. User-Agent header: `MixarrLite/0.1.0 (${MUSICBRAINZ_CONTACT_EMAIL})`
3. Rate limiting: 1 request per second (MusicBrainz policy)
4. Tests: mock responses, rate limit compliance
5. Commit: `"feat: add MusicBrainz service with search and release groups"`

---

### Task 3.4: Deezer Service (Previews & Art)

**Files:**
- Create: `backend/src/services/deezer.ts`
- Test: `backend/tests/services/deezer.test.ts`

**Port from:** `apps/api/src/services/deezer.ts` (303 lines) — only preview/art methods, no subscription source.

**Steps:**
1. Port methods:
   - `searchArtist(query)` — find Deezer artist ID
   - `getArtistTopTracks(artistId)` — top tracks with 30s preview URLs
   - `getArtistImage(artistId)` — artist artwork
   - `getAlbumCover(albumId)` — album artwork
2. No OAuth needed — Deezer preview API is public
3. Tests: mock responses
4. Commit: `"feat: add Deezer service for audio previews and artwork"`

---

### Task 3.5: Jellyfin Service

**Files:**
- Create: `backend/src/services/jellyfin.ts`
- Test: `backend/tests/services/jellyfin.test.ts`

**Port from:** `apps/api/src/services/jellyfin.ts` (297 lines)

**Steps:**
1. Port methods:
   - `testConnection(url, apiKey)` — verify connectivity
   - `getArtists(url, apiKey)` — library artists
   - `getSimilarArtists(url, apiKey, artistId)` — recommendations
   - `getRecentlyPlayed(url, apiKey, userId)` — listening history
2. Tests: mock responses
3. Commit: `"feat: add Jellyfin service for library-based recommendations"`

---

### Task 3.6: Tautulli Service

**Files:**
- Create: `backend/src/services/tautulli.ts`
- Test: `backend/tests/services/tautulli.test.ts`

**Port from:** `apps/api/src/services/tautulli.ts` (278 lines)

**Steps:**
1. Port methods:
   - `testConnection(url, apiKey)` — verify connectivity
   - `getTopArtists(url, apiKey, options)` — most played artists
   - `getRecentlyPlayed(url, apiKey)` — recent listening history
2. Tests: mock responses
3. Commit: `"feat: add Tautulli service for Plex listening history recommendations"`

---

### Task 3.7: Search & Discover Routes

**Files:**
- Create: `backend/src/routes/search.ts`
- Create: `backend/src/routes/discover.ts`
- Test: `backend/tests/routes/search.test.ts`

**Steps:**
1. Search routes:
   - `GET /api/search?q=...` — search MusicBrainz, enrich with Last.fm images
   - `GET /api/search/tags?q=...` — tag search via Last.fm with scope toggle
   - `GET /api/search/tags/suggest?q=...` — tag autocomplete
2. Discover routes:
   - `GET /api/discover` — aggregated discovery data (recommendations, trending, tags, recent, upcoming)
   - `POST /api/discover/refresh` — trigger discovery cache refresh
   - `GET /api/discover/artist/:mbid` — artist detail (bio, tags, release groups, similar)
   - `GET /api/discover/artist/:mbid/preview` — Deezer top tracks with preview URLs
   - `GET /api/discover/artist/:mbid/cover` — artist artwork
3. Discovery cache: in-memory object refreshed every 24 hours (like Aurral), populated from Last.fm + library tags
4. Commit: `"feat: add search and discover routes with tag browsing and artist preview"`

---

## Phase 4: Subscription Engine

### Task 4.1: Subscription CRUD Routes

**Files:**
- Create: `backend/src/routes/subscriptions.ts`
- Create: `backend/src/schemas/subscriptions.ts` (Zod)
- Test: `backend/tests/routes/subscriptions.test.ts`

**Steps:**
1. Zod schemas for subscription create/update
2. Routes:
   - `GET /api/subscriptions` — list user's subscriptions with last run info
   - `POST /api/subscriptions` — create subscription
   - `PUT /api/subscriptions/:id` — update subscription
   - `DELETE /api/subscriptions/:id` — delete subscription
   - `POST /api/subscriptions/:id/run` — trigger manual run
   - `GET /api/subscriptions/:id/results` — get results from last run
   - `GET /api/subscriptions/:id/runs` — run history
3. Commit: `"feat: add subscription CRUD routes with Zod validation"`

---

### Task 4.2: Subscription Strategies

**Files:**
- Create: `backend/src/jobs/strategies/types.ts`
- Create: `backend/src/jobs/strategies/helpers.ts`
- Create: `backend/src/jobs/strategies/spotify.ts`
- Create: `backend/src/jobs/strategies/lastfm.ts`
- Create: `backend/src/jobs/strategies/musicbrainz.ts`
- Create: `backend/src/jobs/strategies/jellyfin.ts`
- Create: `backend/src/jobs/strategies/tautulli.ts`
- Create: `backend/src/jobs/strategies/registry.ts`
- Test: `backend/tests/jobs/strategies/*.test.ts`

**Port from:** `apps/api/src/jobs/strategies/` — port 5 strategies (drop ai, bandcamp, discogs, listenbrainz, tidal, deezer)

**Steps:**
1. Define `StrategyResult` type: `{ artists: Array<{ name, mbid?, source }> }`
2. Each strategy: async function taking `(connection, subscription)` → `StrategyResult`
3. Port strategies:
   - `spotify.ts` (~306 lines) — playlists, followed artists, new releases, discover weekly, daily mix, saved albums
   - `lastfm.ts` (~180 lines) — charts, tags, geo, user library, similar
   - `musicbrainz.ts` (~61 lines) — new releases
   - `jellyfin.ts` (~124 lines) — similar artist recommendations
   - `tautulli.ts` (~124 lines) — top artists, recommendations
4. `registry.ts` — maps `SubscriptionType` enum → strategy function
5. `helpers.ts` — shared deduplication, MusicBrainz lookup, Lidarr library check
6. Tests per strategy: mock service responses, verify artist extraction
7. Commit: `"feat: add subscription strategies for Spotify, Last.fm, MusicBrainz, Jellyfin, Tautulli"`

---

### Task 4.3: Subscription Worker (In-Process)

**Files:**
- Create: `backend/src/jobs/subscription-worker.ts`
- Test: `backend/tests/jobs/subscription-worker.test.ts`

**Port from:** `apps/api/src/jobs/subscription-worker.ts` (688 lines) — rewrite without BullMQ.

**Steps:**
1. Create `SubscriptionWorker` class:
   - `runSubscription(subscriptionId)` — execute single subscription
   - Lookup strategy from registry
   - Fetch connection config
   - Execute strategy
   - Deduplicate against existing Lidarr library
   - Write `SubscriptionResult` rows
   - Handle `resultHandling` mode: `auto` (add to Lidarr via SkyHook → addArtist), `queue` (create ReviewItem), `preview` (store results only)
   - Write `SubscriptionRun` record with counts
   - Broadcast progress via WebSocket
2. FIFO queue with mutex: only one subscription runs at a time
3. Startup cleanup: mark stale `running` SubscriptionRuns (>30 min) as `failed`
4. Tests: mock strategy + Lidarr, verify result handling modes
5. Commit: `"feat: add in-process subscription worker with FIFO queue"`

---

### Task 4.4: Cron Scheduler

**Files:**
- Create: `backend/src/jobs/scheduler.ts`
- Test: `backend/tests/jobs/scheduler.test.ts`

**Steps:**
1. Every 60 seconds: query `Subscription` table for enabled subscriptions due for run (based on `schedule` and `lastRunAt`)
2. Enqueue due subscriptions into the FIFO queue
3. Schedule parsing: support `manual`, `hourly`, `daily`, `weekly`, `monthly` (translate to cron-like logic)
4. Start scheduler on server boot (after DB init)
5. Tests: verify schedule matching, enqueue logic
6. Commit: `"feat: add cron-based subscription scheduler"`

---

## Phase 5: Review Queue

### Task 5.1: Review Queue Routes

**Files:**
- Create: `backend/src/routes/queue.ts`
- Create: `backend/src/schemas/queue.ts` (Zod)
- Test: `backend/tests/routes/queue.test.ts`

**Steps:**
1. Routes:
   - `GET /api/queue` — list pending ReviewItems for current user
   - `POST /api/queue/:id/approve` — approve item (SkyHook warm → Lidarr addArtist → update status)
   - `POST /api/queue/:id/reject` — reject item (update status)
   - `POST /api/queue/bulk` — bulk approve/reject `{ ids: [...], action: 'approve'|'reject' }`
   - `DELETE /api/queue/:id` — remove item
2. Approve flow: warm SkyHook cache → add artist to Lidarr → update ReviewItem → broadcast via WebSocket
3. Tests: approve/reject flow, bulk operations, user isolation
4. Commit: `"feat: add review queue routes with bulk approve/reject and SkyHook integration"`

---

## Phase 6: Frontend Core

### Task 6.1: API Client & Auth Context

**Files:**
- Create: `frontend/src/utils/api.ts`
- Create: `frontend/src/contexts/AuthContext.tsx`
- Create: `frontend/src/hooks/useAuth.ts`

**Steps:**
1. API client: fetch wrapper with base URL, credentials include, JSON parsing, error handling
2. Auth context: login/logout/me state, redirect to `/login` if unauthenticated
3. `useAuth` hook: expose `user`, `login()`, `logout()`, `isAdmin`
4. Commit: `"feat: add API client and auth context"`

---

### Task 6.2: Theme, Toast, & Layout

**Files:**
- Create: `frontend/src/contexts/ThemeContext.tsx`
- Create: `frontend/src/contexts/ToastContext.tsx`
- Create: `frontend/src/components/Layout.tsx`
- Create: `frontend/src/components/Sidebar.tsx`
- Create: `frontend/src/components/SearchBar.tsx`

**Steps:**
1. Theme context: dark/light mode toggle (default dark, persist to localStorage)
2. Toast context: success/error/info notifications, auto-dismiss
3. Layout: sidebar + top bar + content area
4. Sidebar: nav items (Discover, Search, Library, Queue, Flow, Settings), active indicator, mobile hamburger
5. Search bar: in top bar, submits to `/search?q=...`, supports `#tag` prefix
6. Tailwind dark theme based on Mixarr's existing color palette
7. Commit: `"feat: add layout, sidebar, theme, and toast components"`

---

### Task 6.3: Login & Onboarding Pages

**Files:**
- Create: `frontend/src/pages/Login.tsx`
- Create: `frontend/src/pages/Onboarding.tsx`

**Steps:**
1. Login page: username/password form, submit to `/api/auth/login`
2. Onboarding page (shown when no users exist):
   - Step 1: Create admin account
   - Step 2: Connect Lidarr (URL + API key + test button)
   - Step 3: MusicBrainz contact email
   - Step 4: Optional services (Spotify, Last.fm, Navidrome)
   - Each step validates before proceeding
3. Commit: `"feat: add login and onboarding pages"`

---

### Task 6.4: Settings Page

**Files:**
- Create: `frontend/src/pages/Settings.tsx`
- Create: `frontend/src/components/ConnectionCard.tsx`
- Create: `frontend/src/components/SubscriptionModal.tsx`

**Steps:**
1. Settings page with tabs: Connections, Subscriptions, Notifications, Users (admin), About
2. Connections tab: list connections with test/edit/delete, add new connection modal per type
3. Subscriptions tab: list subscriptions with enable/disable toggle, edit/delete, create modal
4. Subscription modal: connection selector → type selector → config options → schedule → result handling
5. Notifications tab: Discord webhook URL, generic webhook URL
6. Users tab (admin): user list with role badges, create/edit/delete
7. Commit: `"feat: add settings page with connections, subscriptions, and user management"`

---

### Task 6.5: PWA Manifest & Service Worker

**Files:**
- Create: `frontend/public/manifest.json`
- Create: `frontend/public/icons/` (icon files)
- Create: `frontend/src/components/ServiceWorkerRegistration.tsx`
- Create: `frontend/src/hooks/useOffline.ts`

**Steps:**
1. PWA manifest: name, short_name, icons (192 + 512, regular + maskable), start_url, display standalone
2. Vite PWA plugin (`vite-plugin-pwa`) for service worker generation
3. Offline indicator component
4. Install `vite-plugin-pwa` dev dep
5. Commit: `"feat: add PWA manifest and service worker"`

---

## Phase 7: Frontend Discovery Pages

### Task 7.1: Discover Page

**Files:**
- Create: `frontend/src/pages/Discover.tsx`
- Create: `frontend/src/components/ArtistCard.tsx`
- Create: `frontend/src/components/AlbumCard.tsx`
- Create: `frontend/src/hooks/useDiscovery.ts`

**Steps:**
1. `useDiscovery` hook: React Query fetching `/api/discover`, polling during refresh
2. Discover page sections (customizable order):
   - Recently Added (from Lidarr)
   - Upcoming Releases (from Lidarr)
   - Recommended for You (from subscription results)
   - Because You Like [tag] (genre sections from library tags)
   - Global Trending (Last.fm top artists)
   - Explore by Tag (clickable tag pills)
3. ArtistCard: image, name, type, "In Library" badge, click → `/artist/:mbid`
4. AlbumCard: cover, name, artist, release date
5. Section customization modal: drag-and-drop reorder, show/hide toggle
6. Commit: `"feat: add Discover page with tag-based genre sections and customizable layout"`

---

### Task 7.2: Search Page

**Files:**
- Create: `frontend/src/pages/Search.tsx`
- Create: `frontend/src/hooks/useSearch.ts`

**Steps:**
1. `useSearch` hook: React Query with debounced search term
2. Artist search results: grid of ArtistCards with type/country info
3. Tag search mode: detect `#` prefix, show scope toggle (recommended vs. all)
4. Load more / infinite scroll
5. "In Library" badge on each result (batch lookup against Lidarr)
6. Commit: `"feat: add Search page with artist and tag search"`

---

### Task 7.3: Artist Detail Page

**Files:**
- Create: `frontend/src/pages/ArtistDetail.tsx`
- Create: `frontend/src/components/PreviewPlayer.tsx`
- Create: `frontend/src/components/SimilarArtists.tsx`
- Create: `frontend/src/hooks/useArtistDetail.ts`
- Create: `frontend/src/hooks/usePreviewPlayer.ts`

**Steps:**
1. Artist detail layout:
   - Hero: image, name, bio (truncatable), tags, type, country
   - Release groups: filterable by type (album/EP/single), with album art
   - Preview player: Deezer 30s top tracks, inline play/pause with progress bar
   - Similar artists: horizontal scrollable carousel
   - Add to Lidarr: button with monitor option dropdown (None/All/Future/Missing/Latest/First)
2. `PreviewPlayer` component:
   - Fetch top tracks from `/api/discover/artist/:mbid/preview`
   - HTML5 `<audio>` element with play/pause toggle, progress bar, track name
   - Auto-advance to next track
3. `SimilarArtists` component: horizontal scroll with left/right arrows, "In Library" badges
4. Add to Lidarr button: calls SkyHook warm → addArtist, shows loading/success/error states
5. Commit: `"feat: add Artist Detail page with audio preview player and similar artists"`

---

### Task 7.4: Library Page

**Files:**
- Create: `frontend/src/pages/Library.tsx`
- Create: `frontend/src/hooks/useLibrary.ts`

**Steps:**
1. Library page: grid of artist cards from Lidarr
2. Search filter, sort dropdown (name, date added, album count)
3. Virtual scroll / pagination for large libraries
4. Click → Artist Detail page
5. Library health badges on artists with issues
6. Commit: `"feat: add Library page with search, sort, and health indicators"`

---

### Task 7.5: Queue Page

**Files:**
- Create: `frontend/src/pages/Queue.tsx`
- Create: `frontend/src/hooks/useQueue.ts`

**Steps:**
1. Queue page: list of pending ReviewItems
2. Per-item: artist image, name, source attribution, preview button, approve/reject buttons
3. Multi-select with bulk approve/reject bar
4. WebSocket updates for real-time queue changes
5. Empty state: "No items in queue" with link to subscriptions
6. Commit: `"feat: add Queue page with bulk approve/reject and real-time updates"`

---

### Task 7.6: WebSocket Hook

**Files:**
- Create: `frontend/src/hooks/useWebSocket.ts`
- Create: `frontend/src/contexts/WebSocketContext.tsx`

**Steps:**
1. `useWebSocket` hook: connect Socket.IO client with auth cookie
2. `useWebSocketChannel(channel, callback)` — subscribe to specific events
3. Auto-reconnect on disconnect
4. Context provider at app root
5. Commit: `"feat: add WebSocket hook and context for real-time updates"`

---

## Phase 8: Weekly Flow

### Task 8.1: Soulseek Client Wrapper

**Files:**
- Create: `backend/src/services/soulseek.ts`
- Test: `backend/tests/services/soulseek.test.ts`

**Steps:**
1. Install `slsk-client` package
2. Create `SoulseekClient` class:
   - `connect()` — connect with stored or auto-generated credentials
   - `disconnect()` — graceful disconnect
   - `search(artistName, trackName)` — search with 15s timeout
   - `pickBestMatch(results, trackName)` — scoring: bitrate, format (prefer lossless), free slots, queue length
   - `download(result, destPath)` — download file with 60s timeout
   - `isConnected()` — connection status
3. Credential management: auto-generate random user/pass on first use, store in `GlobalSetting`
4. Idle timeout: 5-minute timer after last activity, then auto-disconnect
5. Process exit handler: `process.on('exit', () => client.disconnect())`
6. Tests: mock slsk-client, verify scoring logic, timeout handling
7. Commit: `"feat: add built-in Soulseek client with auto-credentials and idle timeout"`

---

### Task 8.2: Navidrome Service

**Files:**
- Create: `backend/src/services/navidrome.ts`
- Test: `backend/tests/services/navidrome.test.ts`

**Steps:**
1. Navidrome client:
   - `testConnection(url, username, password)` — verify connectivity
   - `getLibraries()` — list existing libraries
   - `ensureFlowLibrary(libraryPath)` — create "Mixarr Weekly Flow" library if not exists
   - `triggerScan()` — trigger library scan
   - `writeSmartPlaylist(flowName, tracks)` — write `.nsp` file into flow directory
2. Tests: mock responses
3. Commit: `"feat: add Navidrome service for flow library and smart playlist management"`

---

### Task 8.3: Flow Playlist Source

**Files:**
- Create: `backend/src/services/flow-playlist-source.ts`
- Test: `backend/tests/services/flow-playlist-source.test.ts`

**Steps:**
1. `FlowPlaylistSource` class — builds tracklists for flows:
   - `getTracksForFlow(flow)` — entry point, delegates based on mix config
   - `getDiscoverTracks(limit)` — from subscription results (recommended artists → Deezer top tracks)
   - `getTrendingTracks(limit)` — from Last.fm global top → Deezer top tracks
   - `getMixTracks(limit)` — blend of discover + trending + library-based
   - `getTagTracks(tag, limit)` — from Last.fm tag top artists → Deezer top tracks
   - `getRelatedArtistTracks(artistName, limit)` — from Last.fm similar → Deezer top tracks
2. Mix mode: weighted blend based on Flow's `mix` JSON config `{ discover: 50, trending: 30, mix: 20 }`
3. Deduplication: don't include tracks from artists already in Lidarr library
4. Tests: verify mix blending, deduplication
5. Commit: `"feat: add flow playlist source with discover/trending/mix/tag modes"`

---

### Task 8.4: Flow Worker & Pipeline

**Files:**
- Create: `backend/src/jobs/flow-worker.ts`
- Create: `backend/src/routes/flow.ts`
- Create: `backend/src/schemas/flow.ts` (Zod)
- Test: `backend/tests/jobs/flow-worker.test.ts`

**Steps:**
1. Flow routes:
   - `GET /api/flow` — list user's flows with status
   - `POST /api/flow` — create flow (name, mix, size, schedule)
   - `PUT /api/flow/:id` — update flow
   - `DELETE /api/flow/:id` — delete flow
   - `POST /api/flow/:id/start` — trigger flow execution
   - `POST /api/flow/:id/stop` — stop running flow
   - `GET /api/flow/:id/jobs` — list FlowJobs for a flow
   - `DELETE /api/flow/:id/jobs/completed` — clear completed jobs
2. Flow worker:
   - Generate tracklist via `FlowPlaylistSource`
   - Write `FlowJob` rows (status: queued)
   - Connect Soulseek client
   - Process jobs sequentially with 2s cooldown:
     - Search → pick best match → download to `_staging/` → move to final path
     - Update FlowJob status after each job
     - WebSocket push per job status change
   - On flow complete: write Navidrome smart playlist (if configured), trigger scan, notify
3. Startup cleanup: delete `_staging/`, reset `downloading` FlowJobs to `queued`
4. Final path: `/data/downloads/mixarr-flow/<flow-name>/<Artist>/<Track>.ext`
5. Tests: mock Soulseek client, verify pipeline stages
6. Commit: `"feat: add Weekly Flow worker with Soulseek download pipeline and Navidrome integration"`

---

### Task 8.5: Flow Frontend Page

**Files:**
- Create: `frontend/src/pages/Flow.tsx`
- Create: `frontend/src/components/FlowCard.tsx`
- Create: `frontend/src/components/FlowJobList.tsx`
- Create: `frontend/src/hooks/useFlow.ts`

**Steps:**
1. Flow page: list of user's flows as cards
2. FlowCard: name, status badge (idle/running/complete), track count, last run, start/stop buttons
3. Create flow modal: name, track count, mix sliders (discover/trending/mix), optional tag weights
4. Flow detail view: expandable job list with real-time status via WebSocket
5. Job statuses: queued (gray), downloading (blue pulse), complete (green), failed (red)
6. Commit: `"feat: add Flow page with real-time job tracking"`

---

## Phase 9: Deployment & Polish

### Task 9.1: Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `entrypoint.sh`
- Create: `.dockerignore`

**Steps:**
1. Multi-stage Dockerfile:
   - Stage 1 (`build`): Node 20 alpine, npm ci, build frontend (Vite), compile backend (tsc), generate Prisma client
   - Stage 2 (`production`): Node 20 alpine, copy built artifacts, npm ci --omit=dev, copy Prisma client, install `su-exec` for PUID/PGID
   - `EXPOSE 3000`, `VOLUME /data`
   - `ENTRYPOINT ["./entrypoint.sh"]`
2. `entrypoint.sh`:
   - If running as root and PUID/PGID set: create `mixarr` user, `chown /data`, re-exec via `su-exec`
   - Run `npx prisma db push` (idempotent migration)
   - Delete `_staging/` directory (orphan cleanup)
   - `exec node backend/dist/server.js`
3. `.dockerignore`: node_modules, .git, *.md, tests
4. Commit: `"feat: add Dockerfile with PUID/PGID support and auto-migration"`

---

### Task 9.2: Docker Compose & Documentation

**Files:**
- Create: `docker-compose.yml`
- Create: `README.md`

**Steps:**
1. `docker-compose.yml` (~8 lines, from design doc)
2. `README.md`:
   - What is Mixarr Lite (one paragraph)
   - Screenshots placeholder
   - Quick Start (docker-compose, docker run)
   - First-Run Setup (onboarding steps)
   - Configuration (environment variables table)
   - Spotify OAuth setup (HTTPS requirement)
   - PUID/PGID documentation
   - Comparison vs Aurral vs full Mixarr
   - Development setup (`npm run dev`)
   - License (GPLv3)
3. Commit: `"docs: add README with quick start, configuration, and comparison"`

---

### Task 9.3: Notification Service

**Files:**
- Create: `backend/src/services/notifications.ts`
- Create: `backend/src/routes/notifications.ts`
- Test: `backend/tests/services/notifications.test.ts`

**Steps:**
1. Notification service:
   - `sendDiscord(webhookUrl, message)` — Discord webhook POST
   - `sendWebhook(url, payload)` — generic webhook POST
   - `notify(event, data)` — dispatch to all enabled channels for the event type
2. Events: `subscription:complete`, `flow:complete`, `queue:new-items`, `library:health-alert`
3. Routes:
   - `POST /api/notifications/test/:channelId` — send test notification
4. Tests: mock fetch, verify payload formatting
5. Commit: `"feat: add Discord and webhook notification channels"`

---

### Task 9.4: Logging Service

**Files:**
- Create: `backend/src/services/logger.ts`
- Modify: various files to use structured logger

**Steps:**
1. Logger: write to console (structured JSON) + `LogEntry` table
2. Log levels: debug, info, warn, error
3. Categories: auth, subscription, flow, lidarr, system
4. Log rotation: auto-delete LogEntry records older than 30 days on startup
5. Logs route: `GET /api/logs` — paginated log viewer (admin only)
6. Commit: `"feat: add structured logging to console and database"`

---

### Task 9.5: Frontend Logs & Jobs Pages

**Files:**
- Create: `frontend/src/pages/Logs.tsx`
- Create: `frontend/src/pages/Jobs.tsx`

**Steps:**
1. Logs page (admin): filterable log viewer with level/category filters, auto-refresh
2. Jobs page: combined view of subscription runs + flow jobs, with status badges and timing
3. Commit: `"feat: add Logs and Jobs pages"`

---

## Plan Review Gate

### Wiring Completeness
- ✅ Every UI page has corresponding API routes
- ✅ Every button triggers an API call or navigation
- ✅ Subscription create modal → connection selector → type selector → config → schedule → result handling → API POST
- ✅ Queue approve → SkyHook warm → Lidarr addArtist → status update → WebSocket push
- ✅ Flow start → playlist source → FlowJob creation → Soulseek download → Navidrome playlist → notification

### Resource Lifecycle
- ✅ Soulseek client: connect on-demand → 5-min idle timeout → process exit cleanup
- ✅ FlowJob staging files: cleanup on startup (delete `_staging/`)
- ✅ Stale subscription runs: cleanup on startup (mark >30min as failed)
- ✅ LogEntry records: auto-delete >30 days on startup
- ✅ Prisma client: singleton, graceful disconnect on process exit

### Dependency Completeness
- ✅ All npm packages listed in Task 0.1
- ✅ Additional deps noted in tasks where introduced (slsk-client, vite-plugin-pwa, concurrently, tsx)
- ✅ No implicit infrastructure deps (no Redis, no MySQL, no external services)

### Config Consistency
- ✅ Single port 3000, single volume /data
- ✅ DATABASE_URL always points to /data/mixarr.db
- ✅ SESSION_SECRET auto-generated to /data/.session-secret
- ✅ PUID/PGID in entrypoint matches file ownership in /data
- ⚠️ BASE_URL only required for Spotify OAuth — documented as optional

### Async/Sync Boundaries
- ✅ All external API calls use fetchWithTimeout (no bare fetch)
- ✅ Soulseek downloads are stream-based (non-blocking event loop)
- ✅ SQLite WAL mode + busy_timeout prevents sync contention
- ✅ Subscription worker is async with mutex (no concurrent execution)

### Missing Integration Steps
- ✅ Task 0.4 creates DB → Task 1.1 loads env → Task 1.3 wires middleware → routes use both
- ✅ Task 1.6 creates WebSocket → Tasks 4.3, 5.1, 8.4 broadcast via it
- ✅ Task 3.7 creates discover routes → Task 7.1 consumes them
- ✅ Task 4.2 creates strategies → Task 4.3 worker uses registry to dispatch

### Plan Review Verdict
**Plan review passed.** No missing wiring, lifecycle gaps, or integration holes found.

---

## Execution Notes

- This is a **new repository**, not a branch of full Mixarr
- Business logic is **ported** from full Mixarr's `apps/api/src/` — not copy-pasted (different DB, different job queue, different patterns)
- Frontend is a **complete rewrite** — Next.js App Router → Vite + React Router
- Phases 0-5 (backend) can proceed independently of Phases 6-7 (frontend)
- Phase 8 (Weekly Flow) depends on both backend and frontend being in place
- Each phase produces a working, testable increment
