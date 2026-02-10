import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useFeed, useApproveFeedItem, useDismissFeedItem } from '../hooks';

// Mock api module
vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '../api';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { 
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'TestQueryWrapper';
  return Wrapper;
};

describe('useFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches feed items', async () => {
    const mockResponse = {
      data: {
        items: [{ id: 'feed-1', artistName: 'Test Artist', artistMbid: null, imageUrl: null, score: 10, subscriptionCount: 1, sourceCount: 1, sources: ['spotify'], createdAt: '2026-01-01' }],
        stats: { pending: 5, addedToday: 2 },
        total: 1,
      },
      error: null,
      status: 200,
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.pages[0].items).toHaveLength(1);
    expect(result.current.data?.pages[0].stats.pending).toBe(5);
  });

  it('handles fetch error', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: null, error: 'Network error', status: 500 });

    const { result } = renderHook(() => useFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});

describe('useApproveFeedItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls approve endpoint', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { artistName: 'Test Artist' },
      error: null,
      status: 200,
    });

    const { result } = renderHook(() => useApproveFeedItem(), { wrapper: createWrapper() });

    await result.current.mutateAsync('feed-123');

    expect(api.post).toHaveBeenCalledWith('/api/feed/feed-123/approve');
  });

  it('throws on error', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: null,
      error: 'Failed to approve',
      status: 500,
    });

    const { result } = renderHook(() => useApproveFeedItem(), { wrapper: createWrapper() });

    await expect(result.current.mutateAsync('feed-123')).rejects.toThrow('Failed to approve');
  });
});

describe('useDismissFeedItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls dismiss endpoint', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { artistName: 'Test Artist' },
      error: null,
      status: 200,
    });

    const { result } = renderHook(() => useDismissFeedItem(), { wrapper: createWrapper() });

    await result.current.mutateAsync('feed-456');

    expect(api.post).toHaveBeenCalledWith('/api/feed/feed-456/dismiss');
  });

  it('throws on error', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: null,
      error: 'Dismiss failed',
      status: 500,
    });

    const { result } = renderHook(() => useDismissFeedItem(), { wrapper: createWrapper() });

    await expect(result.current.mutateAsync('feed-456')).rejects.toThrow('Dismiss failed');
  });
});
