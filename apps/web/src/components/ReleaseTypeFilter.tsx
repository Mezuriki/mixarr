'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

const RELEASE_TYPES = [
  'Album',
  'EP',
  'Single',
  'Compilation',
  'Soundtrack',
  'Live',
  'Remix',
] as const;

const DEFAULT_SELECTED = ['Album', 'EP'];

const STORAGE_KEY = 'releaseTypeFilter';

export interface ReleaseTypeFilterProps {
  value: string[];
  onChange: (types: string[]) => void;
  className?: string;
}

export function ReleaseTypeFilter({ value, onChange, className }: ReleaseTypeFilterProps) {
  const handleToggle = (type: string) => {
    const newValue = value.includes(type)
      ? value.filter((t) => t !== type)
      : [...value, type];
    onChange(newValue);
    saveToStorage(newValue);
  };

  const handleSelectAll = () => {
    const allTypes = [...RELEASE_TYPES];
    onChange(allTypes);
    saveToStorage(allTypes);
  };

  const handleClear = () => {
    onChange([]);
    saveToStorage([]);
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Release Types</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSelectAll}
            className="text-xs text-primary hover:text-primary/80 transition-colors"
          >
            Select All
          </button>
          <span className="text-muted-foreground">|</span>
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-primary hover:text-primary/80 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {RELEASE_TYPES.map((type) => {
          const isSelected = value.includes(type);
          return (
            <label
              key={type}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 rounded-md border cursor-pointer transition-colors text-sm',
                isSelected
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-foreground border-input hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => handleToggle(type)}
                className="sr-only"
              />
              {type}
            </label>
          );
        })}
      </div>
    </div>
  );
}

// Utility functions for localStorage persistence
function saveToStorage(types: string[]): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(types));
  }
}

export function loadReleaseTypeFilter(): string[] {
  if (typeof window === 'undefined') {
    return DEFAULT_SELECTED;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.filter((t) => RELEASE_TYPES.includes(t as typeof RELEASE_TYPES[number]));
      }
    }
  } catch {
    // Invalid JSON, return default
  }
  return DEFAULT_SELECTED;
}

// Hook for easy integration with state management
export function useReleaseTypeFilter() {
  const [types, setTypes] = React.useState<string[]>(DEFAULT_SELECTED);

  React.useEffect(() => {
    setTypes(loadReleaseTypeFilter());
  }, []);

  return { types, setTypes };
}

export { RELEASE_TYPES, DEFAULT_SELECTED };
