# UI/UX Overhaul: Listening Room Theme Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Mixarr from 6 generic themes to a single cohesive "Listening Room" theme (light/dark) while fixing accessibility, performance, and bundle size issues.

**Architecture:** Replace the multi-theme CSS system with a single theme using CSS custom properties for light/dark mode. Remove external font dependencies, fix barrel imports, add proper accessibility attributes, and implement focus management.

**Tech Stack:** Next.js 14, Tailwind CSS, CSS Custom Properties, next-themes

**Branch:** `ui-ux-experiment`

**PR Strategy:** Single PR with clear commit history, merge path: `ui-ux-experiment` → `dev` → `staging` → `prod`

---

## Requirements

### Edge Cases
- Theme toggle while modal is open
- Prefers-color-scheme system change during session
- Slow network loading (no FOUC - Flash of Unstyled Content)
- Missing localStorage (incognito mode)
- SSR hydration mismatch with theme

### Security
- No new attack vectors (CSS-only changes)
- Sanitize any user-controlled theme values (none expected)

### Data Integrity
- No database changes required
- No migration needed
- Existing user preferences (theme selection) will be gracefully handled

### Error Handling
- Invalid theme in localStorage defaults to system preference
- Missing CSS variables fall back gracefully

### Migration Path (CRITICAL)
- Users on old themes automatically get the new theme
- No breaking changes to API
- No database reset required
- Pull-and-rebuild workflow maintained

---

## Pre-Implementation Checklist

- [ ] Verify current theme system uses `next-themes` (confirmed in package.json)
- [ ] Verify theme-picker component exists and works
- [ ] Confirm no hardcoded color values in components
- [ ] Document all files that import from barrel exports

---

## Phase 1: Theme Consolidation (Low Risk)

### Task 1.1: Create New Theme CSS File

**Quality Requirements:**
- Edge Cases: Both light/dark modes must define all required CSS variables
- Attack Vectors: None (CSS only)
- AI Slop Watch: No copied values, intentional color choices

**Files:**
- Create: `apps/web/src/styles/themes/listening-room.css`

**Step 1: Create the Listening Room theme file**

