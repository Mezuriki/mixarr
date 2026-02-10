# Design Polish: Selective Wednesday Enhancements

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Elevate Mixarr's visual polish from "competent admin panel" to "premium product" by selectively adopting Wednesday Design principles — fonts, border radii, button gradients, shadows, and hover effects — without replacing the Listening Room color identity or adding inappropriate marketing-page components.

**Architecture:** All changes target the design token layer (CSS variables, Tailwind config) and a handful of shared UI components. No new dependencies except `next/font/google` (already built into Next.js). The Listening Room rust/copper + teal palette is preserved. Changes propagate through CSS custom properties, so every page benefits automatically.

**Tech Stack:** Next.js 14, Tailwind CSS 3.4, CSS custom properties, `next/font/google`, CVA (class-variance-authority)

---

**Requirements:**
- Edge Cases: Dark/light mode parity, mobile responsiveness unbroken, existing component tests still pass
- Security: N/A (purely visual changes)
- Data Integrity: N/A
- Error Handling: Font loading gracefully falls back to system stack if Google Fonts unavailable

---

## Pre-Planning Quality Analysis

### 🦆 Edge Cases
- **Font loading failure**: Google Fonts CDN down → must fall back to system fonts gracefully. `next/font/google` handles this with `display: swap` and local fallback.
- **Dark/light mode**: Every shadow, gradient, and glow token must work in both modes. The listening-room.css already duplicates tokens for both.
- **Sidebar collapsed state**: Radius changes must not break the 64px collapsed sidebar.
- **Mobile**: Touch targets must remain ≥44px. Larger radii don't affect this.
- **Existing hardcoded classes**: FeedCard and DashboardTiles use raw Tailwind classes (`bg-gray-800`, `rounded-lg`) that won't inherit token changes — these need individual attention.

### 💀 Breaking Risk Assessment
- **Zero API changes** — purely frontend CSS/config
- **No component interface changes** — props stay the same
- **Existing tests** use class matching and DOM structure, not visual assertions → tests won't break
- **Risk**: FeedCard uses hardcoded `bg-gray-800`/`rounded-lg` which bypasses the theme system. The plan addresses this.

### 🤖 AI Slop Watch
- Don't add useless "design system" abstractions for a small project
- Don't over-engineer a token system when CSS variables work fine
- Each task must produce a visible before/after difference

---

## Task 1: Load Google Fonts via next/font

**Quality Requirements:**
- Edge Cases: Font unavailable → system fallback works
- AI Slop Watch: Don't import every weight — only what's used

**Files:**
- Modify: `apps/web/src/app/layout.tsx` (add font imports)
- Modify: `apps/web/tailwind.config.ts` (update fontFamily)
- Modify: `apps/web/src/styles/themes/listening-room.css` (remove hardcoded font-family)

**Step 1: Write the font loading code**

In `apps/web/src/app/layout.tsx`, add `next/font/google` imports for DM Sans (body) and Instrument Serif (display headings):

```tsx
import { DM_Sans, Instrument_Serif } from 'next/font/google';

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});
```

Update the `<body>` tag to include CSS variable classes:

```tsx
<body className={`${dmSans.variable} ${instrumentSerif.variable} font-sans`}>
```

**Step 2: Update Tailwind config**

In `apps/web/tailwind.config.ts`, update fontFamily:

```typescript
fontFamily: {
  sans: ['var(--font-body)', 'DM Sans', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
  display: ['var(--font-display)', 'Instrument Serif', 'Georgia', 'serif'],
  mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
},
```

**Step 3: Remove hardcoded font-family from theme CSS**

In `apps/web/src/styles/themes/listening-room.css`, remove these 3 lines (one in `:root`, one in `:root[data-theme="light"]`, one in `@media (prefers-color-scheme: light)`):

```css
/* REMOVE from all three blocks: */
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
```

The font is now controlled by Tailwind's `font-sans` class on `<body>`, which uses the CSS variable set by `next/font`.

**Step 4: Verify**

Run: `cd apps/web && npx next build 2>&1 | tail -20`
Expected: Build succeeds with no errors. Fonts are self-hosted by Next.js (no external CDN requests at runtime).

**Step 5: Commit**

