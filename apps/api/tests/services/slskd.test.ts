import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('SlskdService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
      });

      const service = new SlskdService({
        url: 'http://localhost:5030',
        apiKey: 'invalid-key',
      });
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
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
});
