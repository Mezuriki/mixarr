# Mixarr Issues & Technical Debt

> **Last Updated:** January 31, 2026  
> **Status:** PRODUCTION READY
> 
> For completed issues, see [ISSUES-FIXED.md](ISSUES-FIXED.md)  
> For future feature ideas, see [ROADMAP.md](ROADMAP.md)

---

## 🔧 TECHNICAL DEBT (Deferred)

### TD-006: OpenAI SDK Placeholder API Key

**Priority:** Low  
**Created:** January 31, 2026  
**Status:** Deferred

**Problem:**
The AI service uses a placeholder API key (`ollama-local-no-key-required`) when connecting to OpenAI-compatible endpoints that don't require authentication (e.g., Ollama). The OpenAI SDK requires a non-empty apiKey parameter, so this workaround is necessary.

**Location:** `apps/api/src/services/ai.ts`

**Future:**
Investigate if newer OpenAI SDK versions allow null/empty keys with custom baseURL. If so, remove the placeholder for cleaner code.

---

### TD-007: Search Page God Component Refactor

**Priority:** Medium  
**Created:** January 31, 2026  
**Status:** Backlog (v1.4.0)

**Problem:**
`apps/web/src/app/search/page.tsx` has grown to **903 lines** with too many concerns:
- 5 search types (artist, album, label, year, AI)
- Multi-select and bulk actions
- MBID resolution modal
- slskd integration
- Complex state management

**UX Impact:** Users face cognitive overload seeing all options at once.

**Proposed Solution:**
Tab-based separation with lazy-loaded content per search type.

**Design Document:** `docs/plans/2026-01-31-god-component-refactor-design.md`

**Estimated Effort:** 4-6 hours

---

### TD-008: Connections Page God Component Refactor

**Priority:** Medium  
**Created:** January 31, 2026  
**Status:** Backlog (v1.4.0)

**Problem:**
`apps/web/src/app/connections/page.tsx` has grown to **1817 lines** with too many concerns:
- 10 different connection types with different auth flows
- OAuth callback handling for Spotify, Deezer, TIDAL
- Test connection logic per type
- Edit forms with type-specific fields
- Status tracking and authorization state

**UX Impact:** No progressive disclosure — users see everything at once when adding a connection.

**Proposed Solution:**
Wizard-style "Add Connection" flow with type-specific steps:
1. Choose type (card grid)
2. Configure (type-specific form)
3. Test connection
4. Save

**Design Document:** `docs/plans/2026-01-31-god-component-refactor-design.md`

**Estimated Effort:** 6-8 hours

---

### TD-001: Migrate LDAP from deprecated ldapjs to ldapts

**Priority:** Medium  
**Created:** January 2, 2026  
**Status:** Deferred

**Problem:**
Build warnings show `ldapjs@2.3.3` is deprecated. The dependency chain is:
- `passport-ldapauth@3.0.1` → `ldapauth-fork@5.0.5` → `ldapjs@2.3.3` (deprecated)
- `passport-ldapauth` last updated June 2022 (3+ years stale)

**Solution:**
Replace `passport-ldapauth` with `ldap-authentication` package which uses `ldapts` (actively maintained, last updated Dec 2025).

**Migration Steps:**
1. Install `ldap-authentication` package
2. Create custom Passport strategy wrapping `ldap-authentication`
3. Update `apps/api/src/auth/strategies/ldap.ts` to use new library
4. Update tests
5. Remove `passport-ldapauth` dependency

**Files Affected:**
- `apps/api/package.json`
- `apps/api/src/auth/strategies/ldap.ts`
- Related tests

**Notes:**
- LDAP is a critical feature, migration required eventually
- `whatwg-encoding` deprecation warning (from cheerio) is benign and can be ignored

---

### TD-002: Lidarr Rescan Behavior Causes Full Library Scans

**Priority:** High (User Impact)  
**Created:** January 3, 2026  
**Status:** Documented - Workaround Available

