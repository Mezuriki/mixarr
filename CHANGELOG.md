# Changelog

All notable changes to Mixarr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v1.2.0] - Unreleased

### Added

#### Lidarr Monitor New Items
- Add "Monitor New Albums" dropdown to Lidarr connection settings
- Support for None, All, New, and Existing monitor options
- Automatically apply monitor setting when adding artists via subscriptions

### Fixed
- Issue #24: Lidarr import settings are not respected
- Issue #22: Allow renaming custom spotify playlists
- Issue #21: Can't access the WebUI on http
- Issue #20: slskd server ban (warning)
- Fix modals not scrollable on small screens
- Fix Discogs subscription error on save
- Fix Musicbrainz subscription error on save
- Fix subscription edit using PUT to match API route
- Fix Spotify category preset field name mismatch
- Fix Docker image typo (aquantumofdonums → aquantumofdonuts)
- Expose port 3010 for direct web access in unified Docker image
- Prevent worker auto-import in test environment
- Pass monitorOption from Lidarr connection settings when adding artists

### Security
- Sanitize 5xx errors in production responses
- Add session secret validation warning
- Add auth rate limiting verification tests
- Global rate limiting for CodeQL findings

### Added

#### Subscription System Refactoring
- Extract SubscriptionService with TDD (business logic layer)
- Add SubscriptionController with TDD (HTTP layer)
- Wire CRUD routes through controller pattern
- Extract SubscriptionFormModal component (1019 lines)
- Extract SubscriptionCard component (204 lines)
- Extract subscription-constants.ts (260 lines)
- Add useCreateSubscription and useUpdateSubscription hooks
- Reduce subscriptions/page.tsx from 1,179 to 214 lines (82% reduction)

#### Type Safety & Code Quality
- Add Socket.IO type definitions to eliminate `as any` casts
- Add shared subscription types and result handling constants
- Standardize error logging across all API routes
- Consolidate LidarrConnectionConfig to single canonical type

### Documentation
- Add pre-release cleanup documentation

---

### slskd Integration (Major Feature)

#### Added
- Add slskd (Soulseek) as a new connection type with schema validation
- SlskdService: search, downloads, connection test functionality
- SlskdSubscriptionProcessor with peer quality scoring algorithm
- SlskdDownload model for tracking download status and history
- API endpoints for downloads with filtering, retry, and cancel actions
- Webhook endpoint for download completion events
- Polling job for download status detection (2-minute interval)
- SlskdOrganizerService for automatic file organization
- Rate limiting with exponential backoff to protect slskd server
- Queue monitoring and metrics for download operations
- Two-phase commit for transaction safety
- 30-second timeout on all slskd API calls
- Search polling loop until search completion
- Peer quality scoring for better download source selection
- Detailed API error parsing with logging

#### slskd UI
- Downloads page with status filtering and actions (retry, cancel)
- slskd search modal integrated on Search, Discovery, and Review Queue pages
- ArtistCard integration for quick slskd search

#### Fixed (slskd-specific)
- Fix slskdProcessor scope in finally block (ReferenceError)
- Fix DB error propagation in rate limiting flag check
- Fix memory leak in slskd worker metrics interval
- Fix stale flag caching in subscription processor
- Fix cross-device file moves with copy fallback (EXDEV error)
- Fix BigInt serialization to string in JSON responses
- Export QueueEvents cleanup for graceful shutdown

#### Security (slskd-specific)
- Path traversal security fix in slskd webhook handler
- Unicode normalization before path validation (prevent bypass attacks)

#### Documentation
- Add slskd rate limiting operations guide

---

## [v1.1.2] - 2026-01-08

### Fixed
- Fix subscription scheduler bug - schedules other than "manual" now save correctly
- Fix Spotify Playlist subscription type using incorrect API endpoint
- Fix Spotify Category preset field name mismatch in validation
- Fix Issue #16 "Spotify Subscription - Please fill in all required fields"

### Changed
- Website updates

