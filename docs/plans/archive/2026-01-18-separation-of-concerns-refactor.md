# Separation of Concerns Refactoring Plan

**Created:** January 18, 2026  
**Status:** Planning  
**Priority:** Medium-High  
**Estimated Effort:** 3-4 days (split into phases)

---

## Overview

This plan addresses 8 separation of concerns violations identified in the three-tier architecture review. The codebase follows a Database → API → Frontend model, but has accumulated violations where:
- Frontend contains business logic that should be in API
- API contains presentation logic that should be in Frontend
- API routes access Prisma directly instead of through services
- Data layer leaks Prisma models to API responses

## Success Criteria

- [ ] All scoring/classification logic moved to API
- [ ] Subscription type metadata served from API endpoint
- [ ] Service layer extracted for 8 route files
- [ ] UI text generation moved to frontend
- [ ] DTOs defined for API responses
- [ ] All existing tests pass
- [ ] New tests for extracted services

---

## Phase 1: Move Business Logic from Frontend to API

**Estimated Time:** 4-6 hours  
**Priority:** High  
**Risk:** Low (additive changes to API, then update frontend)

### Task 1.1: Move Soulseek Quality Scoring to API

**Files:**
- `apps/api/src/services/slskd.ts` - Add scoring logic
- `apps/api/src/routes/slskd.ts` - Return scored results
- `apps/web/src/components/modals/SearchModal.tsx` - Remove scoring, use API field

**Implementation:**

1. **API - Add scoring function to slskd service:**
```typescript
// apps/api/src/services/slskd.ts

interface QualityScoredResult extends SlskdSearchResponse {
  qualityScore: number;
  hasLossless: boolean;
}

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

2. **API - Return scored results from search endpoint:**
```typescript
// In search handler
const scoredResults = results.map(r => ({
  ...r,
  qualityScore: scoreSearchResult(r),
  hasLossless: r.files.some(f => isLosslessFormat(f.extension))
}));

// Sort by quality score descending
scoredResults.sort((a, b) => b.qualityScore - a.qualityScore);
```

3. **Frontend - Remove scoring, use qualityScore field:**
```typescript
// Remove scoreResult() function entirely
// Sort already done by API
// Display qualityScore from response
```

**Tests:**
- Unit test for `scoreSearchResult()` with various inputs
- Test lossless detection edge cases
- Integration test for search endpoint returning scored results

---

### Task 1.2: Move Audio Format Classification to API

**Files:**
- `apps/api/src/services/slskd.ts` - Add format classification
- `apps/api/src/types/slskd.ts` - Add format fields to types
- `apps/web/src/components/modals/SearchModal.tsx` - Remove classification

**Implementation:**

1. **API - Add format classification:**
```typescript
// apps/api/src/services/slskd.ts

type AudioFormat = 'FLAC' | 'MP3-320' | 'MP3-256' | 'MP3' | 'OGG' | 'AAC' | 'APE' | 'WAV' | 'ALAC' | 'UNKNOWN';

interface ClassifiedFile extends SlskdFile {
  format: AudioFormat;
  isLossless: boolean;
}

function classifyFileFormat(file: SlskdFile): { format: AudioFormat; isLossless: boolean } {
  const ext = (file.extension || file.filename.split('.').pop() || '').toLowerCase();
  
  const losslessFormats = ['flac', 'ape', 'wav', 'alac', 'aiff'];
  if (losslessFormats.includes(ext)) {
    return { format: ext.toUpperCase() as AudioFormat, isLossless: true };
  }
  
  if (ext === 'mp3') {
    if (file.bitRate && file.bitRate >= 320) return { format: 'MP3-320', isLossless: false };
    if (file.bitRate && file.bitRate >= 256) return { format: 'MP3-256', isLossless: false };
    return { format: 'MP3', isLossless: false };
  }
  
  if (['ogg', 'opus'].includes(ext)) return { format: 'OGG', isLossless: false };
  if (ext === 'm4a') return { format: 'AAC', isLossless: false };
  
  return { format: 'UNKNOWN', isLossless: false };
}
```

2. **API - Classify files in search response:**
```typescript
const classifiedResults = results.map(r => ({
  ...r,
  files: r.files.map(f => ({
    ...f,
    ...classifyFileFormat(f)
  }))
}));
```

3. **Frontend - Use format/isLossless from API:**
```typescript
// Remove getFileFormat() and isLossless() functions
// Use file.format and file.isLossless from response
```

**Tests:**
- Unit tests for all format classifications
- Edge cases: missing extension, unusual bitrates, unknown formats

---

### Task 1.3: Create Subscription Types Metadata Endpoint

**Files:**
- `apps/api/src/routes/subscriptions.ts` - Add GET /types endpoint
- `apps/api/src/lib/subscriptions/types.ts` - Move type definitions (new file)
- `apps/web/src/components/subscriptions/types.ts` - Refactor to fetch from API
- `apps/web/src/components/modals/SubscriptionModal.tsx` - Use fetched metadata

**Implementation:**

1. **API - Create subscription types definition:**
```typescript
// apps/api/src/lib/subscriptions/types.ts

