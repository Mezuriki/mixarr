'use client';

import { useState, useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import { Palette, Check } from 'lucide-react';
import { themes } from '@/lib/themes';
import { cn } from '@/lib/utils';

export function ThemePicker() {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  if (!mounted) {
    return (
      <button className="rounded-lg p-2 hover:bg-accent transition-colors" disabled>
        <Palette className="h-5 w-5" />
      </button>
    );
  }

  const handleThemeSelect = (themeId: string) => {
    setTheme(themeId);
    setIsOpen(false);
  };

  // Get current theme for potential future use (e.g., showing current theme indicator)
  const _currentTheme = themes.find(t => t.id === theme) || themes[0];
  void _currentTheme; // Suppress unused variable warning

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button - icon only, no text */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center justify-center rounded-lg p-2 transition-all duration-200',
          'hover:bg-accent hover:text-accent-foreground',
          isOpen && 'bg-accent text-accent-foreground'
        )}
        aria-label="Choose theme"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Palette className="h-5 w-5" />
      </button>

      {/* Dropdown menu - opens downward since picker is in header */}
      {isOpen && (
        <div
          className="theme-picker-dropdown absolute top-full left-0 mt-2 w-56 max-h-80 overflow-y-auto rounded-lg border p-1 shadow-lg z-50 animate-in fade-in-0 slide-in-from-top-2 duration-100"
          style={{ 
            backgroundColor: 'var(--theme-picker-bg, hsl(var(--popover)))',
            color: 'var(--theme-picker-text, hsl(var(--popover-foreground)))',
            borderColor: 'hsl(var(--border))'
          }}
          role="menu"
          aria-label="Theme options"
        >
          {themes.map((t) => {
            const isActive = theme === t.id;
            
            return (
              <button
                key={t.id}
                onClick={() => handleThemeSelect(t.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm',
                  'transition-colors duration-100',
                  'hover:bg-accent hover:text-accent-foreground',
                  isActive && 'bg-accent/50'
                )}
                role="menuitem"
              >
                {/* Color indicator */}
                <div
                  className="h-4 w-4 rounded-full border border-border flex-shrink-0"
                  style={{ background: t.colors.primary }}
                />
                {/* Theme name and description */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {t.description}
                  </div>
                </div>
                {/* Active check */}
                {isActive && (
                  <Check className="h-4 w-4 text-primary flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
