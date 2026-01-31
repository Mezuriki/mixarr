# Frontend & Architecture Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish design system foundations, clean up frontend/API architecture violations, and improve UX polish in a unified effort.

**Architecture:** 
- CSS-first design tokens using Tailwind's extend config
- Three-tier separation: Database → API (business logic) → Frontend (presentation)
- Service layer extraction in API for maintainability

**Tech Stack:** Tailwind CSS, React, Next.js, Express, Prisma, class-variance-authority

---

## Requirements

**Edge Cases:**
- Theme toggle during skeleton loading (no flash)
- Collapsed sidebar with groups (icons only)
- Mobile sidebar with groups (expanded by default)
- API returning scored/classified data vs raw data

**Security:**
- Service layer encapsulates data access
- DTOs prevent Prisma model leakage

**Data Integrity:**
- Service methods handle transactions
- DTOs normalize response formats

**Error Handling:**
- Graceful fallback if CSS variables undefined
- Services throw typed errors, routes catch and respond

---

# Phase 1: Design System Foundation (Frontend)

**Estimated Time:** 2-3 hours  
**Priority:** High  
**Risk:** Low (additive CSS changes)

---

## Task 1.1: Add Semantic Status Colors to Tailwind Config

**Files:**
- Modify: `apps/web/tailwind.config.ts`
- Modify: `apps/web/src/styles/themes/listening-room.css`

### Step 1: Update Tailwind config

Add to `tailwind.config.ts` in the `extend.colors` section:

```typescript
status: {
  success: 'hsl(var(--success))',
  warning: 'hsl(var(--warning))',
  error: 'hsl(var(--error))',
  info: 'hsl(var(--info, 210 60% 50%))',
},
```

### Step 2: Add info color to theme CSS

Add `--info` variable to `listening-room.css`:
- Dark: `--info: 210 40% 55%;`
- Light: `--info: 210 50% 45%;`

### Step 3: Verify and commit

```bash
cd apps/web && npm run build
git add apps/web/tailwind.config.ts apps/web/src/styles/themes/listening-room.css
git commit -m "feat(ui): add semantic status color tokens"
```

---

## Task 1.2: Migrate Hardcoded Colors to Theme Tokens

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/jobs/page.tsx`
- Modify: `apps/web/src/app/downloads/page.tsx`
- Modify: `apps/web/src/app/library/page.tsx`
- Modify: `apps/web/src/app/queue/page.tsx`
- Modify: `apps/web/src/app/users/page.tsx`
- Modify: `apps/web/src/app/preview/page.tsx`
- Modify: `apps/web/src/app/setup/page.tsx`
- Modify: `apps/web/src/app/discover/page.tsx`
- Modify: `apps/web/src/components/layout/mobile-nav.tsx`
- Modify: `apps/web/src/components/library/duplicates-content.tsx`

### Step 1: Batch replace across all files

Replace:
- `text-blue-500` → `text-status-info`
- `text-green-500` → `text-status-success`
- `text-yellow-500` → `text-status-warning`
- `text-red-500` → `text-status-error`
- `bg-green-500` → `bg-status-success`
- `bg-yellow-500` → `bg-status-warning`
- `bg-red-500` → `bg-status-error`
- `bg-blue-500` → `bg-status-info`

**Exceptions (keep as-is):**
- `ExternalLinks.tsx` - Spotify green, Last.fm red are brand colors
- `text-purple-500` → `text-primary` (brand color for "Jobs Running")

### Step 2: Verify and commit

```bash
cd apps/web && npm run build
git add -A
git commit -m "refactor(ui): migrate to semantic status color tokens"
```

---

## Task 1.3: Update Badge Component with Theme Tokens

**Files:**
- Modify: `apps/web/src/components/ui/badge.tsx`

### Step 1: Update variants

```typescript
success: 'border-transparent bg-status-success text-white hover:bg-status-success/80',
warning: 'border-transparent bg-status-warning text-white hover:bg-status-warning/80',
error: 'border-transparent bg-status-error text-white hover:bg-status-error/80',
```

### Step 2: Commit

```bash
git add apps/web/src/components/ui/badge.tsx
git commit -m "refactor(ui): badge uses semantic status tokens"
```

---

# Phase 2: Loading Experience (Frontend)

**Estimated Time:** 1-2 hours  
**Priority:** Medium  
**Risk:** Low

---

## Task 2.1: Create Skeleton Component

**Files:**
- Create: `apps/web/src/components/ui/skeleton.tsx`
- Create: `apps/web/src/components/ui/__tests__/skeleton.test.tsx`

### Step 1: Write failing tests

```typescript
// skeleton.test.tsx
describe('Skeleton', () => {
  it('renders with pulse animation', () => {
    render(<Skeleton data-testid="skeleton" />);
    expect(screen.getByTestId('skeleton')).toHaveClass('animate-pulse');
  });

  it('respects reduced motion preference', () => {
    render(<Skeleton data-testid="skeleton" />);
    expect(screen.getByTestId('skeleton')).toHaveClass('motion-reduce:animate-none');
  });
});