```bash
git add apps/web/src/app/layout.tsx apps/web/tailwind.config.ts apps/web/src/styles/themes/listening-room.css
git commit -m "style: load DM Sans + Instrument Serif via next/font

- DM Sans for body text (400-700 weights)
- Instrument Serif for display headings (normal + italic)
- CSS variables --font-body and --font-display
- Remove hardcoded font-family from listening-room theme
- Self-hosted by Next.js, graceful system-font fallback"
```

---

## Task 2: Apply Display Font to Headings

**Quality Requirements:**
- Edge Cases: Pages with no headings unaffected, CardTitle still looks good
- AI Slop Watch: Only apply to true headings, not every bold text

**Files:**
- Modify: `apps/web/src/app/globals.css` (add heading base styles)

**Step 1: Add heading font styles to globals.css**

In the existing `@layer base` block (after the `body` styles), add:

```css
  /* Display font for headings */
  h1, h2, h3 {
    font-family: var(--font-display), 'Instrument Serif', Georgia, serif;
  }
  
  h1 {
    @apply text-3xl font-normal tracking-tight;
    letter-spacing: -0.02em;
  }
  
  h2 {
    @apply text-2xl font-normal tracking-tight;
    letter-spacing: -0.01em;
  }
```

Note: `font-normal` (400) is correct — Instrument Serif is designed to look elegant at regular weight. Don't use `font-bold` with serif display fonts.

**Step 2: Add `font-display` utility class**

In `@layer utilities` in globals.css, add:

```css
  .font-display {
    font-family: var(--font-display), 'Instrument Serif', Georgia, serif;
  }
```

This allows opt-in usage via `className="font-display"` on any element.

**Step 3: Verify**

Run: `cd apps/web && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

Visually: The sidebar "Mixarr" brand text, page headings, and card titles should now render in Instrument Serif. Body text renders in DM Sans.

**Step 4: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "style: apply Instrument Serif to h1/h2/h3 headings

- Serif display font for headings with negative letter-spacing
- font-display utility class for opt-in usage
- Body text unchanged (DM Sans via font-sans)"
```

---

## Task 3: Increase Border Radii

**Quality Requirements:**
- Edge Cases: Sidebar nav items use rounded-lg (8px) — don't over-round these
- AI Slop Watch: Don't create a complex token system, just update the CSS variable

**Files:**
- Modify: `apps/web/src/styles/themes/listening-room.css` (update --radius)
- Modify: `apps/web/tailwind.config.ts` (add card/button radius tokens)
- Modify: `apps/web/src/components/ui/card.tsx` (use new radius)
- Modify: `apps/web/src/components/ui/button.tsx` (use new radius)

**Step 1: Update the global --radius CSS variable**

In `apps/web/src/styles/themes/listening-room.css`, in ALL THREE `:root` blocks, change:

```css
/* FROM: */
--radius: 0.375rem; /* 6px */
/* TO: */
--radius: 0.625rem; /* 10px - base unit for derived radii */
```

**Step 2: Add radius tokens to Tailwind config**

In `apps/web/tailwind.config.ts`, add to `theme.extend`:

```typescript
borderRadius: {
  'card': '1.25rem',    // 20px - generous card rounding
  'button': '0.625rem', // 10px - pill-ish buttons
},
```

**Step 3: Update Card component**

In `apps/web/src/components/ui/card.tsx`, change the base Card class:

```tsx
// FROM:
'rounded-lg border bg-card text-card-foreground shadow-sm',
// TO:
'rounded-card border bg-card text-card-foreground shadow-sm',
```

**Step 4: Update Button component**

In `apps/web/src/components/ui/button.tsx`, change the base CVA class:

```tsx
// FROM:
'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors ...',
// TO:
'inline-flex items-center justify-center rounded-button text-sm font-medium transition-colors ...',
```

Also update the `sm` size variant:
```tsx
// FROM:
sm: 'h-9 rounded-md px-3',
// TO:
sm: 'h-9 rounded-button px-3',
```

**Step 5: Update globals.css button classes**

In `apps/web/src/app/globals.css`, update the `.btn` class:

```css
/* FROM: */
@apply inline-flex items-center justify-center rounded-md text-sm font-medium ...
/* TO: */
@apply inline-flex items-center justify-center rounded-button text-sm font-medium ...
```

