# Pre-Release Cleanup Design

**Date:** January 11, 2026  
**Status:** Approved  
**Branch:** hotfix/pre-release-cleanup

## Overview

Eliminate "Reddit vulnerability score" issues before public launch while maintaining dev-friendly workflow. All fixes use existing infrastructure without new dependencies.

## Implementation Strategy

- Single hotfix branch with atomic commits per fix
- Each commit gets verification before next fix
- TDD approach for testable changes (error handling, rate limiting)
- Estimated time: 30-45 minutes total

## Fixes

### 1. Console Logging Cleanup

**Problem:** ~20 console.log statements polluting production DevTools

**Files:**
- `apps/web/src/lib/offline-store.ts` (14 instances)
- `apps/web/src/lib/websocket.ts` (1 instance)
- `apps/web/src/components/service-worker.tsx` (5 instances)

**Solution:**
- Remove all `console.log` calls for info/debug messages
- Keep all `console.error` calls for actual failures
- Search for remaining console.log after cleanup

**Verification:** `grep -r "console.log" apps/web/src --include="*.ts" --include="*.tsx"`

---

### 2. Error Sanitization

**Problem:** Server errors expose internal details to clients

**Current State:** `apps/api/src/middleware/error-handler.ts` sends `err.message` directly to client

**Solution:**
- 4xx errors (validation, auth): Show specific message in UI
- 5xx errors (server): Show "Internal server error" in UI, log full details (message, stack, context) to console
- Check `statusCode >= 500` before sending message

**TDD Tests:**
1. Write failing test: 500 error returns generic message to client
2. Write failing test: 400 error returns specific message to client
3. Write failing test: Server logs include full error details for 500
4. Implement fix to pass tests

**Test Location:** `apps/api/tests/middleware/error-handler.test.ts`

**Verification:** Run middleware tests, manually trigger errors in dev

---

### 3. Session Secret Validation

**Problem:** Default SESSION_SECRET in docker-compose.yml ("change-this-in-production")

**File:** `apps/api/src/index.ts` (startup initialization)

**Check Conditions:**
- SESSION_SECRET equals "change-this-in-production"
- SESSION_SECRET length < 32 characters
- SESSION_SECRET contains only alphanumeric (weak entropy)

**Warning Message:**
```
⚠️ SECURITY WARNING: SESSION_SECRET is weak or default. Generate a secure secret:
  openssl rand -base64 32
```

**Level:** Warning (non-fatal, logs to console)

**Documentation:** Update `.env.example` with generation instructions

**Verification:** Start app with default secret, check for warning

---

### 4. Auth Rate Limiting

**Problem:** Login/register endpoints lack rate limiting

**Precondition:** Verify `loginLimiter` and `registerLimiter` exist in `apps/api/src/middleware/rate-limiter.ts`

**If Missing:** Create limiters using existing Redis store pattern
- `loginLimiter`: 5 attempts per 15 minutes
- `registerLimiter`: 3 attempts per hour

**Application:** Apply to routes in `apps/api/src/routes/auth.ts`
- `POST /login` gets loginLimiter
- `POST /register` gets registerLimiter

**TDD Tests:**
1. Write failing test: 6th login attempt within 15min returns 429
2. Write failing test: Rate limit headers present in response
3. Write failing test: Rate limit resets after time window
4. Implement to pass tests

**Test Location:** `apps/api/tests/auth/rate-limiting.test.ts`

**Verification:** Run auth tests, manually test rapid login attempts

---

### 5. TODO Comment Removal

**Problem:** TODO comment about encryption in production code

**File:** `apps/api/src/services/sso-provider.ts` (line 71)

**Action:** Remove TODO comment

**Documentation:** Create entry in `docs/ISSUES.md` under new "Future Enhancements" section

**Entry Format:**
```markdown
## SSO Provider Credential Encryption
**Priority:** Medium | **Type:** Security Enhancement

Currently SSO provider credentials (OAuth secrets, LDAP passwords, SAML certs) are stored in plain text in the database. Consider encrypting at rest using application-level encryption (e.g., AES-256-GCM with key rotation).

**Impact:** Defense-in-depth for database compromise scenarios  
**Files:** apps/api/src/services/sso-provider.ts
```

**Verification:** Grep for TODO comments in services directory

---

### 6. Port Documentation Fix

**Problem:** README incorrectly documents port 3010

**File:** `README.md` (Installation section)

**Current Text:** "http://your-ip:3010 (direct API)"

**Corrected Text:** "http://your-ip:3010 (direct web access, bypasses Caddy)"

**Additional Context:** Add note that API runs on internal port 3005, not directly exposed

**Verification:** Review README Installation section

---

### 7. Mockup File Cleanup

**Problem:** HTML mockup files ship in production builds

**Precondition:** Search for imports of mockup files
- Pattern: `import.*mockups` or references in Next.js pages

**If No Imports Found:** Add `apps/web/mockups/` to `.dockerignore`

**If Imports Exist:** Move mockups to `docs/design/` instead

**Verification:** 
- Check docker image size before/after (should reduce by ~50-100KB)
- Confirm mockups not in production container

---

## Risk Assessment

### Breaking Changes Risk

**Low Risk (need verification):**
- Auth rate limiting - verify limiters exist or create them
- Mockup cleanup - search for imports before excluding

**Zero Risk:**
- Console logging (removes logs, no behavior change)
- Session secret warning (adds log, doesn't block)
- Error sanitization (changes UI messages, not server logic)
- TODO removal (comment only)
- Port docs (README only)

### Migration Path

None needed - all changes backwards compatible. Existing dev users won't see behavioral differences except cleaner logs and better error messages.

---

## Testing Strategy

### TDD Approach

**For Error Sanitization:**
1. RED: Write failing tests for 400/500 responses
2. GREEN: Implement status code check
3. REFACTOR: Clean up error handler
4. Verify: Run full middleware test suite

**For Rate Limiting:**
1. RED: Write failing tests for rate limit behavior
2. GREEN: Apply limiters to routes
3. REFACTOR: Extract limiter config if needed
4. Verify: Run full auth test suite

### Manual Testing

**After All Fixes:**
1. Start dev stack: `./start-dev.sh`
2. Check for session secret warning
3. Test login (should work)
4. Test rapid login attempts (should rate limit)
5. Trigger 400 error (should show specific message)
6. Trigger 500 error (should show generic message, log details)
7. Check browser DevTools console (should be clean)

---

## Commit Strategy

Each fix gets atomic commit:
```
chore: remove production console.log statements
test: add error sanitization tests (RED)
fix: sanitize 5xx errors in production responses
chore: add session secret validation warning
test: add auth rate limiting tests (RED)
fix: apply rate limiting to auth endpoints
docs: move SSO encryption TODO to ISSUES.md
docs: fix port 3010 description in README
chore: exclude mockup files from production builds
```

---

## Success Criteria

- [ ] All tests pass
- [ ] No console.log in production code (except errors)
- [ ] 5xx errors return generic messages
- [ ] Session secret warning shows for defaults
- [ ] Login rate limited after 5 attempts
- [ ] TODO comment removed, documented in ISSUES.md
- [ ] README accurately describes ports
- [ ] Mockup files excluded from builds
- [ ] Manual testing confirms all fixes work
- [ ] No regressions in existing functionality