describe('SkeletonText', () => {
  it('renders specified number of lines', () => {
    render(<SkeletonText lines={3} data-testid="text" />);
    expect(screen.getByTestId('text').children).toHaveLength(3);
  });
});
```

### Step 2: Implement component

```typescript
// skeleton.tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-muted motion-reduce:animate-none',
        className
      )}
      {...props}
    />
  );
}

function SkeletonText({ lines = 1, className, ...props }: { lines?: number } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('space-y-2', className)} {...props}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-4', i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full')} />
      ))}
    </div>
  );
}

function SkeletonCard({ hasImage = true, className, ...props }: { hasImage?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-lg border bg-card p-6 space-y-4', className)} {...props}>
      {hasImage && <Skeleton className="h-32 w-full rounded-md" />}
      <SkeletonText lines={2} />
    </div>
  );
}

export { Skeleton, SkeletonText, SkeletonCard };
```

### Step 3: Run tests, commit

```bash
cd apps/web && npm test -- skeleton.test.tsx
git add apps/web/src/components/ui/skeleton.tsx apps/web/src/components/ui/__tests__/skeleton.test.tsx
git commit -m "feat(ui): add skeleton loading components"
```

---

## Task 2.2: Add Dashboard Skeleton Loading States

**Files:**
- Modify: `apps/web/src/app/page.tsx`

### Step 1: Create skeleton components for stat cards and activity

```typescript
function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-6">
        <Skeleton className="h-11 w-11 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-12" />
          <Skeleton className="h-4 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}
