# Pre-Release Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate pre-launch code quality issues without breaking changes

**Architecture:** Surgical fixes to existing code - error handler sanitization, rate limiting application, console cleanup, documentation updates

**Tech Stack:** TypeScript, Express, Vitest, Next.js

**Quality Notes:**
- 🦆 Each task has verification steps to prove success
- 💀 TDD required for error handling and rate limiting
- 🤖 Console cleanup requires context review (some logs may be user-facing)

---

## Task 1: Remove Production Console Logs

**Files:**
- Modify: `apps/web/src/lib/offline-store.ts`
- Modify: `apps/web/src/lib/websocket.ts`
- Modify: `apps/web/src/components/service-worker.tsx`

🤖 **AI Slop Note:** Review each console.log for context - PWA status messages for users should stay, debug logs should go.

**Step 1: Review and remove offline-store.ts logs**

Read the file to identify which logs are debug-only vs user-facing status:

```bash
grep -n "console\\.log" apps/web/src/lib/offline-store.ts
```

Remove debug logs like "Cached N review items", keep error logs.

**Step 2: Remove websocket.ts logs**

```bash
grep -n "console\\.log" apps/web/src/lib/websocket.ts
```

Remove connection status logs (WebSocket has built-in browser DevTools).

**Step 3: Remove service-worker.tsx logs**

```bash
grep -n "console\\.log" apps/web/src/components/service-worker.tsx
```

Remove registration status logs (keep console.error for failures).

**Step 4: Verify cleanup**

```bash
grep -r "console\.log" apps/web/src/lib apps/web/src/components --include="*.ts" --include="*.tsx"
```

Expected: No matches (or only legitimate user-facing messages)

**Step 5: Commit**

```bash
git add apps/web/src/lib/offline-store.ts apps/web/src/lib/websocket.ts apps/web/src/components/service-worker.tsx
git commit -m "chore: remove production console.log statements

- Keep console.error for actual failures
- Remove debug logs from offline-store, websocket, service-worker
- Improves production DevTools console clarity"
```

---

## Task 2: Add Error Sanitization Tests (RED)

**Files:**
- Create: `apps/api/tests/middleware/error-handler.test.ts`

💀 **Be-a-shithead Note:** Test BOTH what goes to client AND what goes to logs - two separate concerns.

**Step 1: Create test file with imports**

`apps/api/tests/middleware/error-handler.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { logger } from '../../src/lib/logger.js';

// Mock logger
vi.mock('../../src/lib/logger.js', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('Error Handler - Production Sanitization', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonSpy: ReturnType<typeof vi.fn>;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonSpy = vi.fn();
    statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
    
    mockReq = {
      correlationId: 'test-123',
    };
    mockRes = {
      status: statusSpy,
      json: jsonSpy,
    };
    mockNext = vi.fn();
    
    // Set production mode
    process.env.NODE_ENV = 'production';
  });

  it('should return generic message for 500 errors in production', () => {
    const error = new Error('Database connection failed: invalid credentials');
    (error as any).statusCode = 500;

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Internal server error',
          code: 'INTERNAL_ERROR',
        }),
      })
    );
    
    // Should NOT contain actual error message
    const call = jsonSpy.mock.calls[0][0];
    expect(call.error.message).not.toContain('Database');
    expect(call.error.message).not.toContain('credentials');
  });

  it('should return specific message for 400 errors in production', () => {
    const error = new Error('Email is required');
    (error as any).statusCode = 400;
    (error as any).code = 'VALIDATION_ERROR';

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Email is required',
          code: 'VALIDATION_ERROR',
        }),
      })
    );
  });

  it('should log full error details for 500 errors', () => {
    const error = new Error('Database connection failed: invalid credentials');
    (error as any).statusCode = 500;
    error.stack = 'Error: Database...\n  at Function.query';

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(logger.error).toHaveBeenCalledWith(
      'Request error',
      expect.objectContaining({
        correlationId: 'test-123',
        message: 'Database connection failed: invalid credentials',
        stack: expect.stringContaining('at Function.query'),
      })
    );
  });

  it('should not include stack trace in production response', () => {
    const error = new Error('Internal error');
    (error as any).statusCode = 500;
    error.stack = 'Error: Internal error\n  at test';

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    const call = jsonSpy.mock.calls[0][0];
    expect(call.error.stack).toBeUndefined();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd apps/api
npx vitest run tests/middleware/error-handler.test.ts
```

