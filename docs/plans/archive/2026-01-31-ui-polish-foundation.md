# UI Polish Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish design system foundations with theme tokens, loading skeletons, grouped sidebar navigation, and enhanced card interactions.

**Architecture:** CSS-first approach using Tailwind's extend config for semantic tokens. Skeleton components using CSS animation. Sidebar restructure with collapsible section groups.

**Tech Stack:** Tailwind CSS, React, Next.js, class-variance-authority

---

## Requirements

**Edge Cases:**
- Theme toggle during skeleton loading (no flash)
- Collapsed sidebar with groups (icons only, no section headers)
- Mobile sidebar with groups (expanded by default)
- Zero-state empty cards vs loading skeletons

**Security:** N/A - Frontend-only changes

**Data Integrity:** N/A - No data changes

**Error Handling:** Graceful fallback if CSS variables undefined (use Tailwind defaults)

---

## Task 1: Add Semantic Status Colors to Tailwind Config

**Quality Requirements:**
- Edge Cases: Both light and dark mode must have proper contrast
- AI Slop Watch: No generic color names, use semantic names

**Files:**
- Modify: `apps/web/tailwind.config.ts`
- Reference: `apps/web/src/styles/themes/listening-room.css`

### Step 1: Update Tailwind config with semantic status colors

Add to `tailwind.config.ts` in the `extend.colors` section:

```typescript
// Add these to the colors section
status: {
  success: 'hsl(var(--success))',
  warning: 'hsl(var(--warning))',
  error: 'hsl(var(--error))',
  info: 'hsl(var(--info, 210 60% 50%))',
},
```

### Step 2: Add info color to theme CSS

Add `--info` variable to `listening-room.css` for both dark and light modes:
- Dark: `--info: 210 40% 55%;` (desaturated blue)
- Light: `--info: 210 50% 45%;` (darker blue for contrast)

### Step 3: Verify changes

Run: `cd apps/web && npm run build`
Expected: Build succeeds, no CSS errors

### Step 4: Commit

```bash
git add apps/web/tailwind.config.ts apps/web/src/styles/themes/listening-room.css
git commit -m "feat(ui): add semantic status color tokens to theme system

- Add status-success, status-warning, status-error, status-info
- Define --info CSS variable for informational states
- Follows existing HSL-based theme token pattern"
```

---

## Task 2: Replace Hardcoded Colors in Dashboard (page.tsx)

**Quality Requirements:**
- Edge Cases: Activity status colors for all three states
- AI Slop Watch: Consistent pattern, no mixed approaches

**Files:**
- Modify: `apps/web/src/app/page.tsx`

### Step 1: Replace stat card colors

Replace:
- `text-blue-500` → `text-status-info`
- `text-green-500` → `text-status-success`
- `text-yellow-500` → `text-status-warning`
- `text-purple-500` → `text-primary` (for Jobs Running - uses brand color)

### Step 2: Replace activity status colors

Replace in activity status logic:
- `bg-green-500/10 text-green-500` → `bg-status-success/10 text-status-success`
- `bg-red-500/10 text-red-500` → `bg-status-error/10 text-status-error`
- `bg-blue-500/10 text-blue-500` → `bg-status-info/10 text-status-info`

### Step 3: Verify changes

Run: `cd apps/web && npm run build`
Expected: Build succeeds

### Step 4: Visual verification

Run dev server, check dashboard in both light and dark modes

### Step 5: Commit

```bash
git add apps/web/src/app/page.tsx
git commit -m "refactor(ui): use semantic status tokens in dashboard

- Replace hardcoded Tailwind colors with theme tokens
- Stat cards use status-info, status-success, status-warning
- Activity indicators use semantic status colors"
```

---

## Task 3: Replace Hardcoded Colors in Jobs Page

**Quality Requirements:**
- Edge Cases: Running, completed, and failed job states
- AI Slop Watch: Match pattern from Task 2

**Files:**
- Modify: `apps/web/src/app/jobs/page.tsx`

### Step 1: Replace job status colors

Replace:
- `text-blue-500` (running) → `text-status-info`
- `text-green-500` (completed) → `text-status-success`
- `text-red-500` (failed) → `text-status-error`

### Step 2: Verify and commit

```bash
git add apps/web/src/app/jobs/page.tsx
git commit -m "refactor(ui): use semantic status tokens in jobs page"
```

---

## Task 4: Replace Hardcoded Colors in Downloads Page

**Files:**
- Modify: `apps/web/src/app/downloads/page.tsx`

### Step 1: Replace download status colors

Replace:
- `text-yellow-500` (pending) → `text-status-warning`
- `text-blue-500` (downloading) → `text-status-info`
- `text-green-500` (completed) → `text-status-success`
- `text-red-500` (failed) → `text-status-error`

### Step 2: Commit

```bash
git add apps/web/src/app/downloads/page.tsx
git commit -m "refactor(ui): use semantic status tokens in downloads page"
```

---

## Task 5: Replace Hardcoded Colors in Library Page

**Files:**
- Modify: `apps/web/src/app/library/page.tsx`

### Step 1: Replace health score colors

