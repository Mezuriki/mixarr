'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/components/ui/toast';
import type { FeedItem, FeedStats } from '@/lib/hooks';

// Re-export types for consumers
export type { FeedItem, FeedStats } from '@/lib/hooks';

export interface UseFeedResult {
  items: FeedItem[];
  stats: FeedStats;
  total: number;
  isLoading: boolean;
  loadingIds: Set<string>;
  hasMore: boolean;
  error: Error | null;
  fetchFeed: () => Promise<void>;
  loadMore: () => Promise<void>;
  approve: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
}

const LIMIT = 50;

export function useFeed(): UseFeedResult {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [stats, setStats] = useState<FeedStats>({ pending: 0, addedToday: 0 });
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<Error | null>(null);
  const { addToast } = useToast();

  const hasMore = offset + items.length < total;

  const fetchFeed = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/feed?limit=${LIMIT}&offset=0`);
      if (!res.ok) throw new Error('Failed to fetch feed');
      const data = await res.json();
      setItems(data.items);
      setStats(data.stats);
      setTotal(data.total);
      setOffset(0);
    } catch (e) {
      setError(e as Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
    try {
      const newOffset = offset + LIMIT;
      const res = await fetch(`/api/feed?limit=${LIMIT}&offset=${newOffset}`);
      if (!res.ok) throw new Error('Failed to load more');
      const data = await res.json();
      setItems((prev) => [...prev, ...data.items]);
      setOffset(newOffset);
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to load more items' });
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, hasMore, offset, addToast]);

  const approve = useCallback(
    async (id: string) => {
      setLoadingIds((prev) => new Set(prev).add(id));
      try {
        const res = await fetch(`/api/feed/${id}/approve`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to approve');
        const data = await res.json();

        // Optimistic update
        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, status: 'added' as const } : item))
        );
        setStats((prev) => ({
          pending: prev.pending - 1,
          addedToday: prev.addedToday + 1,
        }));

        addToast({ type: 'success', title: 'Added', message: `${data.artistName} added to Lidarr` });

        // Remove after animation
        setTimeout(() => {
          setItems((prev) => prev.filter((item) => item.id !== id));
        }, 500);
      } catch {
        addToast({ type: 'error', title: 'Error', message: 'Failed to add artist' });
      } finally {
        setLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [addToast]
  );

  const dismiss = useCallback(
    async (id: string) => {
      setLoadingIds((prev) => new Set(prev).add(id));
      try {
        const res = await fetch(`/api/feed/${id}/dismiss`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to dismiss');
        const data = await res.json();

        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, status: 'dismissed' as const } : item))
        );
        setStats((prev) => ({ ...prev, pending: prev.pending - 1 }));

        addToast({ type: 'info', title: 'Dismissed', message: `${data.artistName} dismissed` });

        setTimeout(() => {
          setItems((prev) => prev.filter((item) => item.id !== id));
        }, 500);
      } catch {
        addToast({ type: 'error', title: 'Error', message: 'Failed to dismiss artist' });
      } finally {
        setLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [addToast]
  );

  return {
    items,
    stats,
    total,
    isLoading,
    loadingIds,
    hasMore,
    error,
    fetchFeed,
    loadMore,
    approve,
    dismiss,
  };
}