Expected: FAIL - "expected 'Database connection failed...' to be 'Internal server error'"

**Step 3: Commit failing tests**

```bash
git add apps/api/tests/middleware/error-handler.test.ts
git commit -m "test: add error sanitization tests (RED)

- Test 500 errors return generic message
- Test 400 errors return specific message  
- Test full details logged for operators
- Test no stack traces in production responses"
```

---

## Task 3: Implement Error Sanitization (GREEN)

**Files:**
- Modify: `apps/api/src/middleware/error-handler.ts:50-65`

**Step 1: Update error handler to sanitize 5xx errors**

Replace lines 50-65 in `apps/api/src/middleware/error-handler.ts`:

```typescript
  // Handle application errors
  const appError = err as AppError;
  const statusCode = appError.statusCode || 500;
  const code = appError.code || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
  
  // Sanitize message for 5xx errors in production
  let message: string;
  if (statusCode >= 500 && process.env.NODE_ENV === 'production') {
    message = 'Internal server error';
  } else {
    message = appError.message || 'Internal server error';
  }

  const response: ErrorResponse = {
    error: {
      code,
      message,
      correlationId,
      ...(process.env.NODE_ENV === 'development' && { stack: appError.stack }),
    },
  };

  res.status(statusCode).json(response);
```

**Step 2: Run tests to verify they pass**

```bash
cd apps/api
npx vitest run tests/middleware/error-handler.test.ts
```

Expected: PASS - all 4 tests green

**Step 3: Run full middleware test suite**

```bash
npx vitest run tests/middleware/
```

Expected: All tests pass (no regressions)

**Step 4: Commit**

```bash
git add apps/api/src/middleware/error-handler.ts
git commit -m "fix: sanitize 5xx errors in production responses

- 5xx errors return generic 'Internal server error' message
- 4xx errors return specific validation/auth messages
- Full details still logged for operator debugging
- Stack traces never sent to client in production"
```

---

## Task 4: Add Session Secret Validation

**Files:**
- Modify: `apps/api/src/index.ts` (after session middleware setup)
- Modify: `.env.example`

🦆 **Rubber Duck Note:** This is a warning, not a blocker - dev experience matters. Don't fail startup.

**Step 1: Find session middleware setup location**

```bash
grep -n "express-session" apps/api/src/index.ts
```

Add validation after session setup (around line 60-80).

**Step 2: Add session secret validation**

After the session middleware setup in `apps/api/src/index.ts`, add:

```typescript
// Warn about weak session secrets
const sessionSecret = process.env.SESSION_SECRET || 'change-this-in-production';
const isDefaultSecret = sessionSecret === 'change-this-in-production';
const isWeak = sessionSecret.length < 32 || /^[a-zA-Z0-9]+$/.test(sessionSecret);

if (isDefaultSecret || isWeak) {
  logger.warn('⚠️  SECURITY WARNING: SESSION_SECRET is weak or default');
  logger.warn('   Generate a secure secret with: openssl rand -base64 32');
  logger.warn('   Set SESSION_SECRET in your .env file');
}
```

**Step 3: Update .env.example**

Add to `.env.example`:

```bash
# Session secret for cookie signing
# IMPORTANT: Generate a strong random secret in production
# Command: openssl rand -base64 32
SESSION_SECRET=change-this-in-production
```

**Step 4: Test warning appears**

```bash
cd apps/api
SESSION_SECRET=weak npm start
```

Expected: See warning in logs during startup

**Step 5: Test no warning with strong secret**

