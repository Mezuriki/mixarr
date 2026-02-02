import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFeed } from './useFeed';

// Mock the toast context
const mockAddToast = vi.fn();
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns empty items and default stats', () => {
      const { result } = renderHook(() => useFeed());

      expect(result.current.items).toEqual([]);
      expect(result.current.stats).toEqual({ pending: 0, addedToday: 0 });
      expect(result.current.total).toBe(0);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.hasMore).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('has loadingIds as empty Set', () => {
      const { result } = renderHook(() => useFeed());

      expect(result.current.loadingIds).toBeInstanceOf(Set);
      expect(result.current.loadingIds.size).toBe(0);
    });
  });

  describe('fetchFeed', () => {
    it('fetches feed items on mount when called', async () => {
      const mockData = {
        items: [
          { id: 'feed-1', artistName: 'Artist 1', imageUrl: null, score: 10 },
          { id: 'feed-2', artistName: 'Artist 2', imageUrl: 'http://img.jpg', score: 8 },
        ],
        stats: { pending: 5, addedToday: 3 },
        total: 100,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const { result } = renderHook(() => useFeed());

      await act(async () => {
        await result.current.fetchFeed();
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/feed?limit=50&offset=0');
      expect(result.current.items).toEqual(mockData.items);
      expect(result.current.stats).toEqual(mockData.stats);
      expect(result.current.total).toBe(100);
    });

    it('sets isLoading while fetching', async () => {
      let resolvePromise: (value: unknown) => void;
      const fetchPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      mockFetch.mockReturnValueOnce(fetchPromise);

      const { result } = renderHook(() => useFeed());

      // Start fetch but don't await
      act(() => {
        result.current.fetchFeed();
      });

      // Check loading state
      await waitFor(() => {
        expect(result.current.isLoading).toBe(true);
      });

      // Resolve the fetch
      await act(async () => {
        resolvePromise!({
          ok: true,
          json: () => Promise.resolve({ items: [], stats: { pending: 0, addedToday: 0 }, total: 0 }),
        });
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('sets error on fetch failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
      });

      const { result } = renderHook(() => useFeed());

      await act(async () => {
        await result.current.fetchFeed();
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Failed to fetch feed');
    });
  });

  describe('loadMore', () => {
    it('appends items when loading more', async () => {
      // Initial fetch
      const initialData = {
        items: [{ id: 'feed-1', artistName: 'Artist 1', imageUrl: null }],
        stats: { pending: 5, addedToday: 3 },
        total: 100,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(initialData),
      });

      const { result } = renderHook(() => useFeed());

      await act(async () => {
        await result.current.fetchFeed();
      });

      expect(result.current.items).toHaveLength(1);
      expect(result.current.hasMore).toBe(true);

      // Load more
      const moreData = {
        items: [{ id: 'feed-2', artistName: 'Artist 2', imageUrl: null }],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(moreData),
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(mockFetch).toHaveBeenLastCalledWith('/api/feed?limit=50&offset=50');
      expect(result.current.items).toHaveLength(2);
    });

    it('does not load more when already loading', async () => {
      const initialData = {
        items: [],
        stats: { pending: 0, addedToday: 0 },
        total: 100,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(initialData),
      });

      const { result } = renderHook(() => useFeed());

      await act(async () => {
        await result.current.fetchFeed();
      });

      // Start a load that takes time
      let resolveLoadMore: (value: unknown) => void;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveLoadMore = resolve;
        })
      );

      act(() => {
        result.current.loadMore();
      });

      // Try to load more while first one is in progress
      await act(async () => {
        await result.current.loadMore();
      });

      // Should only have been called twice (initial + first loadMore)
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Cleanup
      await act(async () => {
        resolveLoadMore!({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
        });
      });
    });
  });

  describe('approve', () => {
    it('updates item status to added optimistically', async () => {
      const initialData = {
        items: [{ id: 'feed-1', artistName: 'Test Artist', imageUrl: null }],
        stats: { pending: 5, addedToday: 3 },
        total: 5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(initialData),
      });

      const { result } = renderHook(() => useFeed());

      await act(async () => {
        await result.current.fetchFeed();
      });

      // Mock approve response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ artistName: 'Test Artist' }),
      });

      await act(async () => {
        await result.current.approve('feed-1');
      });

      expect(mockFetch).toHaveBeenLastCalledWith('/api/feed/feed-1/approve', { method: 'POST' });
      expect(mockAddToast).toHaveBeenCalledWith({
        type: 'success',
        title: 'Added',
        message: 'Test Artist added to Lidarr',
      });
    });

    it('shows error toast on approve failure', async () => {
      const initialData = {
        items: [{ id: 'feed-1', artistName: 'Test Artist', imageUrl: null }],
        stats: { pending: 5, addedToday: 3 },
        total: 5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(initialData),
      });

      const { result } = renderHook(() => useFeed());

      await act(async () => {
        await result.current.fetchFeed();
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
      });

      await act(async () => {
        await result.current.approve('feed-1');
      });

      expect(mockAddToast).toHaveBeenCalledWith({
        type: 'error',
        title: 'Error',
        message: 'Failed to add artist',
      });
    });
  });

  describe('dismiss', () => {
    it('updates item status to dismissed', async () => {
      const initialData = {
        items: [{ id: 'feed-1', artistName: 'Test Artist', imageUrl: null }],
        stats: { pending: 5, addedToday: 3 },
        total: 5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(initialData),
      });

      const { result } = renderHook(() => useFeed());

      await act(async () => {
        await result.current.fetchFeed();
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ artistName: 'Test Artist' }),
      });

      await act(async () => {
        await result.current.dismiss('feed-1');
      });

      expect(mockFetch).toHaveBeenLastCalledWith('/api/feed/feed-1/dismiss', { method: 'POST' });
      expect(mockAddToast).toHaveBeenCalledWith({
        type: 'info',
        title: 'Dismissed',
        message: 'Test Artist dismissed',
      });
    });
  });
});