And `.btn-sm`:
```css
/* FROM: */
@apply h-9 rounded-md px-3;
/* TO: */
@apply h-9 rounded-button px-3;
```

And `.card`:
```css
/* FROM: */
@apply rounded-lg border bg-card text-card-foreground shadow-sm;
/* TO: */
@apply rounded-card border bg-card text-card-foreground shadow-sm;
```

**Step 6: Run existing tests**

Run: `cd apps/web && npx vitest run 2>&1 | tail -10`
Expected: All existing component tests pass (they test behavior, not border-radius values).

**Step 7: Verify build**

Run: `cd apps/web && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

**Step 8: Commit**

```bash
git add apps/web/src/styles/themes/listening-room.css apps/web/tailwind.config.ts apps/web/src/components/ui/card.tsx apps/web/src/components/ui/button.tsx apps/web/src/app/globals.css
git commit -m "style: increase border radii for modern feel

- Cards: rounded-lg (8px) → rounded-card (20px)
- Buttons: rounded-md (6px) → rounded-button (10px)
- Base --radius: 6px → 10px
- Sidebar nav items unchanged (rounded-lg is appropriate there)"
```

---

## Task 4: Add Shadow Elevation System

**Quality Requirements:**
- Edge Cases: Dark mode shadows need to be darker to be visible against dark backgrounds
- AI Slop Watch: Don't add 10 shadow tiers, 4 is plenty

**Files:**
- Modify: `apps/web/tailwind.config.ts` (add shadow tokens)
- Modify: `apps/web/src/components/ui/card.tsx` (upgrade hover shadow)

**Step 1: Add shadow elevation tokens**

In `apps/web/tailwind.config.ts`, add to `theme.extend`:

```typescript
boxShadow: {
  // Elevation system
  'elevation-1': '0 2px 8px rgba(0, 0, 0, 0.06)',
  'elevation-2': '0 4px 16px rgba(0, 0, 0, 0.1)',
  'elevation-3': '0 8px 30px rgba(0, 0, 0, 0.14)',
  'elevation-4': '0 16px 48px rgba(0, 0, 0, 0.18)',
  // Glow variants using primary color (rust/copper hue 22)
  'glow-sm': '0 0 12px rgba(191, 122, 86, 0.2)',
  'glow-md': '0 4px 16px rgba(191, 122, 86, 0.3)',
  'glow-primary': '0 4px 20px rgba(191, 122, 86, 0.25), 0 0 0 1px rgba(191, 122, 86, 0.1)',
},
```

Note: Glow colors use the Listening Room copper `#bf7a56` (hsl 22 45% 54%), NOT the Wednesday green.

**Step 2: Update Card interactive hover**

In `apps/web/src/components/ui/card.tsx`, upgrade the interactive hover:

```tsx
// FROM:
interactive && 'transition-all duration-200 hover:border-primary hover:shadow-md motion-safe:hover:-translate-y-0.5 cursor-pointer',
// TO:
interactive && 'transition-all duration-300 hover:border-primary hover:shadow-elevation-3 motion-safe:hover:-translate-y-1 cursor-pointer',
```

Changes: `shadow-md` → `shadow-elevation-3` (more dramatic), `duration-200` → `duration-300` (smoother), `-translate-y-0.5` → `-translate-y-1` (more lift, still subtle).

**Step 3: Verify**

Run: `cd apps/web && npx vitest run 2>&1 | tail -10`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add apps/web/tailwind.config.ts apps/web/src/components/ui/card.tsx
git commit -m "style: add 4-tier shadow elevation + copper glow tokens

