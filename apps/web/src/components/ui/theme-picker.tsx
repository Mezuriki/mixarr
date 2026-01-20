'use client';

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import Monitor from 'lucide-react/dist/esm/icons/monitor';
import Moon from 'lucide-react/dist/esm/icons/moon';
import Sun from 'lucide-react/dist/esm/icons/sun';
import { cn } from '@/lib/utils';

const themeOptions = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

export function ThemePicker() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1"
        aria-hidden="true"
      >
        {themeOptions.map((option) => (
          <div
            key={option.value}
            className="rounded-md p-1.5 w-8 h-8"
          />
        ))}
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme selection"
      className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1"
    >
      {themeOptions.map((option) => {
        const Icon = option.icon;
        const isActive = theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={`${option.label} theme`}
            onClick={() => setTheme(option.value)}
            className={cn(
              'rounded-md p-1.5 transition-all duration-200',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