export interface SubscriptionTypeDefinition {
  value: string;
  label: string;
  description: string;
  category: 'lastfm' | 'spotify' | 'musicbrainz' | 'listenbrainz' | 'ai';
  icon: string; // Icon name, not component
  requiredFields: RequiredFieldDefinition[];
  optionalFields: OptionalFieldDefinition[];
  warnings?: string[];
}

export interface RequiredFieldDefinition {
  field: string;
  label: string;
  type: 'text' | 'select' | 'number';
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export const SUBSCRIPTION_TYPES: SubscriptionTypeDefinition[] = [
  {
    value: 'lastfm_chart',
    label: 'Last.fm Charts',
    description: 'Top artists by country/global',
    category: 'lastfm',
    icon: 'TrendingUp',
    requiredFields: [
      { field: 'country', label: 'Country', type: 'select', options: [...] }
    ],
    optionalFields: []
  },
  // ... all 50+ types
];
```

2. **API - Add endpoint:**
```typescript
// apps/api/src/routes/subscriptions.ts

router.get('/types', async (req, res) => {
  res.json(SUBSCRIPTION_TYPES);
});

router.get('/types/:type', async (req, res) => {
  const type = SUBSCRIPTION_TYPES.find(t => t.value === req.params.type);
  if (!type) {
    return res.status(404).json({ error: 'Unknown subscription type' });
  }
  res.json(type);
});
```

3. **Frontend - Fetch types from API:**
```typescript
// apps/web/src/components/subscriptions/types.ts

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useSubscriptionTypes() {
  return useQuery({
    queryKey: ['subscriptionTypes'],
    queryFn: () => api.get('/subscriptions/types'),
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
  });
}

// Map icon names to components
const ICON_MAP: Record<string, React.ComponentType> = {
  TrendingUp: TrendingUpIcon,
  Music: MusicIcon,
  // ...
};
```

4. **Frontend - Update SubscriptionModal to use fetched data:**
```typescript
// Remove hardcoded SUBSCRIPTION_TYPES and REQUIRED_FIELDS
// Use useSubscriptionTypes() hook
// Dynamically render form based on type.requiredFields
```

**Tests:**
- API endpoint returns all types
- API endpoint returns 404 for unknown type
- Frontend correctly renders dynamic form fields

---

## Phase 2: Extract API Service Layer

**Estimated Time:** 6-8 hours  
**Priority:** High  
**Risk:** Medium (requires careful refactoring)

### Task 2.1: Create UserService

**Files:**
- `apps/api/src/services/user.ts` (new)
- `apps/api/src/routes/users.ts` (refactor)
- `apps/api/tests/services/user.test.ts` (new)

**Implementation:**
```typescript
// apps/api/src/services/user.ts

export class UserService {
  async findAll(options?: { includeStats?: boolean }): Promise<User[]> {
    return prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
        ...(options?.includeStats && {
          _count: { select: { connections: true, subscriptions: true } }
        })
      }
    });
  }

  async findById(id: number): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async create(data: CreateUserInput): Promise<User> {
    const hashedPassword = await bcrypt.hash(data.password, 12);
    return prisma.user.create({
      data: { ...data, password: hashedPassword }
    });
  }

  async update(id: number, data: UpdateUserInput): Promise<User> {
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 12);
    }
    return prisma.user.update({ where: { id }, data });
  }

  async delete(id: number): Promise<void> {
    await prisma.user.delete({ where: { id } });
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password);
  }
}

export const userService = new UserService();
```

**Route refactor:**
```typescript
// apps/api/src/routes/users.ts
import { userService } from '../services/user';

router.get('/', async (req, res) => {
  const users = await userService.findAll({ includeStats: true });
  res.json(users);
});
```

---

### Task 2.2: Create ConnectionService

**Files:**
- `apps/api/src/services/connection.ts` (new)
- `apps/api/src/routes/connections.ts` (refactor)

**Implementation:**
```typescript
// apps/api/src/services/connection.ts