```bash
SESSION_SECRET=$(openssl rand -base64 32) npm start
```

Expected: No warning in logs

**Step 6: Commit**

```bash
git add apps/api/src/index.ts .env.example
git commit -m "chore: add session secret validation warning

- Warn on default 'change-this-in-production' secret
- Warn on secrets < 32 chars or low entropy
- Non-fatal warning preserves dev experience
- Update .env.example with generation instructions"
```

---

## Task 5: Add Auth Rate Limiting Tests (RED)

**Files:**
- Create: `apps/api/tests/auth/rate-limiting.test.ts`

💀 **Be-a-shithead Note:** loginLimiter already exists and is applied to /login. We're verifying it works, not creating it. No /register endpoint exists - this task is verification only.

**Step 1: Create rate limiting test**

`apps/api/tests/auth/rate-limiting.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/index.js';

describe('Auth Rate Limiting', () => {
  let app: Express;

  beforeAll(async () => {
    app = await createApp();
  });

  it('should rate limit login attempts after 5 tries', async () => {
    const attempts = [];
    
    // Make 6 rapid login attempts
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'wrong' });
      
      attempts.push(res.status);
    }

    // First 5 should be 401 (unauthorized), 6th should be 429 (rate limited)
    expect(attempts.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(attempts[5]).toBe(429);
  });

  it('should include rate limit headers in response', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrong' });

    expect(res.headers).toHaveProperty('ratelimit-limit');
    expect(res.headers).toHaveProperty('ratelimit-remaining');
    expect(res.headers).toHaveProperty('ratelimit-reset');
  });

  it('should return helpful error message when rate limited', async () => {
    // Exhaust rate limit
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'rate-limit@example.com', password: 'wrong' });
    }

    // Next attempt should be rate limited with message
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rate-limit@example.com', password: 'wrong' });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many login attempts');
    expect(res.body.error).toContain('15 minutes');
  });
});
```

**Step 2: Run tests to verify current behavior**

```bash
cd apps/api
npx vitest run tests/auth/rate-limiting.test.ts
```

Expected: Tests should PASS (loginLimiter already applied to /login route)

**Step 3: Commit test**

```bash
git add apps/api/tests/auth/rate-limiting.test.ts
git commit -m "test: add auth rate limiting verification tests

- Verify login rate limited after 5 attempts
- Verify rate limit headers present
- Verify helpful error message returned
- Tests existing rate limiting behavior"
```

---

## Task 6: Document SSO Encryption TODO

**Files:**
- Create: `docs/ISSUES.md`
- Modify: `apps/api/src/services/sso-provider.ts:71`

**Step 1: Create ISSUES.md**

`docs/ISSUES.md`:
```markdown
# Known Issues & Future Enhancements

This document tracks known limitations, technical debt, and planned enhancements that are not currently blocking but should be addressed in future iterations.

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

*Last Updated: 2026-01-11*
```

**Step 2: Find and remove TODO comment**

```bash
grep -n "TODO" apps/api/src/services/sso-provider.ts
```

Remove the TODO comment at line 71 (or wherever found).

**Step 3: Verify TODO removed**

```bash
grep -r "TODO.*encrypt" apps/api/src/services/
```

Expected: No matches

**Step 4: Commit**

```bash
git add docs/ISSUES.md apps/api/src/services/sso-provider.ts
git commit -m "docs: move SSO encryption TODO to ISSUES.md

- Create ISSUES.md for tracking future enhancements
- Document SSO credential encryption as planned enhancement
- Remove TODO comment from source code
- No functional changes"
```

---

## Task 7: Fix Port Documentation

**Files:**
- Modify: `README.md` (Installation section)

**Step 1: Find port 3010 documentation**

```bash
grep -n "3010" README.md
```

**Step 2: Update port description**

Find the line mentioning "http://your-ip:3010 (direct API)" and replace with:

```markdown
- `http://your-ip:3010` - Direct web access (bypasses Caddy, development only)