Replace conditional color logic:
- `text-green-500` / `bg-green-500` → `text-status-success` / `bg-status-success`
- `text-yellow-500` / `bg-yellow-500` → `text-status-warning` / `bg-status-warning`
- `text-red-500` / `bg-red-500` → `text-status-error` / `bg-status-error`

### Step 2: Commit

```bash
git add apps/web/src/app/library/page.tsx
git commit -m "refactor(ui): use semantic status tokens in library page"
```

---

## Task 6: Replace Hardcoded Colors in Remaining Files

**Files:**
- Modify: `apps/web/src/app/queue/page.tsx`
- Modify: `apps/web/src/app/users/page.tsx`
- Modify: `apps/web/src/app/preview/page.tsx`
- Modify: `apps/web/src/app/setup/page.tsx`
- Modify: `apps/web/src/app/discover/page.tsx`
- Modify: `apps/web/src/components/ExternalLinks.tsx`
- Modify: `apps/web/src/components/layout/mobile-nav.tsx`
- Modify: `apps/web/src/components/library/duplicates-content.tsx`

### Step 1: Batch replace in all files

Apply same pattern: replace `text-green-500`, `text-red-500`, `text-yellow-500`, `text-blue-500` with semantic equivalents.

**Note:** `ExternalLinks.tsx` uses brand colors (Spotify green, Last.fm red) - these should remain as-is since they're brand-specific, not semantic status.

### Step 2: Commit

```bash
git add -A
git commit -m "refactor(ui): complete migration to semantic status tokens

- Queue, users, preview, setup, discover pages
- Duplicates content component
- Mobile nav warning banner
- Preserves brand-specific colors (Spotify, Last.fm)"
```

---

## Task 7: Update Badge Component with Theme Tokens

**Files:**
- Modify: `apps/web/src/components/ui/badge.tsx`

### Step 1: Replace hardcoded badge colors

Update variants:
```typescript
success: 'border-transparent bg-status-success text-white hover:bg-status-success/80',
warning: 'border-transparent bg-status-warning text-white hover:bg-status-warning/80',
// Add error variant
error: 'border-transparent bg-status-error text-white hover:bg-status-error/80',
```

### Step 2: Commit

```bash
git add apps/web/src/components/ui/badge.tsx
git commit -m "refactor(ui): badge component uses semantic status tokens"
```

---

## Task 8: Create Skeleton Component

**Quality Requirements:**
- Edge Cases: Works in both light/dark modes, respects reduced motion
- AI Slop Watch: No unnecessary complexity, CSS-only animation

**Files:**
- Create: `apps/web/src/components/ui/skeleton.tsx`

### Step 1: Write failing test

Create `apps/web/src/components/ui/__tests__/skeleton.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { Skeleton, SkeletonText, SkeletonCard } from '../skeleton';

describe('Skeleton', () => {
  it('renders with default styles', () => {
    render(<Skeleton data-testid="skeleton" />);
    const el = screen.getByTestId('skeleton');
    expect(el).toHaveClass('animate-pulse');
    expect(el).toHaveClass('bg-muted');
  });

  it('applies custom className', () => {
    render(<Skeleton className="w-32 h-8" data-testid="skeleton" />);
    const el = screen.getByTestId('skeleton');
    expect(el).toHaveClass('w-32', 'h-8');
  });

  it('respects reduced motion preference', () => {
    render(<Skeleton data-testid="skeleton" />);
    const el = screen.getByTestId('skeleton');
    expect(el).toHaveClass('motion-reduce:animate-none');
  });
});

describe('SkeletonText', () => {
  it('renders multiple lines', () => {
    render(<SkeletonText lines={3} data-testid="text" />);
    const container = screen.getByTestId('text');
    expect(container.children).toHaveLength(3);
  });
});

describe('SkeletonCard', () => {
  it('renders card structure', () => {
    render(<SkeletonCard data-testid="card" />);
    expect(screen.getByTestId('card')).toBeInTheDocument();
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd apps/web && npm test -- skeleton.test.tsx`
Expected: Tests fail (component not found)

### Step 3: Implement skeleton component

Create `apps/web/src/components/ui/skeleton.tsx`:

```typescript
import * as React from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

function Skeleton({ className, ...props }: SkeletonProps) {
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

interface SkeletonTextProps extends React.HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

function SkeletonText({ lines = 1, className, ...props }: SkeletonTextProps) {
  return (
    <div className={cn('space-y-2', className)} {...props}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            'h-4',
            i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full'
          )}
        />
      ))}
    </div>
  );
}

interface SkeletonCardProps extends React.HTMLAttributes<HTMLDivElement> {
  hasImage?: boolean;
}

function SkeletonCard({ hasImage = true, className, ...props }: SkeletonCardProps) {
  return (
    <div
      className={cn('rounded-lg border bg-card p-6 space-y-4', className)}
      {...props}
    >
      {hasImage && <Skeleton className="h-32 w-full rounded-md" />}
      <SkeletonText lines={2} />
    </div>
  );
}

export { Skeleton, SkeletonText, SkeletonCard };
```

### Step 4: Run tests to verify they pass