**Problem:**
When Mixarr's Library Health features trigger `RefreshArtist` commands for existing artists in Lidarr, each refresh causes a full root folder scan (not just the artist's folder). This is due to Lidarr's internal behavior in `RefreshArtistService.RescanArtists()`:

```csharp
// For NEW artists: scans only artist folder
if (isNew) {
    folders = artists.Select(x => x.Path).ToList();
}
// For EXISTING artists: scans ALL root folders by default
else {
    folders = _rootFolderService.All().Select(x => x.Path).ToList();
}
```

When bulk refresh operations are triggered (e.g., "Refresh Incomplete Artists"), this queues many `RefreshArtist` commands, each triggering a full library scan. With large libraries (30K+ files), these scans can take hours and queue up for days.

**Affected Mixarr Features:**
- Library Health → Refresh single artist
- Library Health → Bulk refresh incomplete artists
- Library Health → Bulk refresh by issue type

**Workaround (Recommended):**
In Lidarr, go to **Settings → Media Management** and set **"Rescan Artist Folder after Refresh"** to **Never**.

This will:
- ✅ Still scan new artist folders when added from Mixarr
- ✅ Stop existing artist refreshes from triggering full library scans
- ✅ Allow manual rescans when actually needed

**Notes:**
- Adding NEW artists is not affected - those always scan only the artist's folder
- This is Lidarr's internal behavior, not something Mixarr can control via API
- Users with large libraries should set this to "Never" before using bulk refresh features

---

## Future Enhancements

### SSO Provider Credential Encryption
**Priority:** Medium | **Type:** Security Enhancement | **Created:** 2026-01-11

**Description:**
Currently SSO provider credentials (OAuth client secrets, LDAP bind passwords, SAML certificates) are stored in plain text in the database. While database access is restricted and connections are encrypted, adding application-level encryption provides defense-in-depth.

**Proposed Solution:**
- Encrypt secrets at rest using AES-256-GCM
- Store encryption key in environment variable or secrets manager
- Implement key rotation capability
- Transparent encrypt/decrypt in sso-provider service

**Impact:**
- Additional protection against database compromise
- Compliance with security best practices for credential storage
- Minimal performance impact (encrypt once on write, decrypt on read)

**Files Affected:**
- `apps/api/src/services/sso-provider.ts` - Add encrypt/decrypt methods
- `apps/api/prisma/schema.prisma` - Consider separate encrypted fields
- `apps/api/src/lib/crypto.ts` - Encryption utility (new file)

**Complexity:** Medium (2-3 days)

**References:**
- OWASP Cryptographic Storage Cheat Sheet
- Node.js crypto module documentation

---

### Extract getLidarrServiceWithConfig to Shared Module
**Priority:** Low | **Type:** Code Quality | **Created:** 2026-01-17

**Description:**
The `getLidarrServiceWithConfig()` helper function is duplicated in `discover.ts` and `search.ts`. This should be extracted to a shared service factory module.

**Proposed Solution:**
- Create `apps/api/src/lib/service-factory.ts`
- Move `getLidarrServiceWithConfig()` (and similar helpers) to shared module
- Import from shared module in routes

**Files Affected:**
- `apps/api/src/lib/service-factory.ts` (new file)
- `apps/api/src/routes/discover.ts`
- `apps/api/src/routes/search.ts`

**Complexity:** Low (30 minutes)

---

### Refactor addArtist to Use Options Object Pattern
**Priority:** Low | **Type:** Code Quality | **Created:** 2026-01-17

**Description:**
`LidarrService.addArtist()` and `addArtistWithRefresh()` use positional boolean parameters with inline comments, making calls hard to read and error-prone. The deprecated `_waitForRefresh` parameter is still required for API compatibility.

**Current Pattern:**
```typescript
await lidarr.addArtistWithRefresh(
  mbid, qpId, mpId, rfPath,
  true,  // monitored
  true,  // searchForMissingAlbums
  false, // waitForRefresh (deprecated)
  'all'  // monitorOption
);
```

