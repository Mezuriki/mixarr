# God Component Refactor Design Document

> **Status:** BACKLOG - Deferred to v1.4.0  
> **Created:** January 31, 2026  
> **Priority:** Medium  
> **Estimated Effort:** 8-12 hours

---

## Problem Statement

Two page components have grown to unmanageable sizes:

| Component | Lines | Concerns Mixed |
|-----------|-------|----------------|
| [search/page.tsx](../../apps/web/src/app/search/page.tsx) | **903 lines** | 5 search types, multi-select, bulk actions, MBID resolution, slskd integration |
| [connections/page.tsx](../../apps/web/src/app/connections/page.tsx) | **1817 lines** | 10 connection types, OAuth flows, test connections, edit forms, status tracking |

### Symptoms

1. **Cognitive Overload**: Users see all options at once with no progressive disclosure
2. **Maintenance Burden**: Single file changes risk breaking unrelated functionality
3. **Testing Difficulty**: Hard to unit test individual features when all coupled
4. **Performance**: Entire component re-renders on any state change

---

## Proposed Solutions

### Search Page Refactor

#### Option A: Tab-Based Separation (Recommended)

Split into tabs with lazy-loaded content:

```
/search
├── page.tsx (tab container, ~50 lines)
├── components/
│   ├── ArtistSearch.tsx (~150 lines)
│   ├── AlbumSearch.tsx (~100 lines)
│   ├── LabelSearch.tsx (~100 lines)
│   ├── YearSearch.tsx (~80 lines)
│   └── AISearch.tsx (~150 lines)
└── hooks/
    ├── useArtistSearch.ts
    ├── useAlbumSearch.ts
    └── useBulkSelection.ts
```

**Benefits:**
- Each search type isolated
- Lazy loading reduces initial bundle
- Easier to add new search types

#### Option B: Command Palette (⌘K) Pattern

Single unified search with smart type detection:

```typescript
// User types: "radiohead"
// AI suggests: "Search artists for 'radiohead'?"
// User types: "2024 releases"
// AI suggests: "Search albums from 2024?"
```

**Benefits:**
- Modern UX pattern (Vercel, Linear, Raycast)
- Reduces visual complexity
- AI-powered intent detection

**Drawbacks:**
- Larger refactor
- Requires good AI prompts to be useful

### Connections Page Refactor

#### Option A: Wizard Flow (Recommended)

Multi-step "Add Connection" wizard:

```
Step 1: Choose type (cards with icons)
Step 2: Configure (type-specific form)
Step 3: Test connection
Step 4: Save

/connections
├── page.tsx (list view, ~100 lines)
├── components/
│   ├── ConnectionCard.tsx (~80 lines)
│   ├── ConnectionWizard.tsx (stepper container)
│   └── forms/
│       ├── LidarrForm.tsx
│       ├── SpotifyForm.tsx
│       ├── LastfmForm.tsx
│       └── ... (one per type)
└── hooks/
    ├── useConnectionTest.ts
    └── useOAuthFlow.ts
```

**Benefits:**
- Progressive disclosure (one step at a time)
- Type-specific forms with proper validation
- OAuth flows isolated

#### Option B: Accordion Pattern

Expand/collapse per connection type:

**Benefits:**
- Less routing complexity
- Easy to compare connection types

**Drawbacks:**
- Still shows all types at once
- Mobile experience suffers

---

## Architecture Decisions

### State Management

Current: useState scattered throughout
Proposed: React Query for server state, Zustand for UI state

```typescript
// useConnectionStore.ts
interface ConnectionStore {
  editingId: number | null;
  wizardStep: 'type' | 'config' | 'test' | 'save';
  setEditingId: (id: number | null) => void;
}
```

### Form Handling

Current: Manual useState per field
Proposed: React Hook Form with Zod validation

```typescript
// schemas/connection.ts
export const lidarrConnectionSchema = z.object({
  name: z.string().min(1, 'Name required'),
  url: z.string().url('Must be valid URL'),
  apiKey: z.string().min(32, 'API key must be 32+ characters'),
});
```

### Testing Strategy

- Unit tests for each form component
- Integration tests for wizard flow
- E2E test for complete connection setup

---

## Implementation Phases

### Phase 1: Extract Shared Components (2-3 hours)
- ConnectionCard (used in list and edit views)
- ConnectionTestButton (reusable test action)
- OAuthButton (shared OAuth flow trigger)

### Phase 2: Create Form Components (3-4 hours)
- One form component per connection type
- Zod schemas for validation
- Unit tests for each form

### Phase 3: Build Wizard Flow (2-3 hours)
- Stepper component
- State machine for wizard navigation
- Integration tests

### Phase 4: Migrate Page (1-2 hours)
- Replace monolithic page with new components
- Verify all functionality preserved
- Remove old code

---

## Success Criteria

1. **No file > 300 lines** in the refactored structure
2. **80%+ test coverage** on form components
3. **Bundle size neutral or smaller** (lazy loading)
4. **Zero UX regression** - all existing flows work
5. **Accessibility maintained** - focus management, ARIA

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing OAuth flows | Keep OAuth logic in dedicated hooks, test thoroughly |
| Mobile regression | Test responsive design at each phase |
| Performance regression | Measure bundle size before/after, use lazy loading |
| Scope creep | Stick to refactor only, no new features |

---

## Dependencies

- [ ] UI Polish Foundation (TD-007/TD-008 prerequisite) - establishes design tokens
- [ ] React Hook Form + Zod setup (if not already in project)

---

## References

- [ISSUES.md TD-007](../ISSUES.md) - Search page God Component
- [ISSUES.md TD-008](../ISSUES.md) - Connections page God Component
- [UI/UX Review](.) - Original critique that identified these issues