- elevation-1 through elevation-4 for layered depth
- glow-sm, glow-md, glow-primary using Listening Room copper
- Card interactive hover: deeper shadow + more lift"
```

---

## Task 5: Add Gradient & Glow to Primary Buttons

**Quality Requirements:**
- Edge Cases: isLoading state, disabled state, dark/light mode
- AI Slop Watch: The gradient must use the existing copper primary, not generic green

**Files:**
- Modify: `apps/web/src/components/ui/button.tsx` (add gradient variant)
- Modify: `apps/web/src/app/globals.css` (update .btn-primary)

**Step 1: Update the default button variant**

In `apps/web/src/components/ui/button.tsx`, update the `default` variant to use a gradient and transition:

```tsx
// FROM:
default: 'bg-primary text-primary-foreground hover:bg-primary/90',
// TO:
default: 'bg-primary text-primary-foreground shadow-sm hover:shadow-glow-sm hover:brightness-110 active:brightness-95 active:scale-[0.98]',
```

This adds:
- `hover:shadow-glow-sm` → subtle copper glow on hover
- `hover:brightness-110` → slightly lighter on hover (simulates gradient shift)
- `active:brightness-95 active:scale-[0.98]` → press feedback

**Step 2: Update globals.css .btn-primary**

In `apps/web/src/app/globals.css`, update the `.btn-primary` class to match:

```css
/* FROM: */
@apply btn bg-primary text-primary-foreground hover:bg-primary/90;
/* TO: */
@apply btn bg-primary text-primary-foreground shadow-sm hover:shadow-glow-sm hover:brightness-110 active:brightness-95 active:scale-[0.98];
```

**Step 3: Verify**

Run: `cd apps/web && npx vitest run 2>&1 | tail -10`
Expected: All tests pass. Button tests check behavior, not shadows.

**Step 4: Commit**

```bash
git add apps/web/src/components/ui/button.tsx apps/web/src/app/globals.css
git commit -m "style: add copper glow + press feedback to primary buttons

- Hover: subtle copper glow shadow + brightness boost
- Active: scale down 0.98 + darken for press feel
- Works in both light and dark mode"
```

---

## Task 6: Polish FeedCard with Theme Tokens

**Quality Requirements:**
- Edge Cases: Missing image, status overlays, mobile touch, dark/light mode
- AI Slop Watch: Don't rewrite the whole component — surgical CSS changes only

**Files:**
- Modify: `apps/web/src/components/feed/FeedCard.tsx` (replace hardcoded colors with theme tokens)

**Step 1: Update FeedCard styling**

Replace hardcoded gray/black classes with theme-aware tokens:

```tsx
// Container: FROM
'relative group rounded-lg overflow-hidden bg-gray-800 transition-all duration-300',
// TO
'relative group rounded-card overflow-hidden bg-card transition-all duration-300 hover:shadow-elevation-2',

// Image placeholder: FROM
'w-full h-full bg-gray-700 flex items-center justify-center'
// TO
'w-full h-full bg-muted flex items-center justify-center'

// Placeholder icon: FROM
'w-12 h-12 text-gray-500'
// TO
'w-12 h-12 text-muted-foreground'

// Action overlay: FROM
'absolute inset-0 bg-black/40 flex items-center justify-center gap-4 transition-opacity',
// TO
'absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center gap-4 transition-opacity',

// Approve button: FROM
'p-3 rounded-full bg-green-600 hover:bg-green-500 ...'
// TO
'p-3 rounded-full bg-status-success hover:brightness-110 ...'

// Dismiss button: FROM
'p-3 rounded-full bg-red-600 hover:bg-red-500 ...'
// TO
'p-3 rounded-full bg-status-error hover:brightness-110 ...'

// Artist name: FROM
'text-white font-medium truncate'
// TO
'text-card-foreground font-medium truncate'

// Tag text: FROM
'text-gray-300' and 'text-gray-400' and 'text-gray-500'
// TO
'text-foreground/80' and 'text-muted-foreground' and 'text-muted-foreground/60'

// Metadata line: FROM
'text-xs text-gray-400 truncate ...'
// TO
'text-xs text-muted-foreground truncate ...'
```

**Step 2: Run FeedCard tests**

Run: `cd apps/web && npx vitest run src/components/feed/FeedCard.test.tsx 2>&1`
Expected: All tests pass. Tests check for `data-testid` attributes and behavior, not specific color classes.

⚠️ **Quality Gate**: If any test checks for specific class names like `bg-gray-800`, update the test expectation. But based on the test file structure, they use `data-testid` and semantic assertions.

**Step 3: Commit**

```bash
git add apps/web/src/components/feed/FeedCard.tsx
git commit -m "style: migrate FeedCard from hardcoded colors to theme tokens

