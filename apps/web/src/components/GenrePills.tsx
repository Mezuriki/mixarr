'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface GenrePillsProps {
  genres: string[];
  maxDisplay?: number;
  size?: 'sm' | 'md';
  className?: string;
}

export function GenrePills({
  genres,
  maxDisplay = 3,
  size = 'sm',
  className,
}: GenrePillsProps) {
  if (!genres || genres.length === 0) {
    return null;
  }

  const displayedGenres = genres.slice(0, maxDisplay);
  const remainingCount = genres.length - maxDisplay;
  const remainingGenres = genres.slice(maxDisplay);

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {displayedGenres.map((genre) => (
        <span
          key={genre}
          title={genre}
          className={cn(
            'inline-flex items-center rounded-full',
            'bg-secondary text-secondary-foreground',
            'border border-border/50',
            'max-w-[120px] truncate',
            'transition-colors',
            sizeClasses[size]
          )}
        >
          {genre}
        </span>
      ))}
      {remainingCount > 0 && (
        <span
          title={remainingGenres.join(', ')}
          className={cn(
            'inline-flex items-center rounded-full cursor-default',
            'bg-muted text-muted-foreground',
            'border border-border/50',
            'transition-colors hover:bg-muted/80',
            sizeClasses[size]
          )}
        >
          +{remainingCount} more
        </span>
      )}
    </div>
  );
}
