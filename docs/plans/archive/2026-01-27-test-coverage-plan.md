# Test Coverage Implementation Plan

**Created:** 2026-01-27  
**Status:** Approved  
**Branch:** feature/test-coverage (to be created after v1.5.0 merge)

## Overview

Implement comprehensive test coverage for v1.5.0 release including:
- E2E frontend tests with Playwright (~36 tests)
- API security tests for AI validation (~18 tests)
- Accessibility and theme testing

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Test Environment | C (Both) | Unit tests standalone, E2E against dev stack |
| E2E Scope | B (Moderate) | Accessibility + key flows, ~10-15 test files |
| AI Security | B (Moderate) | Allow http localhost for Ollama, block dangerous schemes |
| Git Strategy | B (Test files committed) | Exclude only artifacts |

---

## 1. Project Structure

```
apps/web/
├── e2e/
│   ├── fixtures.ts           # Shared test utilities
│   ├── auth.spec.ts          # 6 tests
│   ├── accessibility.spec.ts # 12 tests
│   ├── theme.spec.ts         # 7 tests
│   ├── subscriptions.spec.ts # 5 tests
│   └── settings.spec.ts      # 6 tests
├── playwright.config.ts
└── package.json              # Add @playwright/test

apps/api/tests/security/
└── ai-validation.test.ts     # 18+ tests
```

---

## 2. API Security Tests (`ai-validation.test.ts`)

### URL Validation (9 tests)
```typescript
describe('AI URL validation', () => {
  // ALLOWED
  test('allows https URLs')
  test('allows http://localhost for Ollama')
  test('allows http://127.0.0.1 for local AI')
  
  // BLOCKED
  test('blocks javascript: URLs')
  test('blocks file:// URLs')
  test('blocks data: URLs')
  test('blocks ftp:// URLs')
  test('blocks URLs with embedded credentials')
  test('blocks empty/whitespace URLs')
});
```

### Model Name Sanitization (9 tests)
```typescript
describe('AI model name validation', () => {
  // ALLOWED
  test('allows alphanumeric model names')
  test('allows model names with hyphens/underscores')
  test('allows model names with colons (ollama format)')
  test('allows model names with slashes (org/model)')
  
  // BLOCKED
  test('blocks model names with shell metacharacters')
  test('blocks model names with path traversal')
  test('blocks model names exceeding max length')
  test('blocks empty model names')
  test('blocks model names with newlines')
});
```

---

## 3. E2E Accessibility Tests (`accessibility.spec.ts`)

```typescript
// Focus Management (4 tests)
test('modal traps focus when open')
test('modal returns focus to trigger on close')
test('skip link moves focus to main content')
test('focus visible on all interactive elements')

// ARIA & Semantics (4 tests)
test('page has exactly one h1')
test('modals have aria-labelledby')
test('form inputs have associated labels')
test('buttons have accessible names')

// Keyboard Navigation (4 tests)
test('Tab navigates through all interactive elements')
test('Escape closes modals')
test('Enter/Space activate buttons')
test('Arrow keys work in dropdowns')
```

---

## 4. E2E Theme Tests (`theme.spec.ts`)

```typescript
// Theme Switching (3 tests)
test('can switch to dark theme')
test('can switch to light theme')
test('can switch to system theme')

// Persistence (2 tests)
test('theme preference persists across page reload')
test('theme preference persists across sessions')

// System Detection (2 tests)
test('system theme responds to prefers-color-scheme')
test('manual override takes precedence over system')
```

---

## 5. E2E Auth Tests (`auth.spec.ts`)

```typescript
// Login Flow (3 tests)
test('can login with valid credentials')
test('shows error for invalid credentials')
test('shows validation errors for empty fields')

// Session Management (2 tests)
test('can logout successfully')
test('session persists across page reload')

// Protected Routes (1 test)
test('redirects to login when accessing protected route unauthenticated')
```

---

## 6. E2E Settings Tests (`settings.spec.ts`)

```typescript
// AI Provider Configuration (6 tests)
test('can navigate to settings page')
test('can select AI provider from dropdown')
test('can enter custom API endpoint')
test('validates API endpoint URL format')
test('can enter API key (masked input)')
test('saves AI settings successfully')
```

---

## 7. E2E Subscriptions Tests (`subscriptions.spec.ts`)

```typescript
// Add Subscription Modal (5 tests)
test('can open add subscription modal')
test('modal has all required form fields')
test('validates required fields')
test('can close modal with cancel button')
test('can close modal with Escape key')
```

---

## 8. Playwright Configuration

```typescript
// apps/web/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],

  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

---

## 9. Git Ignore Additions

```gitignore
# Playwright
test-results/
playwright-report/
playwright/.cache/
```

---

## Implementation Order

1. Update `.gitignore` with Playwright artifacts
2. Add `@playwright/test` to `apps/web/package.json`
3. Create `apps/web/playwright.config.ts`
4. Create `apps/web/e2e/fixtures.ts`
5. Create E2E test files (auth → accessibility → theme → subscriptions → settings)
6. Create `apps/api/tests/security/ai-validation.test.ts`
7. Run full test suite and verify

---

## Running Tests

```bash
# API security tests
cd apps/api && npx vitest run tests/security/ai-validation.test.ts

# E2E tests against dev stack
cd apps/web && E2E_BASE_URL=http://localhost:3000 npx playwright test

# E2E tests (standalone, starts dev server)
cd apps/web && npx playwright test

# Single browser
cd apps/web && npx playwright test --project=chromium
```