**Proposed Solution:**
```typescript
interface AddArtistOptions {
  monitored?: boolean;
  searchForMissingAlbums?: boolean;
  monitorOption?: LidarrMonitorOption;
}

await lidarr.addArtist(mbid, qpId, mpId, rfPath, {
  monitored: true,
  searchForMissingAlbums: true,
  monitorOption: 'all'
});
```

**Files Affected:**
- `apps/api/src/services/lidarr.ts`
- All callers (8+ locations)

**Complexity:** Medium (1-2 hours)

---

### Add MonitorOption Validation to Lidarr Settings
**Priority:** Low | **Type:** Validation | **Created:** 2026-01-17

**Description:**
The `monitorOption` field accepts any string but Lidarr API only accepts specific values: `'all'`, `'future'`, `'missing'`, `'existing'`, `'first'`, `'latest'`, `'none'`. Invalid values would cause Lidarr API errors.

**Current State:**
- `LidarrMonitorOption` type union added to `types/connections.ts`
- Connection settings UI doesn't validate against this

**Proposed Solution:**
- Add Zod schema for connection config with enum validation
- Validate on connection save in settings routes
- Use `LidarrMonitorOption` type in frontend dropdown

**Files Affected:**
- `apps/api/src/schemas/connection.ts` (if exists, or create)
- `apps/api/src/routes/settings.ts`
- `apps/web/src/app/connections/page.tsx`

**Complexity:** Low (1 hour)

---

## 🏗️ ARCHITECTURE: Separation of Concerns Violations

**Priority:** Medium-High | **Type:** Architecture | **Created:** 2026-01-18

A comprehensive review identified violations of three-tier architecture (Database → API → Frontend). These issues create tight coupling, duplicate logic, and maintenance burden.

### SOC-001: Frontend Business Logic - Soulseek Quality Scoring

**Priority:** High | **Severity:** High

**Problem:**
[apps/web/src/components/modals/SearchModal.tsx](apps/web/src/components/modals/SearchModal.tsx) contains a `scoreResult()` function with hardcoded business rules for ranking Soulseek search results (50 pts lossless, 30 pts upload speed, 10 pts free slot, -10 pts queue length).

**Impact:**
- Scoring algorithm can't be adjusted without frontend deployment
- Different frontends would need to duplicate this logic
- Business rules scattered across tiers

**Solution:** Move to API - return `qualityScore` field from slskd search endpoint.

---

### SOC-002: Frontend Business Logic - Audio Format Classification

**Priority:** High | **Severity:** High

**Problem:**
[apps/web/src/components/modals/SearchModal.tsx](apps/web/src/components/modals/SearchModal.tsx) contains `getFileFormat()` and `isLossless()` functions that classify audio file formats.

**Impact:**
- Format definitions can't be centralized
- Adding new format support requires frontend changes
- Domain knowledge duplicated

**Solution:** API should return `format` and `isLossless` fields on file objects.

---

### SOC-003: Frontend Business Logic - Subscription Type Metadata

**Priority:** High | **Severity:** High

**Problem:**
[apps/web/src/components/subscriptions/](apps/web/src/components/subscriptions/) contains 50+ subscription types with required fields, descriptions, icons, and validation rules hardcoded in frontend.

**Impact:**
- Backend and frontend can get out of sync
- Adding subscription types requires coordinated changes
- Validation logic duplicated between tiers

**Solution:** Create `GET /api/subscriptions/types` endpoint that returns type metadata, required fields, descriptions.

---

### SOC-004: Frontend Business Logic - Subscription Config Building

**Priority:** High | **Severity:** High

**Problem:**
[apps/web/src/components/modals/SubscriptionModal.tsx](apps/web/src/components/modals/SubscriptionModal.tsx) contains 30+ lines of `buildConfig()` logic that constructs type-specific config objects.

**Impact:**
- Config structure duplicated between frontend and API
- Frontend knows too much about API data shapes
- Adding config fields requires frontend changes

**Solution:** API should accept form-ready data or provide schema-driven form configuration.

---

### SOC-005: API Missing Service Layer - Direct Prisma in Routes

