# Mixarr Theme System

The Mixarr theme system provides a unified "Listening Room" aesthetic with light and dark mode support.

## Theme Files

```
themes/
├── index.css           # Theme imports (entry point)
├── listening-room.css  # Main theme with light/dark modes
└── README.md           # This file
```

## Color Palette

### "Listening Room" Theme

Inspired by warm, inviting spaces where music is meant to be enjoyed. Uses natural tones that complement album artwork without competing with it.

| Variable | Light Mode | Dark Mode | Purpose |
|----------|------------|-----------|---------|
| `--background` | `#f8f6f3` (warm white) | `#1c1b19` (warm black) | Page background |
| `--foreground` | `#1c1b19` | `#e8e6e3` | Primary text |
| `--primary` | `#bf7a56` (rust/copper) | `#bf7a56` | Accent buttons, links |
| `--secondary` | `#5a8a87` (muted teal) | `#5a8a87` | Secondary accents |
| `--muted` | `#e8e6e3` | `#2a2927` | Subtle backgrounds |
| `--card` | `#ffffff` | `#242321` | Card surfaces |

## Usage

### CSS Variables

All colors use CSS custom properties in HSL format:

```css
.my-component {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  border: 1px solid hsl(var(--border));
}
```

### Tailwind Classes

The theme integrates with Tailwind via the config:

```tsx
<div className="bg-background text-foreground">
  <button className="bg-primary text-primary-foreground">
    Click me
  </button>
</div>
```

### Theme Switching

The app uses `next-themes` for theme switching:

- **Light Mode**: `data-theme="light"` on `<html>`
- **Dark Mode**: `data-theme="dark"` on `<html>`
- **System**: Follows OS preference

The `ThemePicker` component provides a Light/Dark/System toggle.

## Accessibility

### Reduced Motion

The theme respects `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --transition-base: 0.01ms;
  }
}
```

### Color Contrast

All color combinations meet WCAG AA contrast requirements:
- Text on backgrounds: 4.5:1 minimum
- Large text/UI: 3:1 minimum

## Typography

The theme uses system fonts for optimal performance:

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
```

This eliminates external font requests and ensures consistent rendering across platforms.

## Design Principles

1. **Warmth over sterility**: Colors have warm undertones, avoiding clinical blue-grays
2. **Restraint**: Limited palette prevents visual noise
3. **Music-first**: UI recedes to let album art and content shine
4. **Accessibility**: High contrast, motion preferences respected
5. **Performance**: System fonts, CSS variables, no external dependencies