Run: `cd apps/web && npm test -- skeleton.test.tsx`
Expected: All tests pass

### Step 5: Export from index

Add to `apps/web/src/components/ui/index.ts`:
```typescript
export * from './skeleton';
```

### Step 6: Commit

```bash
git add apps/web/src/components/ui/skeleton.tsx apps/web/src/components/ui/__tests__/skeleton.test.tsx
git commit -m "feat(ui): add skeleton loading components

- Skeleton base component with pulse animation
- SkeletonText for multi-line text placeholders
- SkeletonCard for card-shaped placeholders
- Respects reduced motion preference"
```

---

## Task 9: Add Dashboard Skeleton Loading States

**Files:**
- Modify: `apps/web/src/app/page.tsx`

### Step 1: Create DashboardSkeleton component

Add to page.tsx (or create separate file):

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

### Step 2: Replace Loader2 spinners with skeletons

Replace:
```tsx
{isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : stat.value}
```

With stat cards showing skeleton shape instead of spinner.

### Step 3: Commit

```bash
git add apps/web/src/app/page.tsx
git commit -m "feat(ui): dashboard uses skeleton loading states

- Stat cards show skeleton placeholders while loading
- Activity feed shows skeleton list items
- Better perceived performance vs spinners"
```

---

## Task 10: Group Sidebar Navigation

**Quality Requirements:**
- Edge Cases: Collapsed sidebar (no group headers), mobile (expanded by default)
- AI Slop Watch: Clean separation of concerns

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

### Step 2: Render groups with headers

When not collapsed, show section headers:
```tsx
{navGroups.map((group) => (
  <div key={group.label} className="mb-2">
    {!collapsed && (
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {group.label}
      </div>
    )}
    {group.items.map((item) => (
      // existing nav item rendering
    ))}
  </div>
))}
```

### Step 3: Handle collapsed state

When collapsed, skip group headers entirely, just show icons.

### Step 4: Commit

```bash
git add apps/web/src/components/layout/sidebar.tsx
git commit -m "feat(ui): group sidebar navigation into sections

- Discovery: Dashboard, Search, Discover
- Management: Subscriptions, Queue, Downloads
- System: Connections, Library, Jobs, Logs, Users, Settings
- Section headers visible when sidebar expanded
- Clean icon-only view when collapsed"
```

---

## Task 11: Enhance Card Hover States

**Files:**
- Modify: `apps/web/src/components/ui/card.tsx`
- Modify: `apps/web/src/app/page.tsx` (quick links)

### Step 1: Add interactive variant to Card

Update card.tsx to support hover enhancement:

```typescript
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border bg-card text-card-foreground shadow-sm',
        interactive && 'transition-all duration-200 hover:border-primary hover:shadow-md hover:-translate-y-0.5 cursor-pointer',
        className
      )}
      {...props}
    />
  )
);
```

### Step 2: Use interactive cards for quick links

Update dashboard quick links:
```tsx
<Card interactive className="h-full">
```

### Step 3: Commit

```bash
git add apps/web/src/components/ui/card.tsx apps/web/src/app/page.tsx
git commit -m "feat(ui): add interactive card variant with enhanced hover

- Cards can opt-in to interactive mode
- Hover: border highlight, shadow elevation, subtle lift
- Applied to dashboard quick links"
```

---

## Task 12: Add Actionable Empty States

**Files:**
- Modify: `apps/web/src/app/page.tsx`

### Step 1: Enhance empty activity state with CTA

Replace:
```tsx
<p className="text-sm text-muted-foreground mt-1">
  Set up connections to get started with music discovery
</p>
```

With:
```tsx
<p className="text-sm text-muted-foreground mt-1">
  Set up connections to get started with music discovery
</p>
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
git commit -m "feat(ui): add actionable CTA to empty dashboard state

- Empty activity shows button to connections page
- Guides new users to first setup step"
```

---

## Task 13: Final Verification & Cleanup

### Step 1: Full build check

Run: `cd apps/web && npm run build`
Expected: Build succeeds with no errors

### Step 2: Visual regression check

Start dev server, manually verify:
- [ ] Dashboard in light mode
- [ ] Dashboard in dark mode
- [ ] Sidebar groups expand/collapse
- [ ] Card hover effects work
- [ ] Skeleton loading shows briefly on slow network
- [ ] Empty state CTA is visible and clickable

### Step 3: Commit any fixes

If any issues found, fix and commit with descriptive message.

### Step 4: Final commit

```bash
git add -A
git commit -m "chore(ui): final polish verification pass"
```

---

## Summary

**Total Tasks:** 13  
**Estimated Time:** 4-6 hours  
**Files Modified:** ~15 files  
**Files Created:** 2 (skeleton component + tests)

**Key Deliverables:**
1. ✅ Semantic status color tokens in theme system
2. ✅ All hardcoded Tailwind colors replaced with tokens
3. ✅ Skeleton loading component library
4. ✅ Dashboard uses skeleton loading states
5. ✅ Sidebar grouped into logical sections
6. ✅ Interactive card variant with enhanced hover
7. ✅ Actionable empty states with CTAs