**Priority:** High | **Severity:** High

**Problem:**
Multiple route files access Prisma directly instead of going through service layer:
- [apps/api/src/routes/users.ts](apps/api/src/routes/users.ts) - No `UserService`
- [apps/api/src/routes/connections.ts](apps/api/src/routes/connections.ts) - No `ConnectionService`
- [apps/api/src/routes/importSources.ts](apps/api/src/routes/importSources.ts) - No `ImportSourceService`
- [apps/api/src/routes/settings.ts](apps/api/src/routes/settings.ts) - No `SettingsService`
- [apps/api/src/routes/notifications.ts](apps/api/src/routes/notifications.ts) - Channel CRUD in route
- [apps/api/src/routes/logs.ts](apps/api/src/routes/logs.ts) - No `LogService`
- [apps/api/src/routes/duplicates.ts](apps/api/src/routes/duplicates.ts) - No `DuplicateService`
- [apps/api/src/routes/ai.ts](apps/api/src/routes/ai.ts) - No `AISettingsService`

**Impact:**
- Business logic mixed with HTTP concerns
- Harder to test business logic in isolation
- Code reuse difficult across routes/workers

**Solution:** Extract service classes for each domain.

---

### SOC-006: API Presentation Logic - UI Text in Backend

**Priority:** Medium | **Severity:** Medium

**Problem:**
- [apps/api/src/routes/webhooks.ts](apps/api/src/routes/webhooks.ts) contains `formatEventLabel()` and `getEventDescription()` with UI-facing text
- [apps/api/src/lib/subscriptions/presets.ts](apps/api/src/lib/subscriptions/presets.ts) has massive preset data with UI descriptions
- [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts) generates description strings like "Added X artists"

**Impact:**
- UI text changes require API deployment
- Localization would be harder
- Presentation concerns in API layer

**Solution:** API returns raw data, frontend handles formatting and display text.

---

### SOC-007: API Data Layer Leakage - Prisma Models in Responses

**Priority:** Medium | **Severity:** Medium

**Problem:**
Multiple routes return raw Prisma model objects without DTO transformation:
- Connection routes expose internal Prisma fields
- Subscription routes expose raw model structure
- User routes expose internal `_count` structures

**Impact:**
- Frontend tightly coupled to database schema
- Can't change DB schema without breaking frontend
- Internal fields potentially exposed

**Solution:** Create DTOs (Data Transfer Objects) for API responses.

---

### SOC-008: Duplicate Helper Functions Across Routes

**Priority:** Low | **Severity:** Medium

**Problem:**
- `getActiveConnection()` duplicated in 3+ route files
- `resolveConnectionWithDefaults()` duplicated across routes
- Similar patterns for connection resolution

**Impact:**
- Bug fixes need to be applied in multiple places
- Inconsistent behavior possible
- Code bloat

**Solution:** Create `ConnectionResolverService` with shared helpers.

---

### Implementation Plan Reference
See [docs/plans/2026-01-18-separation-of-concerns-refactor.md](docs/plans/2026-01-18-separation-of-concerns-refactor.md) for detailed implementation plan.

### Recommended Implementation Order

**Prerequisites:** Fix the 40 failing tests (TD-003, TD-004, TD-005) before major refactoring. Hard to know if refactoring breaks something when tests are already broken.

| Phase | Issues | Risk | Notes |
|-------|--------|------|-------|
| **Phase 1** | SOC-001, SOC-002, SOC-006, SOC-008 | 🟢 Low | Safe wins - pure refactors, no behavior change |
| **Phase 2** | SOC-005, SOC-007 | 🟡 Medium | Extract service layer, add DTOs - coordinated frontend/backend changes |
| **Phase 3** | SOC-003 | 🟡 Medium | Subscription type metadata API - needs good test coverage first |
| **Phase 4** | SOC-004 | 🔴 High | Subscription config building - core functionality, defer until everything else is stable |

**Total estimated effort:** 2-3 weeks with proper TDD

---

## New Issues

<!-- Add new issues below this line -->