```

### Step 2: Replace Loader2 spinners with skeletons, commit

```bash
git add apps/web/src/app/page.tsx
git commit -m "feat(ui): dashboard uses skeleton loading states"
```

---

# Phase 3: Navigation & Interaction Polish (Frontend)

**Estimated Time:** 1-2 hours  
**Priority:** Medium  
**Risk:** Low

---

## Task 3.1: Group Sidebar Navigation

**Files:**
- Modify: `apps/web/src/components/layout/sidebar.tsx`

### Step 1: Define navigation groups

```typescript
const navGroups = [
  {
    label: 'Discovery',
    items: [
      { href: '/', label: 'Dashboard', icon: Home },
      { href: '/search', label: 'Search', icon: Search },
      { href: '/discover', label: 'Discover', icon: Sparkles },
    ],
  },
  {
    label: 'Management',
    items: [
      { href: '/subscriptions', label: 'Subscriptions', icon: TrendingUp },
      { href: '/queue', label: 'Review Queue', icon: ListChecks },
      { href: '/downloads', label: 'Downloads', icon: Download },
    ],
  },
  {
    label: 'System',
    adminOnly: true,
    items: [
      { href: '/connections', label: 'Connections', icon: Plug },
      { href: '/library', label: 'Library', icon: Library },
      { href: '/jobs', label: 'Jobs', icon: Layers },
      { href: '/logs', label: 'Logs', icon: FileText },
      { href: '/users', label: 'Users', icon: Users },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];
```

### Step 2: Render groups with headers (skip when collapsed)

### Step 3: Commit

```bash
git add apps/web/src/components/layout/sidebar.tsx
git commit -m "feat(ui): group sidebar navigation into sections"
```

---

## Task 3.2: Enhance Card Hover States

**Files:**
- Modify: `apps/web/src/components/ui/card.tsx`
- Modify: `apps/web/src/app/page.tsx`

### Step 1: Add interactive prop to Card

```typescript
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

// Add: interactive && 'transition-all duration-200 hover:border-primary hover:shadow-md hover:-translate-y-0.5 cursor-pointer'
```

### Step 2: Apply to dashboard quick links, commit

```bash
git add apps/web/src/components/ui/card.tsx apps/web/src/app/page.tsx
git commit -m "feat(ui): add interactive card variant with enhanced hover"
```

---

## Task 3.3: Add Actionable Empty States

**Files:**
- Modify: `apps/web/src/app/page.tsx`

### Step 1: Add CTA button to empty activity state

```tsx
<Button asChild className="mt-4">
  <Link href="/connections">
    <Plug className="h-4 w-4 mr-2" />
    Configure Connections
  </Link>
</Button>
```

### Step 2: Commit

```bash
git add apps/web/src/app/page.tsx
git commit -m "feat(ui): add actionable CTA to empty dashboard state"
```

---

# Phase 4: Move Business Logic to API

**Estimated Time:** 4-6 hours  
**Priority:** High  
**Risk:** Medium (API changes require frontend updates)

---

## Task 4.1: Move Soulseek Quality Scoring to API

**Files:**
- Modify: `apps/api/src/services/slskd.ts`
- Modify: `apps/api/src/routes/slskd.ts`
- Create: `apps/api/tests/services/slskd-scoring.test.ts`
- Modify: `apps/web/src/components/modals/SearchModal.tsx`

### Step 1: Write failing tests

```typescript
// slskd-scoring.test.ts
describe('scoreSearchResult', () => {
  it('gives high score to lossless with fast upload', () => {
    const result = scoreSearchResult({
      files: [{ extension: 'flac', size: 50000000 }],
      uploadSpeed: 5000000,
      hasFreeUploadSlot: true,
      queueLength: 0,
    });
    expect(result).toBeGreaterThan(70);
  });

  it('penalizes long queue', () => {
    const highQueue = scoreSearchResult({ ...baseResult, queueLength: 100 });
    const lowQueue = scoreSearchResult({ ...baseResult, queueLength: 0 });
    expect(lowQueue).toBeGreaterThan(highQueue);
  });
});
```

### Step 2: Implement scoring in API service

```typescript
// apps/api/src/services/slskd.ts
function scoreSearchResult(response: SlskdSearchResponse): number {
  let score = 0;
  const hasLossless = response.files.some(f => isLosslessFormat(f.extension));
  if (hasLossless) score += 50;
  score += Math.min(response.uploadSpeed / 100000, 30);
  if (response.hasFreeUploadSlot) score += 10;
  score -= Math.min(response.queueLength / 10, 10);
  return Math.round(score);
}

function isLosslessFormat(ext: string): boolean {
  const lossless = ['flac', 'ape', 'wav', 'alac', 'aiff'];
  return lossless.includes(ext?.toLowerCase() || '');
}
```

### Step 3: Return scored results from search endpoint

### Step 4: Remove scoring from frontend, use API field

### Step 5: Commit

```bash
git add apps/api/src/services/slskd.ts apps/api/tests/services/slskd-scoring.test.ts apps/web/src/components/modals/SearchModal.tsx
git commit -m "refactor: move slskd quality scoring from frontend to API"
```

---

## Task 4.2: Move Audio Format Classification to API

**Files:**
- Modify: `apps/api/src/services/slskd.ts`
- Modify: `apps/api/src/types/slskd.ts`
- Create: `apps/api/tests/services/slskd-format.test.ts`
- Modify: `apps/web/src/components/modals/SearchModal.tsx`

### Step 1: Write failing tests for format classification

```typescript
describe('classifyFileFormat', () => {
  it('identifies FLAC as lossless', () => {
    const result = classifyFileFormat({ extension: 'flac' });
    expect(result).toEqual({ format: 'FLAC', isLossless: true });
  });

  it('distinguishes MP3-320 from MP3', () => {
    const high = classifyFileFormat({ extension: 'mp3', bitRate: 320 });
    const low = classifyFileFormat({ extension: 'mp3', bitRate: 128 });
    expect(high.format).toBe('MP3-320');
    expect(low.format).toBe('MP3');
  });
});
```

### Step 2: Implement classification in API

### Step 3: Return classified files from search endpoint

### Step 4: Remove classification from frontend

### Step 5: Commit

```bash
git add -A
git commit -m "refactor: move audio format classification from frontend to API"
```

---

## Task 4.3: Create Subscription Types Metadata Endpoint

**Files:**
- Create: `apps/api/src/lib/subscriptions/types.ts`
- Modify: `apps/api/src/routes/subscriptions.ts`
- Create: `apps/api/tests/api/subscription-types.test.ts`
- Modify: `apps/web/src/components/subscriptions/types.ts`
- Modify: `apps/web/src/components/modals/SubscriptionModal.tsx`

### Step 1: Define subscription type metadata in API

```typescript
// apps/api/src/lib/subscriptions/types.ts
export interface SubscriptionTypeDefinition {
  value: string;
  label: string;
  description: string;
  category: 'lastfm' | 'spotify' | 'musicbrainz' | 'listenbrainz' | 'ai';
  icon: string;
  requiredFields: FieldDefinition[];
  optionalFields: FieldDefinition[];
}

export const SUBSCRIPTION_TYPES: SubscriptionTypeDefinition[] = [
  // All 50+ subscription types with metadata
];
```

### Step 2: Add GET /api/subscriptions/types endpoint

```typescript
router.get('/types', (req, res) => {
  res.json(SUBSCRIPTION_TYPES);
});
```

### Step 3: Write integration tests

### Step 4: Update frontend to fetch types from API

```typescript
// apps/web/src/components/subscriptions/types.ts
export function useSubscriptionTypes() {
  return useQuery({
    queryKey: ['subscriptionTypes'],
    queryFn: () => api.get('/subscriptions/types'),
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
  });
}
```

### Step 5: Commit

```bash
git add -A
git commit -m "refactor: serve subscription type metadata from API endpoint"
```

---

# Phase 5: Move Presentation Logic to Frontend

**Estimated Time:** 2 hours  
**Priority:** Medium  
**Risk:** Low

---

## Task 5.1: Move Webhook Event Labels to Frontend

**Files:**
- Modify: `apps/api/src/routes/webhooks.ts`
- Create: `apps/web/src/lib/webhooks.ts`
- Modify: `apps/web/src/app/settings/webhooks/page.tsx`

### Step 1: API returns raw event identifiers only

```typescript
// Before
res.json(VALID_EVENTS.map(event => ({
  value: event,
  label: formatEventLabel(event),
  description: getEventDescription(event),
})));

// After
res.json(VALID_EVENTS);
```

### Step 2: Frontend adds formatting

```typescript
// apps/web/src/lib/webhooks.ts
const EVENT_LABELS: Record<string, string> = {
  'subscription.completed': 'Subscription Completed',
  'subscription.failed': 'Subscription Failed',
  // ...
};

export function formatEventLabel(event: string): string {
  return EVENT_LABELS[event] || event;
}
```

### Step 3: Commit

```bash
git add -A
git commit -m "refactor: move webhook event labels from API to frontend"
```

---

## Task 5.2: Move Dashboard Description Formatting to Frontend

**Files:**
- Modify: `apps/api/src/routes/dashboard.ts`
- Modify: `apps/web/src/app/page.tsx`

### Step 1: API returns raw status and counts

```typescript
// Return raw fields instead of pre-formatted description
status: run.status,
addedCount: run.addedCount,
skippedCount: run.skippedCount,
errorMessage: run.errorMessage,
```

### Step 2: Frontend formats for display

```typescript
function formatRunDescription(run: DashboardRun): string {
  if (run.status === 'completed') {
    return `Added ${run.addedCount} artists, skipped ${run.skippedCount}`;
  }
  if (run.status === 'failed') {
    return `Failed: ${run.errorMessage}`;
  }
  return 'Running...';
}
```

### Step 3: Commit

```bash
git add -A
git commit -m "refactor: move dashboard description formatting to frontend"
```

---

# Phase 6: API Service Layer Extraction

**Estimated Time:** 4-6 hours  
**Priority:** Medium  
**Risk:** Medium (internal refactor)

---

## Task 6.1: Create UserService

**Files:**
- Create: `apps/api/src/services/user.ts`
- Create: `apps/api/tests/services/user.test.ts`
- Modify: `apps/api/src/routes/users.ts`

### Step 1: Write failing tests

```typescript
describe('UserService', () => {
  it('findAll returns all users', async () => {
    const users = await userService.findAll();
    expect(Array.isArray(users)).toBe(true);
  });

  it('create hashes password', async () => {
    const user = await userService.create({ username: 'test', password: 'plain' });
    expect(user.password).not.toBe('plain');
  });
});
```

### Step 2: Implement UserService

```typescript
export class UserService {
  async findAll(options?: { includeStats?: boolean }): Promise<User[]> { ... }
  async findById(id: number): Promise<User | null> { ... }
  async create(data: CreateUserInput): Promise<User> { ... }
  async update(id: number, data: UpdateUserInput): Promise<User> { ... }
  async delete(id: number): Promise<void> { ... }
  async validatePassword(user: User, password: string): Promise<boolean> { ... }
}
```

### Step 3: Refactor routes to use service

### Step 4: Commit

```bash
git add -A
git commit -m "refactor: extract UserService from users routes"
```

---

## Task 6.2: Create ConnectionService

**Files:**
- Create: `apps/api/src/services/connection.ts`
- Create: `apps/api/tests/services/connection.test.ts`
- Modify: `apps/api/src/routes/connections.ts`

### Step 1: Implement ConnectionService

```typescript
export class ConnectionService {
  async findAll(userId?: number): Promise<Connection[]> { ... }
  async findById(id: number): Promise<Connection | null> { ... }
  async findByType(type: ConnectionType): Promise<Connection[]> { ... }
  async getActiveConnection(type: ConnectionType): Promise<Connection | null> { ... }
  async create(data: CreateConnectionInput): Promise<Connection> { ... }
  async update(id: number, data: UpdateConnectionInput): Promise<Connection> { ... }
  async delete(id: number): Promise<void> { ... }
  async testConnection(id: number): Promise<ConnectionTestResult> { ... }
}
```

### Step 2: Write tests, refactor routes, commit

---

## Task 6.3: Create Remaining Services

Create services for:
- `SettingsService` (from settings.ts)
- `NotificationChannelService` (from notifications.ts)
- `LogService` (from logs.ts)
- `DuplicateService` (from duplicates.ts)
- `AISettingsService` (from ai.ts)

Each follows the same pattern: TDD, extract Prisma calls, refactor routes.

---

# Phase 7: Final Verification

**Estimated Time:** 1 hour  
**Priority:** Critical

---

## Task 7.1: Full Build & Test Verification

### Step 1: Build both apps

```bash
cd apps/api && npm run build
cd apps/web && npm run build
```

### Step 2: Run all tests

```bash
cd apps/api && npm test
cd apps/web && npm test
```

### Step 3: Visual regression check

- [ ] Dashboard light/dark modes
- [ ] Sidebar groups expand/collapse
- [ ] Card hover effects
- [ ] Skeleton loading on slow network
- [ ] Empty state CTAs
- [ ] slskd search shows scored results
- [ ] Subscription modal shows correct fields

### Step 4: Final commit

```bash
git add -A
git commit -m "chore: complete frontend and architecture polish"
```

---

## Summary

| Phase | Focus | Tasks | Time |
|-------|-------|-------|------|
| 1 | Design System Foundation | 3 | 2-3h |
| 2 | Loading Experience | 2 | 1-2h |
| 3 | Navigation & Interaction | 3 | 1-2h |
| 4 | Business Logic to API | 3 | 4-6h |
| 5 | Presentation to Frontend | 2 | 2h |
| 6 | Service Layer Extraction | 3+ | 4-6h |
| 7 | Verification | 1 | 1h |

**Total Estimated Time:** 15-22 hours (3-4 days)

**Key Deliverables:**
1. ✅ Semantic status color tokens in theme system
2. ✅ Skeleton loading components + dashboard integration
3. ✅ Grouped sidebar navigation
4. ✅ Interactive card variant
5. ✅ Actionable empty states
6. ✅ slskd scoring/classification in API (not frontend)
7. ✅ Subscription types served from API endpoint
8. ✅ UI text formatting in frontend (not API)
9. ✅ Service layer for User, Connection, Settings, etc.

---

## Dependencies

```
Phase 1 (Design System) ──┐
                          ├──► Phase 3 (Navigation/Interaction) ──┐
Phase 2 (Loading) ────────┘                                       │
                                                                  ├──► Phase 7 (Verification)
Phase 4 (Business Logic) ─────────────────────────────────────────┤
                                                                  │
Phase 5 (Presentation) ───────────────────────────────────────────┤
                                                                  │
Phase 6 (Service Layer) ──────────────────────────────────────────┘
```

Phases 1-3 (Frontend) can proceed in parallel with Phases 4-6 (API).
