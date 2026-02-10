/**
 * Connection Resolver Service Tests
 * 
 * Tests for the shared connection resolution helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma before importing the module
vi.mock('../../src/lib/db.js', () => ({
  default: {
    connection: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock service constructors - use class syntax for proper constructor behavior
vi.mock('../../src/services/lidarr.js', () => ({
  LidarrService: class MockLidarrService {
    constructor(public config: Record<string, unknown>) {}
  },
}));

vi.mock('../../src/services/lastfm.js', () => ({
  LastfmService: class MockLastfmService {
    constructor(public config: Record<string, unknown>) {}
  },
}));

// Import after mocks are set up
import prisma from '../../src/lib/db.js';
import { ConnectionResolver } from '../../src/lib/connection-resolver.js';

const mockPrisma = prisma as unknown as {
  connection: {
    findFirst: ReturnType<typeof vi.fn>;
  };
};

describe('ConnectionResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getConnection', () => {
    it('returns user-owned connection when available', async () => {
      const userConnection = {
        id: 1,
        userId: 123,
        type: 'lidarr',
        config: { url: 'http://lidarr:8686', apiKey: 'test-key' },
        isActive: true,
      };

      mockPrisma.connection.findFirst.mockResolvedValue(userConnection);

      const result = await ConnectionResolver.getConnection('lidarr', 123);

      expect(result).toEqual(userConnection);
      expect(mockPrisma.connection.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { userId: 123, type: 'lidarr', isActive: true },
            { userId: null, type: 'lidarr', isActive: true },
          ],
        },
        orderBy: { userId: 'desc' },
      });
    });

    it('returns global connection when user has none', async () => {
      const globalConnection = {
        id: 2,
        userId: null,
        type: 'lastfm',
        config: { apiKey: 'global-key' },
        isActive: true,
      };

      mockPrisma.connection.findFirst.mockResolvedValue(globalConnection);

      const result = await ConnectionResolver.getConnection('lastfm', 456);

      expect(result).toEqual(globalConnection);
    });

    it('returns null when no connection exists', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      const result = await ConnectionResolver.getConnection('spotify', 789);

      expect(result).toBeNull();
    });
  });

  describe('getLidarrService', () => {
    it('returns LidarrService instance when connection exists', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        type: 'lidarr',
        config: { url: 'http://lidarr:8686', apiKey: 'test' },
      });

      const result = await ConnectionResolver.getLidarrService(123);

      expect(result).not.toBeNull();
      expect(result?.constructor.name).toBe('MockLidarrService');
    });

    it('returns null when no lidarr connection', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      const result = await ConnectionResolver.getLidarrService(123);

      expect(result).toBeNull();
    });
  });

  describe('getLidarrServiceWithConfig', () => {
    it('returns service and normalized config', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        type: 'lidarr',
        config: {
          url: 'http://lidarr:8686',
          apiKey: 'test',
          qualityProfileId: '1', // String that should be normalized
          metadataProfileId: 2,
        },
      });

      const result = await ConnectionResolver.getLidarrServiceWithConfig(123);

      expect(result).not.toBeNull();
      expect(result?.service).toBeDefined();
      expect(result?.config.qualityProfileId).toBe(1); // Should be number
    });
  });

  describe('getLastfmService', () => {
    it('returns LastfmService instance when connection exists', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        type: 'lastfm',
        config: { apiKey: 'test-key' },
      });

      const result = await ConnectionResolver.getLastfmService(123);

      expect(result).not.toBeNull();
    });

    it('returns null when no lastfm connection', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      const result = await ConnectionResolver.getLastfmService(123);

      expect(result).toBeNull();
    });
  });
});
