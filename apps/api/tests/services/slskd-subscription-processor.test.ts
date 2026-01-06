import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock functions at module level
const mockSearch = vi.fn();
const mockGetSearchResults = vi.fn();
const mockQueueDownload = vi.fn();
const mockConnectionFindFirst = vi.fn();
const mockSlskdDownloadCreate = vi.fn();

// Mock the database
vi.mock('../../src/lib/db.js', () => ({
  prisma: {
    connection: {
      findFirst: mockConnectionFindFirst,
    },
    slskdDownload: {
      create: mockSlskdDownloadCreate,
    },
  },
}));

// Mock SlskdService
vi.mock('../../src/services/slskd.js', () => ({
  SlskdService: class MockSlskdService {
    search = mockSearch;
    getSearchResults = mockGetSearchResults;
    queueDownload = mockQueueDownload;
  },
}));

// Mock logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock sleep for testing
vi.mock('../../src/services/slskd-subscription-processor.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/slskd-subscription-processor.js')>();
  return {
    ...mod,
    // Speed up tests by reducing delay
    SEARCH_DELAY_MS: 10,
  };
});

describe('SlskdSubscriptionProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create processor with slskd service', async () => {
      const { SlskdSubscriptionProcessor } = await import('../../src/services/slskd-subscription-processor.js');
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      const slskdService = new SlskdService({ url: 'http://localhost:5030', apiKey: 'test' });
      const processor = new SlskdSubscriptionProcessor(slskdService);
      
      expect(processor).toBeDefined();
    });
  });

  describe('scoreResult', () => {
    it('should prefer FLAC over MP3', async () => {
      const { SlskdSubscriptionProcessor } = await import('../../src/services/slskd-subscription-processor.js');
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      const slskdService = new SlskdService({ url: 'http://localhost:5030', apiKey: 'test' });
      const processor = new SlskdSubscriptionProcessor(slskdService);
      
      const flacResult = {
        username: 'user1',
        files: [
          { filename: 'track1.flac', size: 50000000 },
          { filename: 'track2.flac', size: 50000000 },
        ],
        uploadSpeed: 100000,
        hasFreeUploadSlot: true,
      };
      
      const mp3Result = {
        username: 'user2',
        files: [
          { filename: 'track1.mp3', size: 10000000 },
          { filename: 'track2.mp3', size: 10000000 },
        ],
        uploadSpeed: 100000,
        hasFreeUploadSlot: true,
      };
      
      const flacScore = processor.scoreResult(flacResult, { preferLossless: true });
      const mp3Score = processor.scoreResult(mp3Result, { preferLossless: true });
      
      expect(flacScore).toBeGreaterThan(mp3Score);
    });

    it('should factor in upload speed', async () => {
      const { SlskdSubscriptionProcessor } = await import('../../src/services/slskd-subscription-processor.js');
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      const slskdService = new SlskdService({ url: 'http://localhost:5030', apiKey: 'test' });
      const processor = new SlskdSubscriptionProcessor(slskdService);
      
      const fastResult = {
        username: 'user1',
        files: [{ filename: 'track.flac', size: 50000000 }],
        uploadSpeed: 1000000,
        hasFreeUploadSlot: true,
      };
      
      const slowResult = {
        username: 'user2',
        files: [{ filename: 'track.flac', size: 50000000 }],
        uploadSpeed: 10000,
        hasFreeUploadSlot: true,
      };
      
      const fastScore = processor.scoreResult(fastResult, { preferLossless: true });
      const slowScore = processor.scoreResult(slowResult, { preferLossless: true });
      
      expect(fastScore).toBeGreaterThan(slowScore);
    });
  });

  describe('selectBestResult', () => {
    it('should pick highest scored result', async () => {
      const { SlskdSubscriptionProcessor } = await import('../../src/services/slskd-subscription-processor.js');
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      const slskdService = new SlskdService({ url: 'http://localhost:5030', apiKey: 'test' });
      const processor = new SlskdSubscriptionProcessor(slskdService);
      
      const results = [
        {
          username: 'user1',
          files: [{ filename: 'track.mp3', size: 10000000 }],
          uploadSpeed: 10000,
          hasFreeUploadSlot: false,
        },
        {
          username: 'user2',
          files: [{ filename: 'track.flac', size: 50000000 }],
          uploadSpeed: 1000000,
          hasFreeUploadSlot: true,
        },
        {
          username: 'user3',
          files: [{ filename: 'track.mp3', size: 10000000 }],
          uploadSpeed: 50000,
          hasFreeUploadSlot: true,
        },
      ];
      
      const best = processor.selectBestResult(results, { preferLossless: true });
      
      expect(best?.username).toBe('user2');
    });

    it('should return null for empty results', async () => {
      const { SlskdSubscriptionProcessor } = await import('../../src/services/slskd-subscription-processor.js');
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      const slskdService = new SlskdService({ url: 'http://localhost:5030', apiKey: 'test' });
      const processor = new SlskdSubscriptionProcessor(slskdService);
      
      const best = processor.selectBestResult([], { preferLossless: true });
      
      expect(best).toBeNull();
    });
  });

  describe('processArtist', () => {
    it('should search and queue download for good result', async () => {
      const { SlskdSubscriptionProcessor } = await import('../../src/services/slskd-subscription-processor.js');
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      const slskdService = new SlskdService({ url: 'http://localhost:5030', apiKey: 'test' });
      const processor = new SlskdSubscriptionProcessor(slskdService);
      
      // Mock search flow
      mockSearch.mockResolvedValue({ id: 'search-1', state: 'Requested' });
      mockGetSearchResults.mockResolvedValue({
        id: 'search-1',
        state: 'Completed',
        responses: [
          {
            username: 'user1',
            files: [
              { filename: 'Pink Floyd - DSOTM/01 - Breathe.flac', size: 50000000 },
              { filename: 'Pink Floyd - DSOTM/02 - On the Run.flac', size: 40000000 },
            ],
            uploadSpeed: 1000000,
            hasFreeUploadSlot: true,
          },
        ],
      });
      mockQueueDownload.mockResolvedValue(undefined);
      mockSlskdDownloadCreate.mockResolvedValue({ id: 1 });
      
      const result = await processor.processArtist(
        { name: 'Pink Floyd' },
        { 
          connectionId: 1, 
          userId: 1,
          preferences: { preferLossless: true },
        }
      );
      
      expect(result.status).toBe('queued');
      expect(mockSearch).toHaveBeenCalledWith('Pink Floyd', expect.anything());
      expect(mockQueueDownload).toHaveBeenCalled();
    });

    it('should return not_found when no results', async () => {
      const { SlskdSubscriptionProcessor } = await import('../../src/services/slskd-subscription-processor.js');
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      const slskdService = new SlskdService({ url: 'http://localhost:5030', apiKey: 'test' });
      const processor = new SlskdSubscriptionProcessor(slskdService);
      
      mockSearch.mockResolvedValue({ id: 'search-1', state: 'Requested' });
      mockGetSearchResults.mockResolvedValue({
        id: 'search-1',
        state: 'Completed',
        responses: [],
      });
      
      const result = await processor.processArtist(
        { name: 'Unknown Artist' },
        { 
          connectionId: 1, 
          userId: 1,
          preferences: { preferLossless: true },
        }
      );
      
      expect(result.status).toBe('not_found');
      expect(mockQueueDownload).not.toHaveBeenCalled();
    });

    it('should handle search timeout gracefully', async () => {
      const { SlskdSubscriptionProcessor } = await import('../../src/services/slskd-subscription-processor.js');
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      const slskdService = new SlskdService({ url: 'http://localhost:5030', apiKey: 'test' });
      const processor = new SlskdSubscriptionProcessor(slskdService);
      
      mockSearch.mockResolvedValue({ id: 'search-1', state: 'Requested' });
      mockGetSearchResults.mockResolvedValue({
        id: 'search-1',
        state: 'TimedOut',
        responses: [],
      });
      
      const result = await processor.processArtist(
        { name: 'Pink Floyd' },
        { 
          connectionId: 1, 
          userId: 1,
          preferences: { preferLossless: true },
        }
      );
      
      expect(result.status).toBe('failed');
      expect(result.error).toContain('timeout');
    });
  });
});