export class ConnectionService {
  async findAll(userId?: number): Promise<Connection[]> { ... }
  async findById(id: number): Promise<Connection | null> { ... }
  async findByType(type: ConnectionType): Promise<Connection[]> { ... }
  async getActiveConnection(type: ConnectionType): Promise<Connection | null> { ... }
  async create(data: CreateConnectionInput): Promise<Connection> { ... }
  async update(id: number, data: UpdateConnectionInput): Promise<Connection> { ... }
  async delete(id: number): Promise<void> { ... }
  async testConnection(id: number): Promise<ConnectionTestResult> { ... }
  async resolveWithDefaults(id: number): Promise<ResolvedConnection> { ... }
}
```

This also addresses SOC-008 (duplicate helpers).

---

### Task 2.3: Create SettingsService

**Files:**
- `apps/api/src/services/settings.ts` (new)
- `apps/api/src/routes/settings.ts` (refactor)

---

### Task 2.4: Create Remaining Services

Create services for:
- `ImportSourceService` - for `importSources.ts`
- `NotificationChannelService` - for channel CRUD in `notifications.ts`
- `LogService` - for `logs.ts`
- `DuplicateService` - for `duplicates.ts`
- `AISettingsService` - for AI settings in `ai.ts`

Each follows the same pattern: extract Prisma calls from routes to service methods.

---

## Phase 3: Move Presentation Logic from API to Frontend

**Estimated Time:** 2-3 hours  
**Priority:** Medium  
**Risk:** Low (frontend changes only after API returns raw data)

### Task 3.1: Remove UI Text from Webhook Events

**Files:**
- `apps/api/src/routes/webhooks.ts` - Remove `formatEventLabel()`, `getEventDescription()`
- `apps/web/src/app/settings/webhooks/` - Add label/description mapping

**Implementation:**

1. **API - Return raw event identifiers:**
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

2. **Frontend - Add formatting:**
```typescript
// apps/web/src/lib/webhooks.ts

const EVENT_LABELS: Record<string, string> = {
  'subscription.completed': 'Subscription Completed',
  'subscription.failed': 'Subscription Failed',
  // ...
};

const EVENT_DESCRIPTIONS: Record<string, string> = {
  'subscription.completed': 'Fired when a subscription run completes successfully',
  // ...
};

export function formatEventLabel(event: string): string {
  return EVENT_LABELS[event] || event;
}
```

---

### Task 3.2: Move Dashboard Description Formatting

**Files:**
- `apps/api/src/routes/dashboard.ts` - Return raw status/counts
- `apps/web/src/app/dashboard/page.tsx` - Format descriptions

**Implementation:**

1. **API - Return raw data:**
```typescript
// Before
description: run.status === 'completed' 
  ? `Added ${run.addedCount} artists, skipped ${run.skippedCount}`
  : run.status === 'failed'
  ? `Failed: ${run.errorMessage}`
  : 'Running...',

// After - return raw fields
status: run.status,
addedCount: run.addedCount,
skippedCount: run.skippedCount,
errorMessage: run.errorMessage,
```

2. **Frontend - Format for display:**
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

---

## Phase 4: Create DTOs and Clean Up Data Layer

**Estimated Time:** 2-3 hours  
**Priority:** Medium  
**Risk:** Low (additive, doesn't break existing)

### Task 4.1: Define Response DTOs

**Files:**
- `apps/api/src/dto/` (new directory)
- Individual DTO files for each domain

**Implementation:**
```typescript
// apps/api/src/dto/user.dto.ts

export interface UserDTO {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
  stats?: {
    connectionCount: number;
    subscriptionCount: number;
  };
}

export function toUserDTO(user: PrismaUser & { _count?: any }): UserDTO {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    stats: user._count ? {
      connectionCount: user._count.connections,
      subscriptionCount: user._count.subscriptions,
    } : undefined,
  };
}
```

Apply similar pattern to:
- `ConnectionDTO`
- `SubscriptionDTO`
- `SubscriptionResultDTO`
- `ImportSourceDTO`
- `NotificationChannelDTO`

---

## Testing Strategy

### Unit Tests (per service)
- Each service method tested in isolation
- Mock Prisma client
- Test business logic, validation, error cases

### Integration Tests (per route)
- Routes call real services
- Services use test database
- Verify HTTP responses match DTOs

### Regression Tests
- All existing tests must pass
- No breaking changes to API contracts

---

## Rollout Plan

1. **Phase 1** - Frontend business logic
   - Deploy API changes first (backward compatible)
   - Deploy frontend changes
   - Verify scoring/classification works

2. **Phase 2** - Service extraction
   - Internal refactor, no API changes
   - Deploy with all tests passing
   - Monitor for errors

3. **Phase 3** - Presentation logic
   - API returns raw data (may need versioning)
   - Frontend formats for display
   - Coordinate deployment

4. **Phase 4** - DTOs
   - Add DTOs without removing raw data first
   - Migrate routes to use DTOs
   - Remove raw Prisma exposure

---

## Acceptance Criteria

- [ ] No `scoreResult()` or format classification in frontend
- [ ] `GET /api/subscriptions/types` endpoint exists and is used
- [ ] 8 new service classes extracted from routes
- [ ] No UI text generated in API (labels, descriptions)
- [ ] DTOs defined for major response types
- [ ] 100% of existing tests pass
- [ ] New service tests achieve 80%+ coverage
