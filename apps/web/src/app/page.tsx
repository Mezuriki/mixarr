'use client';

import { useEffect } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { StatsBar } from '@/components/feed/StatsBar';
import { FeedGrid } from '@/components/feed/FeedGrid';
import { useFeed } from '@/hooks/useFeed';

export default function Home() {
  const {
    items,
    stats,
    isLoading,
    loadingIds,
    hasMore,
    error,
    fetchFeed,
    loadMore,
    approve,
    dismiss,
  } = useFeed();

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  // Refresh on window focus
  useEffect(() => {
    const handleFocus = () => {
      fetchFeed();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchFeed]);

  if (error) {
    return (
      <>
        <PageHeader title="Discovery Feed" description="Review and approve artist recommendations" />
        <div className="text-center py-16">
          <p className="text-red-400 mb-4">Failed to load feed. Please try again.</p>
          <button
            onClick={fetchFeed}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Discovery Feed" description="Review and approve artist recommendations" />
      <StatsBar pending={stats.pending} addedToday={stats.addedToday} />
      <FeedGrid
        items={items}
        onApprove={approve}
        onDismiss={dismiss}
        onLoadMore={loadMore}
        hasMore={hasMore}
        isLoading={isLoading}
        loadingIds={loadingIds}
      />
    </>
  );
}
