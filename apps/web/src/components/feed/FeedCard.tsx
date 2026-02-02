'use client';

import { useState } from 'react';
import Image from 'next/image';
import Check from 'lucide-react/dist/esm/icons/check';
import X from 'lucide-react/dist/esm/icons/x';
import Music from 'lucide-react/dist/esm/icons/music';
import { cn } from '@/lib/utils';

export interface FeedCardProps {
  id: string;
  artistName: string;
  imageUrl: string | null;
  status?: 'pending' | 'added' | 'dismissed';
  isLoading?: boolean;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function FeedCard({
  id,
  artistName,
  imageUrl,
  status = 'pending',
  isLoading = false,
  onApprove,
  onDismiss,
}: FeedCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isTouched, setIsTouched] = useState(false);

  const showOverlay = status === 'added' || status === 'dismissed';
  const overlayText = status === 'added' ? 'Added' : status === 'dismissed' ? 'Dismissed' : '';

  return (
    <div
      className={cn(
        'relative group rounded-lg overflow-hidden bg-gray-800 transition-all duration-300',
        showOverlay && 'opacity-50 scale-95'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onTouchStart={() => setIsTouched(true)}
      onTouchEnd={() => setTimeout(() => setIsTouched(false), 3000)}
    >
      {/* Image */}
      <div className="aspect-square relative">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={artistName}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
        ) : (
          <div
            data-testid="image-placeholder"
            className="w-full h-full bg-gray-700 flex items-center justify-center"
          >
            <Music className="w-12 h-12 text-gray-500" aria-hidden="true" />
          </div>
        )}

        {/* Status overlay (Added/Dismissed) */}
        {showOverlay && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-white font-semibold text-lg">{overlayText}</span>
          </div>
        )}

        {/* Action buttons */}
        {!showOverlay && (
          <div
            className={cn(
              'absolute inset-0 bg-black/40 flex items-center justify-center gap-4 transition-opacity',
              isHovered || isTouched || isLoading ? 'opacity-100' : 'opacity-0'
            )}
          >
            <button
              type="button"
              aria-label="Add to Lidarr"
              disabled={isLoading}
              onClick={() => onApprove(id)}
              className="p-3 rounded-full bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Check className="w-6 h-6 text-white" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              disabled={isLoading}
              onClick={() => onDismiss(id)}
              className="p-3 rounded-full bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <X className="w-6 h-6 text-white" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Artist name */}
      <div className="p-3">
        <p className="text-white font-medium truncate" title={artistName}>
          {artistName}
        </p>
      </div>
    </div>
  );
}