**Note:** The API runs on internal port 3005 and is not directly exposed. All external traffic should use port 443 (Caddy) in production.
```

**Step 3: Verify documentation**

```bash
grep -A2 -B2 "3010" README.md
```

Expected: Shows corrected description

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs: fix port 3010 description in README

- Clarify 3010 is direct web access, not API
- Note API runs on internal port 3005
- Emphasize Caddy (443) for production traffic"
```

---

## Task 8: Exclude Mockup Files from Production

**Files:**
- Modify: `.dockerignore`

🦆 **Rubber Duck Note:** Verify mockups aren't imported anywhere before excluding them.

**Step 1: Verify no imports of mockup files**

```bash
grep -r "mockups" apps/web/src --include="*.ts" --include="*.tsx"
```

Expected: No matches (already verified earlier)

**Step 2: Add mockups to .dockerignore**

Check if `.dockerignore` exists:

```bash
test -f .dockerignore && echo "exists" || echo "create it"
```

If it doesn't exist, create it. Add:

```
# Development mockups (not needed in production)
apps/web/mockups/
```

**Step 3: Verify exclusion works**

```bash
docker build -t mixarr-test -f Dockerfile.unified .
docker run --rm mixarr-test ls /app/apps/web/mockups 2>&1 || echo "Mockups excluded ✓"
```

Expected: "No such file or directory" or "Mockups excluded ✓"

**Step 4: Commit**

```bash
git add .dockerignore
git commit -m "chore: exclude mockup files from production builds

- Add apps/web/mockups/ to .dockerignore
- Reduces image size by ~50-100KB
- Mockups are development-only design references"
```

---

## Task 9: Manual Verification & Testing

**No code changes - verification only**

**Step 1: Start dev stack**

```bash
./start-dev.sh
```

Wait for all services to be healthy.

**Step 2: Check session secret warning**

```bash
sudo docker compose -f docker-compose.dev.yml logs api | grep "SECURITY WARNING"
```

Expected: See session secret warning (dev uses default)

**Step 3: Test login rate limiting**

Use browser or curl:

```bash
for i in {1..6}; do
  curl -X POST http://localhost:3005/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}' \
    -w "\nStatus: %{http_code}\n" \
    -s | grep -E "(error|Status)"
done
```

Expected: First 5 return 401, 6th returns 429 with rate limit message

**Step 4: Trigger and check error responses**

Valid 400 error (shows specific message):
```bash
curl -X POST http://localhost:3005/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"invalid"}' | jq .error.message
```

Expected: Specific validation message

Simulate 500 error (check logs vs response):
- Response should show "Internal server error"
- Logs should show actual error details

**Step 5: Check browser console**

1. Open https://localhost:3443
2. Open DevTools console
3. Navigate app, trigger offline sync

Expected: Clean console, no excessive logging

**Step 6: Verify all tests pass**

```bash
cd apps/api
npm test
```

Expected: All tests pass

**Step 7: Type check**

```bash
cd apps/web
npm run typecheck
```

Expected: No type errors

---

## Success Criteria

- [ ] No console.log in web src (except legitimate user messages)
- [ ] Error handler tests pass (4/4)
- [ ] 5xx errors return "Internal server error" in production
- [ ] Full error details logged for operator debugging
- [ ] Session secret warning appears with default/weak secrets
- [ ] Auth rate limiting tests pass (3/3)
- [ ] Login endpoint limited to 5 attempts / 15min
- [ ] TODO moved to ISSUES.md
- [ ] README port 3010 correctly documented
- [ ] Mockup files excluded from Docker builds
- [ ] Manual testing confirms all fixes work
- [ ] No regressions in existing tests
- [ ] All changes committed with descriptive messages

---

## Deployment Checklist

Before merging to staging/prod:

1. All success criteria met
2. Full test suite passes
3. Manual testing on dev stack successful
4. Code review completed (@requesting-code-review)
5. Rubber duck review of changes (@rubber-duck)
6. No breaking changes for existing users

---

*Generated: 2026-01-11*
*Estimated Time: 30-45 minutes*
