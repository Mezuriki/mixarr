import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlskdService } from '../../src/services/slskd.js';

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('SlskdService', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('fetchWithTimeout', () => {
    it('should abort request after timeout period', async () => {
      const slskd = new SlskdService({ url: 'http://localhost:5030', apiKey: 'test-api-key' });
      
      // Mock fetch that respects the abort signal
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        return new Promise((_, reject) => {
          const signal = options?.signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }
        });
      });
      
      // Use real timers but short timeout
      const fetchPromise = slskd['fetchWithTimeout']('/api/test', {}, 50);
      
      await expect(fetchPromise).rejects.toThrow(/aborted/i);
    }, 10000);

    it('should complete normally if response arrives before timeout', async () => {
      const slskd = new SlskdService({ url: 'http://localhost:5030', apiKey: 'test-api-key' });
      
      // Mock successful fetch
      global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
      
      const result = await slskd['fetchWithTimeout']('/api/test', {}, 30000);
      
      expect(result.ok).toBe(true);
    });

    it('should clear timeout after successful response', async () => {
      const slskd = new SlskdService({ url: 'http://localhost:5030', apiKey: 'test-api-key' });
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      
      global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
      
      await slskd['fetchWithTimeout']('/api/test', {}, 30000);
      
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('constructor', () => {
    it('should create service instance with config', async () => {
      const { SlskdService } = await import('../../src/services/slskd.js');
      const service = new SlskdService({
        url: 'http://localhost:5030',
        apiKey: 'test-key',
      });
      expect(service).toBeDefined();
    });
  });

  describe('testConnection', () => {
    it('should return success for valid API key', async () => {
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          version: '0.24.1',
          versionCurrent: true,
        }),
      });

      const service = new SlskdService({
        url: 'http://localhost:5030',
        apiKey: 'valid-key',
      });
      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.version).toBe('0.24.1');
    });

    it('should return error for invalid API key', async () => {
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Unauthorized'),
      });

      const service = new SlskdService({
        url: 'http://localhost:5030',
        apiKey: 'invalid-key',
      });
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized');
    });

    it('should handle network errors', async () => {
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const service = new SlskdService({
        url: 'http://localhost:5030',
        apiKey: 'test-key',
      });
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });
  });

  describe('search', () => {
    it('should start a search and return search id', async () => {
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'search-123',
          searchText: 'Pink Floyd',
          state: 'InProgress',
        }),
      });

      const service = new SlskdService({
        url: 'http://localhost:5030',
        apiKey: 'valid-key',
      });
      const result = await service.search('Pink Floyd');

      expect(result.id).toBe('search-123');
      expect(result.searchText).toBe('Pink Floyd');
    });
  });

  describe('getSearchResults', () => {
    it('should return search results when complete', async () => {
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      const mockResults = {
        id: 'search-123',
        searchText: 'Pink Floyd',
        state: 'Completed',
        responses: [
          {
            username: 'user1',
            files: [
              { filename: '01 - Breathe.flac', size: 45000000 },
              { filename: '02 - On The Run.flac', size: 32000000 },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResults),
      });

      const service = new SlskdService({
        url: 'http://localhost:5030',
        apiKey: 'valid-key',
      });
      const result = await service.getSearchResults('search-123');

      expect(result.state).toBe('Completed');
      expect(result.responses).toHaveLength(1);
      expect(result.responses[0].username).toBe('user1');
    });
  });

  describe('queueDownload', () => {
    it('should queue files for download', async () => {
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const service = new SlskdService({
        url: 'http://localhost:5030',
        apiKey: 'valid-key',
      });

      await expect(
        service.queueDownload('user1', [
          { filename: '/path/to/file.flac', size: 45000000 },
        ])
      ).resolves.not.toThrow();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:5030/api/v0/transfers/downloads/user1',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('getDownloads', () => {
    it('should return current downloads', async () => {
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      const mockDownloads = [
        {
          username: 'user1',
          directories: [
            {
              directory: '/music/Pink Floyd',
              fileCount: 2,
              files: [
                { filename: '01 - Breathe.flac', state: 'Completed', size: 45000000 },
                { filename: '02 - On The Run.flac', state: 'InProgress', size: 32000000 },
              ],
            },
          ],
        },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDownloads),
      });

      const service = new SlskdService({
        url: 'http://localhost:5030',
        apiKey: 'valid-key',
      });
      const result = await service.getDownloads();

      expect(result).toHaveLength(1);
      expect(result[0].username).toBe('user1');
      expect(result[0].directories[0].files).toHaveLength(2);
    });
  });

  describe('searchWithPolling', () => {
    it('should poll until search completes then return results', async () => {
      const slskd = new SlskdService({ url: 'http://localhost:5030', apiKey: 'test-api-key' });
      
      let pollCount = 0;
      
      // Mock: search starts, polls 3 times, then completes
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = url.toString();
        
        if (urlStr.includes('/api/v0/searches') && !urlStr.match(/\/api\/v0\/searches\/[^/]+$/)) {
          // POST to start search
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 'search-123', state: 'Requested' }),
          });
        }
        if (urlStr.match(/\/api\/v0\/searches\/search-123/)) {
          // GET search status
          pollCount++;
          const state = pollCount >= 3 ? 'Completed' : 'InProgress';
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ 
              id: 'search-123', 
              state,
              fileCount: pollCount * 10,
              responseCount: pollCount * 2,
              responses: state === 'Completed' ? [{ username: 'peer1', files: [{ filename: 'song.mp3', size: 1000 }] }] : []
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      
      const progressUpdates: string[] = [];
      // Use short poll interval for test
      const result = await slskd.searchWithPolling('artist album', {
        onProgress: (status) => progressUpdates.push(status),
        pollIntervalMs: 10,  // Fast for tests
      });
      
      expect(pollCount).toBe(3);
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(result.responses).toHaveLength(1);
    });

    it('should timeout after max poll attempts', async () => {
      const slskd = new SlskdService({ url: 'http://localhost:5030', apiKey: 'test-api-key' });
      
      // Mock: search never completes
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = url.toString();
        
        if (urlStr.includes('/api/v0/searches') && !urlStr.match(/\/api\/v0\/searches\/[^/]+$/)) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 'search-123', state: 'Requested' }),
          });
        }
        // Always return InProgress
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ 
            id: 'search-123', 
            state: 'InProgress',
            fileCount: 0,
            responseCount: 0
          }),
        });
      });
      
      await expect(slskd.searchWithPolling('artist album', {
        pollIntervalMs: 10,
        maxPollAttempts: 5,
      })).rejects.toThrow(/timeout|max.*attempts/i);
    });

    it('should call onProgress callback with meaningful data', async () => {
      const slskd = new SlskdService({ url: 'http://localhost:5030', apiKey: 'test-api-key' });
      
      let pollCount = 0;
      
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = url.toString();
        
        if (urlStr.includes('/api/v0/searches') && !urlStr.match(/\/api\/v0\/searches\/[^/]+$/)) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 'search-456', state: 'Requested' }),
          });
        }
        if (urlStr.match(/\/api\/v0\/searches\/search-456/)) {
          pollCount++;
          const state = pollCount >= 2 ? 'Completed' : 'InProgress';
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ 
              id: 'search-456', 
              state,
              fileCount: pollCount * 5,
              responseCount: pollCount,
              responses: state === 'Completed' ? [{ username: 'peer1', files: [] }] : []
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      
      const progressUpdates: string[] = [];
      await slskd.searchWithPolling('test query', {
        onProgress: (status) => progressUpdates.push(status),
        pollIntervalMs: 10,
      });
      
      // Should have "Search started..." and at least one status update
      expect(progressUpdates[0]).toBe('Search started...');
      expect(progressUpdates.some(p => p.includes('files'))).toBe(true);
      expect(progressUpdates.some(p => p.includes('peers'))).toBe(true);
    });
  });
});