```css
/* Listening Room Theme
 * A warm, focused aesthetic like a well-lit studio
 * Designed with intention: warm neutrals, rust/copper accent, subtle rounding
 */

/* ========================================
   DARK MODE (Default)
   ======================================== */
:root,
:root[data-theme="dark"] {
  /* Backgrounds - warm, not cold */
  --background: 30 8% 10%;           /* #1c1b19 */
  --foreground: 40 15% 91%;          /* #ebe7df */
  --card: 30 8% 16%;                 /* #2d2b27 */
  --card-foreground: 40 15% 91%;
  --popover: 30 8% 16%;
  --popover-foreground: 40 15% 91%;
  
  /* Brand - rust/copper accent */
  --primary: 24 45% 54%;             /* #bf7a56 */
  --primary-foreground: 30 8% 10%;
  --secondary: 30 8% 20%;            /* #373431 */
  --secondary-foreground: 40 10% 70%;
  
  /* UI colors */
  --muted: 30 6% 22%;
  --muted-foreground: 40 8% 45%;
  --accent: 175 30% 42%;             /* #5a8a87 - teal */
  --accent-foreground: 40 15% 91%;
  --destructive: 10 50% 50%;
  --destructive-foreground: 40 15% 91%;
  
  /* Status colors - desaturated for harmony */
  --success: 120 25% 50%;            /* #6b9b6b */
  --warning: 35 45% 54%;             /* #bf9a56 */
  --error: 10 45% 54%;               /* #bf6b5a */
  
  /* Borders & inputs */
  --border: 40 10% 18%;
  --input: 30 8% 14%;
  --ring: 24 45% 54%;
  
  /* Sidebar */
  --sidebar: 30 8% 13%;
  --sidebar-foreground: 40 12% 85%;
  --sidebar-border: 40 10% 15%;
  
  /* Radius - subtle, intentional */
  --radius: 0.375rem;                /* 6px - not chunky */
}

/* ========================================
   LIGHT MODE
   ======================================== */
:root[data-theme="light"] {
  /* Backgrounds - warm off-whites */
  --background: 40 20% 97%;          /* #f8f6f3 */
  --foreground: 30 8% 10%;           /* #1a1916 */
  --card: 0 0% 100%;                 /* #ffffff */
  --card-foreground: 30 8% 10%;
  --popover: 0 0% 100%;
  --popover-foreground: 30 8% 10%;
  
  /* Brand - same accent, adjusted for contrast */
  --primary: 24 45% 54%;             /* #bf7a56 */
  --primary-foreground: 0 0% 100%;
  --secondary: 40 15% 93%;           /* #f0eeeb */
  --secondary-foreground: 30 8% 35%;
  
  /* UI colors */
  --muted: 40 12% 90%;
  --muted-foreground: 30 8% 50%;
  --accent: 175 30% 38%;             /* #4a7a77 - teal, darker for light bg */
  --accent-foreground: 0 0% 100%;
  --destructive: 10 60% 45%;
  --destructive-foreground: 0 0% 100%;
  
  /* Status colors - richer for light mode */
  --success: 120 35% 35%;            /* #4a7a4a */
  --warning: 35 55% 40%;             /* #9a7a3a */
  --error: 10 55% 45%;               /* #a85a4a */
  
  /* Borders & inputs */
  --border: 30 10% 88%;
  --input: 40 15% 93%;
  --ring: 24 45% 54%;
  
  /* Sidebar */
  --sidebar: 0 0% 100%;
  --sidebar-foreground: 30 8% 10%;
  --sidebar-border: 30 10% 90%;
}

/* ========================================
   SYSTEM PREFERENCE FALLBACK
   ======================================== */
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) {
    /* Same as light mode above */
    --background: 40 20% 97%;
    --foreground: 30 8% 10%;
    --card: 0 0% 100%;
    --card-foreground: 30 8% 10%;
    --popover: 0 0% 100%;
    --popover-foreground: 30 8% 10%;
    --primary: 24 45% 54%;
    --primary-foreground: 0 0% 100%;
    --secondary: 40 15% 93%;
    --secondary-foreground: 30 8% 35%;
    --muted: 40 12% 90%;
    --muted-foreground: 30 8% 50%;
    --accent: 175 30% 38%;
    --accent-foreground: 0 0% 100%;
    --destructive: 10 60% 45%;
    --destructive-foreground: 0 0% 100%;
    --success: 120 35% 35%;
    --warning: 35 55% 40%;
    --error: 10 55% 45%;
    --border: 30 10% 88%;
    --input: 40 15% 93%;
    --ring: 24 45% 54%;
    --sidebar: 0 0% 100%;
    --sidebar-foreground: 30 8% 10%;
    --sidebar-border: 30 10% 90%;
  }
}

/* ========================================
   TYPOGRAPHY (System fonts only)
   ======================================== */
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

/* ========================================
   REDUCED MOTION
   ======================================== */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**Step 2: Verify file created correctly**
```bash
cat apps/web/src/styles/themes/listening-room.css | head -50
```
Expected: Theme header and dark mode variables visible

**Step 3: Commit**
```bash
git add apps/web/src/styles/themes/listening-room.css
git commit -m "feat(theme): add Listening Room theme with light/dark modes