---

## [v1.1.1] - 2026-01-05

### Added
- **Recommendation-Only Mode**: Mixarr now works without Lidarr connection
  - Subscriptions work in `preview` and `queue` modes
  - Discovered artists land in Review Queue for later import
- **Jellyfin Integration**: Similar artists based on Jellyfin listening history
  - Direct Jellyfin API connection (no Tautulli required)
  - Test connection, user selection, library browsing
  - jellyfin_similar subscription type
- **ListenBrainz Weekly Types**: Weekly Jams and Weekly Exploration subscriptions
- **Code Quality Improvements** (5 sprints):
  - Sprint 1: Health check, route param validation, debug cleanup
  - Sprint 2: Connection config types, eliminate `as any`
  - Sprint 3: Zod validation middleware for all routes
  - Sprint 4: Security headers, rate limiting, correlation IDs
  - Sprint 5: Structured JSON logging, request logging, tests

### Fixed
- Fix native ARM64 runner configuration for faster Docker builds
- Improve subscription modal UX with validation and type locking

### Documentation
- Add JSDoc documentation to middleware and utilities
- Archive 12 completed plan documents

---

## [v1.1.0] - 2026-01-04

### Added
- **Docker Image Publishing**: Pre-built images on GitHub Container Registry
  - Multi-architecture support (amd64, arm64)
  - Automated builds on release tags
  - `ghcr.io/aquantumofdonuts/mixarr:latest`
- **Unraid Community Apps**: Template for easy Unraid installation
- **GitHub Pages Website**: Landing page at aquantumofdonuts.github.io/mixarr

### Changed
- Use native ARM64 runners instead of QEMU emulation for faster builds
- Disable font optimization in CI to prevent ARM64 build timeouts

### Documentation
- Add website link and screenshot to README
- Add Plex-centric music management implementation plan

---

## [v1.0.0] - 2025-12-25

### Initial Public Release

#### Music Service Integrations
- **Spotify**: Full OAuth - followed artists, playlists, Discover Weekly, Release Radar, Daily Mix, new releases
- **TIDAL**: Full OAuth - followed artists, playlists, discovery mixes, new arrivals
- **Deezer**: Public API - charts, genre browsing, artist search
- **Last.fm**: API - global/country charts, genre tags, geographic artists, scrobble history, similar artists
- **MusicBrainz**: New release discovery and metadata
- **ListenBrainz**: Top artists, recommendations, similar users
- **Plex/Tautulli**: Similar artists based on Plex listening history

#### Core Features
- **39 Subscription Types**: Automated discovery from charts, playlists, recommendations across all services
- **Review Queue**: Discovered artists land in queue for approval before Lidarr import
- **Universal Search**: Search across Lidarr, Spotify, TIDAL, Deezer, Last.fm, MusicBrainz
- **Library Health**: Analyze Lidarr library for missing metadata, duplicates, enrichment
- **AI-Powered Discovery**: Natural language recommendations via OpenAI, Anthropic, Ollama

#### Platform Features
- Multi-user support with admin/user roles
- SSO authentication (Google OAuth, SAML 2.0, Plex, LDAP)
- PWA support - installable, works offline
- Label browsing - click any label to see all artists
- Notifications via Discord and generic webhooks
- Background jobs with real-time progress via WebSocket
- Docker deployment with Caddy reverse proxy for HTTPS

---

[v1.2.0]: https://github.com/aquantumofdonuts/mixarr/compare/v1.1.2...dev
[v1.1.2]: https://github.com/aquantumofdonuts/mixarr/compare/v1.1.1...v1.1.2
[v1.1.1]: https://github.com/aquantumofdonuts/mixarr/compare/v1.1.0...v1.1.1
[v1.1.0]: https://github.com/aquantumofdonuts/mixarr/compare/v1.0.0...v1.1.0
[v1.0.0]: https://github.com/aquantumofdonuts/mixarr/releases/tag/v1.0.0
