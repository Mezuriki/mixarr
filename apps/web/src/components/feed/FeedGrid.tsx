'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { FeedCard } from './FeedCard';

export interface FeedItem {
  id: string;
  artistName: string;
  imageUrl: string | null;
  status?: 'pending' | 'added' | 'dismissed';
}

export interface FeedGridProps {
  items: FeedItem[];
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading?: boolean;
  loadingIds?: Set<string>;
}

export function FeedGrid({
  items,
  onApprove,
  onDismiss,
  onLoadMore,
  hasMore,
  isLoading = false,
  loadingIds = new Set(),
}: FeedGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    if (!hasMore || isLoading) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    const sentinel = sentinelRef.current;
    if (sentinel) {
      observer.observe(sentinel);
    }

    return () => {
      if (sentinel) {
        observer.unobserve(sentinel);
      }
      observer.disconnect();
    };
  }, [hasMore, isLoading, onLoadMore]);

  // Empty state
  if (items.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-gray-400 text-lg mb-4">No recommendations yet</p>
        <p className="text-gray-500 mb-6">Set up subscriptions to start discovering artists</p>
        <Link
          href="/subscriptions"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
        >
          Set Up Subscriptions
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Grid */}
      <div
        data-testid="feed-grid"
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
      >
        {items.map((item) => (
          <FeedCard
            key={item.id}
            id={item.id}
            artistName={item.artistName}
            imageUrl={item.imageUrl}
            status={item.status}
            isLoading={loadingIds.has(item.id)}
            onApprove={onApprove}
            onDismiss={onDismiss}
          />
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      {hasMore && (
        <div ref={sentinelRef} className="h-10 mt-4">
          {isLoading && (
            <div data-testid="loading-spinner" className="flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