- bg-gray-800 → bg-card (respects light/dark)
- text-white → text-card-foreground
- bg-green-600/bg-red-600 → bg-status-success/bg-status-error
- Add rounded-card + hover:shadow-elevation-2
- Add backdrop-blur to action overlay"
```

---

## Task 7: Polish DashboardTiles with Theme Tokens

**Quality Requirements:**
- Edge Cases: Loading skeletons must also update, dark/light mode
- AI Slop Watch: Keep the existing gradient accent bars — they're already nice

**Files:**
- Modify: `apps/web/src/components/feed/DashboardTiles.tsx` (replace hardcoded colors)

**Step 1: Update StatTile styling**

```tsx
// Container: FROM
'group relative bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-3 transition-all duration-300 hover:translate-y-[-2px] hover:shadow-lg hover:shadow-black/20 hover:border-slate-600/50 overflow-hidden'
// TO
'group relative bg-card border border-border rounded-card px-4 py-3 transition-all duration-300 hover:translate-y-[-2px] hover:shadow-elevation-2 hover:border-primary/20 overflow-hidden'

// Value text: FROM
'text-2xl font-bold text-white'
// TO
'text-2xl font-bold text-card-foreground font-display'

// Label text: FROM
'text-xs text-gray-400 font-medium'
// TO
'text-xs text-muted-foreground font-medium'
```

**Step 2: Update StatTileSkeleton**

```tsx
// Container: FROM
'bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-3 animate-pulse'
// TO
'bg-card border border-border rounded-card px-4 py-3 animate-pulse'

// Skeleton blocks: FROM
'bg-slate-700/50'
// TO
'bg-muted'
```

**Step 3: Verify**

Run: `cd apps/web && npx vitest run 2>&1 | tail -10`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add apps/web/src/components/feed/DashboardTiles.tsx
git commit -m "style: migrate DashboardTiles from hardcoded slate to theme tokens

- bg-slate-800 → bg-card
- text-white → text-card-foreground
- Add font-display to stat values (Instrument Serif)
- Skeleton uses bg-muted
- Preserves gradient accent bars"
```

---

## Task 8: Final Verification

**Files:** None (verification only)

**Step 1: Run full frontend test suite**

Run: `cd apps/web && npx vitest run 2>&1 | tail -20`
Expected: All tests pass, no regressions.

**Step 2: Run typecheck**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | tail -10`
Expected: No type errors.

**Step 3: Run build**

Run: `cd apps/web && npx next build 2>&1 | tail -20`
Expected: Build succeeds. Note font file sizes in output (DM Sans + Instrument Serif should add ~50-80KB total, self-hosted).

**Step 4: Visual verification**

Run: `cd /home/chris/Github/mixarr && ./scripts/start-dev.sh`

Check these pages in the browser:
- Dashboard (`/`) — DashboardTiles should use serif font for numbers, cards have rounded corners + elevation
- Feed cards — themed colors, hover glow on overlay
- Search page — ArtistCard uses Card component (inherits new radius + hover)
- Settings — forms use new button radius + glow
- Light mode toggle — all changes work in both modes

**Step 5: Commit any remaining fixes**

If visual review reveals issues, fix and commit individually.

---

## Summary of All Changes

| File | Change |
|------|--------|
| `apps/web/src/app/layout.tsx` | Load DM Sans + Instrument Serif via next/font |
| `apps/web/tailwind.config.ts` | Add fontFamily, borderRadius, boxShadow tokens |
| `apps/web/src/styles/themes/listening-room.css` | Remove hardcoded font-family, update --radius |
| `apps/web/src/app/globals.css` | Heading font styles, updated btn/card classes |
| `apps/web/src/components/ui/card.tsx` | rounded-card, enhanced hover shadow |
| `apps/web/src/components/ui/button.tsx` | rounded-button, glow hover, press feedback |
| `apps/web/src/components/feed/FeedCard.tsx` | Theme tokens instead of hardcoded grays |
| `apps/web/src/components/feed/DashboardTiles.tsx` | Theme tokens, font-display on values |

**Total files modified:** 8
**New dependencies:** 0 (next/font/google is built into Next.js)
**Breaking changes:** 0
**Estimated time:** 2-3 hours