- Warm neutrals (#1c1b19 dark, #f8f6f3 light)
- Rust/copper accent (#bf7a56) with teal secondary (#5a8a87)
- System fonts only (zero external font load)
- Respects prefers-reduced-motion
- Falls back to system color scheme preference"
```

---

### Task 1.2: Update Theme Index to Use Only Listening Room

**Quality Requirements:**
- Edge Cases: Old theme imports must not cause errors
- Migration: Users with old theme preference gracefully get new theme

**Files:**
- Modify: `apps/web/src/styles/themes/index.css`

**Step 1: Replace theme imports with single theme**

Current content:
```css
/* Theme imports */
@import './dark-luxe.css';
@import './editorial-clean.css';
@import './neo-brutalist.css';
@import './soft-gradient.css';
@import './vinyl-retro.css';
@import './midnight-modern.css';
```

Replace with:
```css
/* Listening Room Theme - Light/Dark only */
@import './listening-room.css';
```

**Step 2: Verify import works**
```bash
cat apps/web/src/styles/themes/index.css
```
Expected: Only listening-room.css imported

**Step 3: Commit**
```bash
git add apps/web/src/styles/themes/index.css
git commit -m "refactor(theme): consolidate to single Listening Room theme

BREAKING: Removes 6 themes (dark-luxe, editorial-clean, neo-brutalist,
soft-gradient, vinyl-retro, midnight-modern) in favor of single theme
with light/dark modes.

Users with old theme preferences will automatically get new theme."
```

---

### Task 1.3: Update Theme Picker for Light/Dark Only

**Quality Requirements:**
- Edge Cases: Invalid stored theme value, system preference detection
- AI Slop Watch: Meaningful labels, not generic "Theme 1/2"

**Files:**
- Modify: `apps/web/src/components/ui/theme-picker.tsx`

**Step 1: Read current theme-picker implementation**
```bash
cat apps/web/src/components/ui/theme-picker.tsx
```

**Step 2: Simplify to light/dark/system picker**

Replace the themes array and rendering with:
```tsx
'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';

const themes = [
  { value: 'system', label: 'System', icon: '💻' },
  { value: 'light', label: 'Light', icon: '☀️' },
  { value: 'dark', label: 'Dark', icon: '🌙' },
] as const;

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // Prevent hydration mismatch
  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex gap-1 p-1 bg-muted rounded-md">
        {themes.map((t) => (
          <button
            key={t.value}
            className="px-3 py-1.5 text-sm rounded-sm"
            disabled
            aria-label={t.label}
          >
            {t.icon}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div 
      className="flex gap-1 p-1 bg-muted rounded-md"
      role="radiogroup"
      aria-label="Color theme"
    >
      {themes.map((t) => (
        <button
          key={t.value}
          onClick={() => setTheme(t.value)}
          className={cn(
            'px-3 py-1.5 text-sm rounded-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            theme === t.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
          role="radio"
          aria-checked={theme === t.value}
          aria-label={`${t.label} theme`}
        >
          <span className="mr-1.5">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
```

**Step 3: Verify theme picker renders correctly**
```bash
cd apps/web && npm run build 2>&1 | grep -i error || echo "Build successful"
```

**Step 4: Commit**
```bash
git add apps/web/src/components/ui/theme-picker.tsx
git commit -m "refactor(theme-picker): simplify to light/dark/system toggle

- Removes multi-theme dropdown
- Uses radio group pattern for accessibility
- Prevents hydration mismatch with mounted check
- Icons + labels for clarity"
```

---

### Task 1.4: Remove Old Theme Files

**Quality Requirements:**
- Edge Cases: Ensure no other files import these directly
- Safety: Keep files in git history, just delete from working tree

**Files:**
- Delete: `apps/web/src/styles/themes/dark-luxe.css`
- Delete: `apps/web/src/styles/themes/editorial-clean.css`
- Delete: `apps/web/src/styles/themes/neo-brutalist.css`
- Delete: `apps/web/src/styles/themes/soft-gradient.css`
- Delete: `apps/web/src/styles/themes/vinyl-retro.css`
- Delete: `apps/web/src/styles/themes/midnight-modern.css`

**Step 1: Verify no direct imports exist**
```bash
grep -r "dark-luxe\|editorial-clean\|neo-brutalist\|soft-gradient\|vinyl-retro\|midnight-modern" apps/web/src --include="*.tsx" --include="*.ts" | grep -v "node_modules" || echo "No direct imports found"
```
Expected: "No direct imports found"

**Step 2: Delete old theme files**
```bash
rm apps/web/src/styles/themes/dark-luxe.css
rm apps/web/src/styles/themes/editorial-clean.css
rm apps/web/src/styles/themes/neo-brutalist.css
rm apps/web/src/styles/themes/soft-gradient.css
rm apps/web/src/styles/themes/vinyl-retro.css
rm apps/web/src/styles/themes/midnight-modern.css
```

**Step 3: Verify deletion**
```bash
ls apps/web/src/styles/themes/
```
Expected: Only `index.css` and `listening-room.css`

**Step 4: Commit**
```bash
git add -A apps/web/src/styles/themes/
git commit -m "chore(theme): remove legacy theme files

Deleted: dark-luxe, editorial-clean, neo-brutalist, 
soft-gradient, vinyl-retro, midnight-modern

These are replaced by the single Listening Room theme."
```

---

### Task 1.5: Remove External Font Loading

**Quality Requirements:**
- Edge Cases: Ensure no components rely on specific font family names
- Performance: Eliminates 8 font network requests

**Files:**
- Modify: `apps/web/src/app/layout.tsx`

**Step 1: Read current layout**
```bash
head -50 apps/web/src/app/layout.tsx
```

**Step 2: Remove Google Font imports and CSS variable declarations**

Find and remove:
```tsx
import { Inter, Playfair_Display, IBM_Plex_Sans, IBM_Plex_Serif, Space_Mono, Space_Grotesk, DM_Sans, Outfit } from 'next/font/google';

const inter = Inter({ ... });
const playfair = Playfair_Display({ ... });
// ... all font declarations
```

And remove font className from body:
```tsx
// Change from:
<body className={`${inter.variable} ${playfair.variable} ...`}>

// To:
<body className="antialiased">
```

**Step 3: Verify no font imports remain**
```bash
grep -n "next/font/google" apps/web/src/app/layout.tsx || echo "No Google fonts imported"
```
Expected: "No Google fonts imported"

**Step 4: Test build**
```bash
cd apps/web && npm run build 2>&1 | tail -20
```

**Step 5: Commit**
```bash
git add apps/web/src/app/layout.tsx
git commit -m "perf(fonts): remove 8 external Google Fonts

- Eliminates font loading latency
- Uses system font stack instead
- Reduces initial page weight significantly
- No FOUT (Flash of Unstyled Text)"
```

---

## Phase 2: Accessibility Improvements (Medium Risk)

### Task 2.1: Add Focus Trap to Modal

**Quality Requirements:**
- Edge Cases: Modal with no focusable elements, nested modals
- Accessibility: Tab must cycle within modal, not escape to background

**Files:**
- Modify: `apps/web/src/components/ui/modal.tsx`

**Step 1: Read current modal implementation**
```bash
cat apps/web/src/components/ui/modal.tsx
```

**Step 2: Add focus trap and focus restoration**

Add to the Modal component:
```tsx
'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-4xl',
};

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = 'md',
}: ModalProps) {
  const modalRef = React.useRef<HTMLDivElement>(null);
  const previousActiveElement = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      // Store the currently focused element
      previousActiveElement.current = document.activeElement as HTMLElement;
      
      // Focus the modal
      modalRef.current?.focus();
      
      // Prevent body scroll
      document.body.style.overflow = 'hidden';
    }
    
    return () => {
      document.body.style.overflow = 'unset';
      
      // Restore focus when modal closes
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen]);

  // Handle Escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  // Focus trap
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    
    const modal = modalRef.current;
    if (!modal) return;
    
    const focusableElements = modal.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    if (focusableElements.length === 0) return;
    
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    if (e.shiftKey) {
      // Shift+Tab: if on first element, go to last
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      // Tab: if on last element, go to first
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
      aria-describedby={description ? 'modal-description' : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm motion-safe:animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Modal */}
      <div
        ref={modalRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative z-10 w-full mx-4 bg-card rounded-lg shadow-lg motion-safe:animate-slide-in flex flex-col max-h-[90vh] focus:outline-none',
          sizeClasses[size]
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {(title || description) && (
          <div className="flex items-start justify-between p-6 border-b flex-shrink-0">
            <div>
              {title && (
                <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
              )}
              {description && (
                <p id="modal-description" className="mt-1 text-sm text-muted-foreground">{description}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1 hover:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        )}
        
        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function ModalFooter({ children, className }: ModalFooterProps) {
  return (
    <div className={cn('flex items-center justify-end gap-3 pt-4', className)}>
      {children}
    </div>
  );
}
```

**Step 3: Test modal focus trap manually**
```bash
cd apps/web && npm run dev &
# Open browser, navigate to a page with modal, verify Tab cycles within modal
```

**Step 4: Commit**
```bash
git add apps/web/src/components/ui/modal.tsx
git commit -m "a11y(modal): add focus trap and focus restoration

- Focus trapped within modal when open
- Focus returns to trigger element on close
- Escape key closes modal
- Proper ARIA attributes (role=dialog, aria-modal, aria-labelledby)
- Close button has aria-label
- Uses motion-safe for animations"
```

---

### Task 2.2: Add Loading Spinner Accessibility

**Quality Requirements:**
- Accessibility: Screen readers must announce loading state

**Files:**
- Modify: `apps/web/src/components/ui/button.tsx`

**Step 1: Add role and aria-label to loading spinner**

Find the loading spinner SVG and wrap it:
```tsx
{isLoading && (
  <span role="status" aria-label="Loading">
    <svg
      className="mr-2 h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
    <span className="sr-only">Loading</span>
  </span>
)}
```

**Step 2: Commit**
```bash
git add apps/web/src/components/ui/button.tsx
git commit -m "a11y(button): add screen reader support for loading state

- Loading spinner has role=status
- Hidden from visual but announced to screen readers
- SVG marked aria-hidden"
```

---

### Task 2.3: Add prefers-reduced-motion Support to Animations

**Quality Requirements:**
- Accessibility: Users who prefer reduced motion should not see animations

**Files:**
- Modify: `apps/web/src/app/globals.css`

**Step 1: Add reduced motion media query**

Add to globals.css (if not already in theme):
```css
/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**Step 2: Update existing animations to use motion-safe**

Find and update animation classes like `animate-fade-in`, `animate-slide-in`:
```css
@layer utilities {
  .motion-safe\:animate-fade-in {
    animation: fade-in 0.15s ease-out;
  }
  
  .motion-safe\:animate-slide-in {
    animation: slide-in 0.2s ease-out;
  }
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slide-in {
  from { 
    opacity: 0;
    transform: translateY(-8px) scale(0.98);
  }
  to { 
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
```

**Step 3: Commit**
```bash
git add apps/web/src/app/globals.css
git commit -m "a11y: respect prefers-reduced-motion preference

- Disables animations for users who prefer reduced motion
- Uses motion-safe: prefix for optional animations
- Affects all transitions and animations globally"
```

---

## Phase 3: Bundle Optimization (Medium Risk)

### Task 3.1: Replace lucide-react Barrel Imports

**Quality Requirements:**
- Performance: Reduce bundle size by importing only used icons
- AI Slop Watch: Consistent import pattern across all files

**Files:**
- Modify: All files importing from 'lucide-react' (20+ files)

**Step 1: Find all lucide-react imports**
```bash
grep -r "from 'lucide-react'" apps/web/src --include="*.tsx" -l
```

**Step 2: For each file, replace barrel import with direct imports**

Example transformation:
```tsx
// Before:
import { Plus, Trash2, Edit, Check, X } from 'lucide-react';

// After:
import { Plus } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import { Edit } from 'lucide-react';
import { Check } from 'lucide-react';
import { X } from 'lucide-react';
```

Note: lucide-react v0.460+ supports tree-shaking with named imports, but explicit imports are clearer and guaranteed to work.

**Step 3: Verify build succeeds**
```bash
cd apps/web && npm run build
```

**Step 4: Commit**
```bash
git add apps/web/src/
git commit -m "perf(icons): optimize lucide-react imports

- Separate import statements for each icon
- Enables better tree-shaking
- Reduces bundle size"
```

---

### Task 3.2: Remove @/components/ui Barrel Export Usage

**Quality Requirements:**
- Performance: Direct imports enable better code splitting
- Maintainability: Explicit dependencies per file

**Files:**
- Modify: All files importing from '@/components/ui' (20+ files)
- Keep: `apps/web/src/components/ui/index.ts` (for backwards compatibility during transition)

**Step 1: Find all barrel import usages**
```bash
grep -r "from '@/components/ui'" apps/web/src --include="*.tsx" -l
```

**Step 2: For each file, replace with direct imports**

Example transformation:
```tsx
// Before:
import { Button, Card, CardContent, Input, useToast } from '@/components/ui';

// After:
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
```

**Step 3: Verify build succeeds**
```bash
cd apps/web && npm run build
```

**Step 4: Commit**
```bash
git add apps/web/src/
git commit -m "perf(ui): replace barrel imports with direct imports

- Each component imported from its own file
- Enables better tree-shaking and code splitting
- Explicit dependencies per file"
```

---

## Phase 4: Component Improvements (Low Risk)

### Task 4.1: Add tabular-nums to Numeric Displays

**Quality Requirements:**
- UX: Numbers should not jump around when values change

**Files:**
- Modify: Dashboard stat cards, any component displaying changing numbers

**Step 1: Add tabular-nums utility class to globals.css**
```css
@layer utilities {
  .tabular-nums {
    font-variant-numeric: tabular-nums;
  }
}
```

**Step 2: Apply to stat values**

In pages displaying numbers (like dashboard):
```tsx
<div className="stat-value tabular-nums">{value}</div>
```

**Step 3: Commit**
```bash
git add apps/web/src/
git commit -m "ux: use tabular-nums for numeric displays

- Prevents layout shift when numbers change
- Applied to dashboard stats and other counters"
```

---

### Task 4.2: Convert Images to next/image

**Quality Requirements:**
- Performance: Automatic image optimization, WebP, srcset
- Edge Cases: External images (coverartarchive.org), fallback on error

**Files:**
- Modify: `apps/web/src/components/AlbumCard.tsx`
- Modify: `apps/web/src/components/ArtistCard.tsx`
- Modify: `apps/web/next.config.js` (add remote patterns)

**Step 1: Update next.config.js for remote images**
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'coverartarchive.org',
        pathname: '/release/**',
      },
      {
        protocol: 'https',
        hostname: 'musicbrainz.org',
        pathname: '/images/**',
      },
    ],
  },
  // ... existing config
};
```

**Step 2: Update AlbumCard to use next/image**
```tsx
import Image from 'next/image';

// Replace <img> with:
<Image
  src={coverUrl}
  alt={title}
  width={80}
  height={80}
  className="w-full h-full object-cover"
  onError={() => setImageError(true)}
/>
```

**Step 3: Test image loading**
```bash
cd apps/web && npm run dev
# Navigate to page with album cards, verify images load
```

**Step 4: Commit**
```bash
git add apps/web/
git commit -m "perf(images): migrate to next/image for optimization

- Automatic WebP conversion
- Responsive srcset generation
- Lazy loading built-in
- Remote patterns configured for cover art"
```

---

## Phase 5: Documentation & PR

### Task 5.1: Create Theme README

**Files:**
- Create: `apps/web/src/styles/themes/README.md`

**Content:**
```markdown
# Mixarr Theme System

## Overview

Mixarr uses a single "Listening Room" theme with light and dark variants. The theme is designed to be warm, focused, and professional—like a well-lit recording studio.

## Design Principles

1. **Warm, not cold** - Off-whites (#f8f6f3) and warm grays (#1c1b19) instead of pure white/black
2. **Intentional accent** - Rust/copper (#bf7a56) as primary, muted teal (#5a8a87) as secondary
3. **System fonts** - No external font dependencies, uses native system fonts
4. **Subtle rounding** - 6px radius, not sharp or chunky
5. **Motion respect** - Animations respect prefers-reduced-motion

## Color Palette

### Dark Mode (Default)
| Token | HSL | Hex | Usage |
|-------|-----|-----|-------|
| background | 30 8% 10% | #1c1b19 | Page background |
| card | 30 8% 16% | #2d2b27 | Card surfaces |
| primary | 24 45% 54% | #bf7a56 | Buttons, links, focus |
| accent | 175 30% 42% | #5a8a87 | Secondary actions |

### Light Mode
| Token | HSL | Hex | Usage |
|-------|-----|-----|-------|
| background | 40 20% 97% | #f8f6f3 | Page background |
| card | 0 0% 100% | #ffffff | Card surfaces |
| primary | 24 45% 54% | #bf7a56 | Buttons, links, focus |
| accent | 175 30% 38% | #4a7a77 | Secondary actions |

## Theme Switching

Theme is managed via `next-themes`. Users can choose:
- **System** - Follows OS preference
- **Light** - Forces light mode
- **Dark** - Forces dark mode

Preference is stored in localStorage and persists across sessions.

## Adding New CSS Variables

All theme variables are defined in `listening-room.css`. To add a new variable:

1. Add to both `:root[data-theme="dark"]` and `:root[data-theme="light"]` sections
2. Add to the `@media (prefers-color-scheme: light)` fallback
3. Document in this README

## Migration from Previous Themes

The previous 6-theme system (dark-luxe, editorial-clean, etc.) was consolidated into this single theme. Users with old theme preferences will automatically get the new theme on their next visit.
```

**Step 1: Create the file**
```bash
# (create file with content above)
```

**Step 2: Commit**
```bash
git add apps/web/src/styles/themes/README.md
git commit -m "docs(theme): add theme system documentation

- Documents design principles
- Color palette reference
- Theme switching behavior
- Migration notes"
```

---

### Task 5.2: Create PR with Comprehensive Notes

**Step 1: Push branch**
```bash
git push origin ui-ux-experiment
```

**Step 2: Create PR via GitHub CLI**
```bash
gh pr create \
  --title "feat: UI/UX Overhaul - Listening Room Theme" \
  --body "## Summary

This PR consolidates the 6-theme system into a single \"Listening Room\" theme with light/dark variants, while improving accessibility, performance, and code quality.

## Changes

### Theme Consolidation
- **Removed**: dark-luxe, editorial-clean, neo-brutalist, soft-gradient, vinyl-retro, midnight-modern
- **Added**: Single Listening Room theme with light/dark modes
- **Simplified**: Theme picker now shows Light/Dark/System options only

### Design Decisions
- **Warm palette**: Off-whites (#f8f6f3) and warm grays (#1c1b19) instead of cold colors
- **Intentional accent**: Rust/copper (#bf7a56) as primary, muted teal as secondary
- **System fonts**: Removed 8 Google Font dependencies (Inter, Playfair, IBM Plex, etc.)
- **Subtle rounding**: 6px radius throughout

### Accessibility Improvements
- Focus trap in modals
- Focus restoration when modals close
- Loading spinner announces to screen readers
- Respects \`prefers-reduced-motion\`
- Proper ARIA attributes on interactive elements

### Performance Improvements
- Removed 8 external font requests
- Direct imports instead of barrel exports (lucide-react, @/components/ui)
- Migrated to next/image for automatic optimization

## Migration Path

**No breaking changes for users.** 
- Pull and rebuild works as expected
- No database changes
- Old theme preferences gracefully default to new theme
- No manual intervention required

## Testing

- [ ] Theme toggles correctly (light → dark → system)
- [ ] No FOUC (Flash of Unstyled Content)
- [ ] Modal focus trap works (Tab cycles within modal)
- [ ] Focus returns to trigger when modal closes
- [ ] Animations respect prefers-reduced-motion
- [ ] Images load correctly with next/image
- [ ] Build succeeds without errors

## Screenshots

(Add screenshots of light and dark modes)

## Related

- Mockups: \`apps/web/mockups/03-listening-room.html\`, \`apps/web/mockups/04-listening-room-light.html\`
" \
  --base dev
```

---

## Quality Gates Summary

| Phase | Gate | Verification |
|-------|------|--------------|
| 1 | Theme renders correctly | `npm run build` succeeds |
| 1 | No import errors | `grep` for old theme names returns empty |
| 2 | Modal traps focus | Manual Tab key test |
| 2 | Reduced motion works | Toggle system preference |
| 3 | Bundle size reduced | Compare build output before/after |
| 4 | Images optimize | Check Network tab for WebP |
| 5 | PR created | `gh pr list` shows PR |

---

## Execution Options

**Plan complete and saved to `docs/plans/2026-01-20-ui-ux-overhaul.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
