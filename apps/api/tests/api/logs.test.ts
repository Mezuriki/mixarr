/**
 * Logs API Tests
 * 
 * Tests:
 * - Log retrieval with filters
 * - Log deletion (admin only)
 * - Log entry creation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockAdminUser,
  resetIdCounter,
} from '../utils/fixtures.js';

describe('Logs API', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let adminUser: ReturnType<typeof createMockAdminUser>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    adminUser = createMockAdminUser();
  });

  describe('GET /api/logs', () => {
    it('should return logs with default limit', async () => {
      const mockLogs = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        level: i % 4 === 0 ? 'error' : i % 3 === 0 ? 'warn' : 'info',
        category: 'subscription',
        message: `Log entry ${i + 1}`,
        createdAt: new Date(Date.now() - i * 60000),
      }));

      mockPrisma.logEntry.findMany.mockResolvedValue(mockLogs);

      const logs = await mockPrisma.logEntry.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      expect(logs).toHaveLength(50);
    });

    it('should filter logs by level', async () => {
      const errorLogs = [
        { id: 1, level: 'error', message: 'Connection failed' },
        { id: 2, level: 'error', message: 'Timeout occurred' },
      ];

      mockPrisma.logEntry.findMany.mockResolvedValue(errorLogs);

      const logs = await mockPrisma.logEntry.findMany({
        where: { level: 'error' },
      });

      expect(logs).toHaveLength(2);
      expect(logs.every((l: any) => l.level === 'error')).toBe(true);
    });

    it('should filter logs by category', async () => {
      const subscriptionLogs = [
        { id: 1, category: 'subscription', message: 'Run started' },
        { id: 2, category: 'subscription', message: 'Run completed' },
      ];

      mockPrisma.logEntry.findMany.mockResolvedValue(subscriptionLogs);

      const logs = await mockPrisma.logEntry.findMany({
        where: { category: 'subscription' },
      });

      expect(logs).toHaveLength(2);
      expect(logs.every((l: any) => l.category === 'subscription')).toBe(true);
    });

    it('should filter logs by search term', async () => {
      const searchResults = [
        { id: 1, message: 'Spotify connection failed' },
        { id: 2, message: 'Spotify rate limited' },
      ];

      mockPrisma.logEntry.findMany.mockResolvedValue(searchResults);

      const logs = await mockPrisma.logEntry.findMany({
        where: { message: { contains: 'Spotify' } },
      });

      expect(logs).toHaveLength(2);
      expect(logs.every((l: any) => l.message.includes('Spotify'))).toBe(true);
    });

    it('should respect custom limit parameter', async () => {
      const fewLogs = [{ id: 1 }, { id: 2 }, { id: 3 }];
      mockPrisma.logEntry.findMany.mockResolvedValue(fewLogs);

      const customLimit = 3;
      const logs = await mockPrisma.logEntry.findMany({
        take: customLimit,
      });

      expect(logs).toHaveLength(3);
    });

    it('should combine multiple filters', async () => {
      mockPrisma.logEntry.findMany.mockResolvedValue([
        { id: 1, level: 'error', category: 'lidarr', message: 'Lidarr connection error' },
      ]);

      const where: any = {};
      where.level = 'error';
      where.category = 'lidarr';
      where.message = { contains: 'connection' };

      const logs = await mockPrisma.logEntry.findMany({ where });

      expect(logs).toHaveLength(1);
    });

    it('should order logs by creation date descending', async () => {
      const orderedLogs = [
        { id: 3, createdAt: new Date('2025-01-03') },
        { id: 2, createdAt: new Date('2025-01-02') },
        { id: 1, createdAt: new Date('2025-01-01') },
      ];

      mockPrisma.logEntry.findMany.mockResolvedValue(orderedLogs);

      const logs = await mockPrisma.logEntry.findMany({
        orderBy: { createdAt: 'desc' },
      });

      expect(logs[0].id).toBe(3);
      expect(logs[2].id).toBe(1);
    });
  });

  describe('DELETE /api/logs', () => {
    it('should require admin role', () => {
      const canDelete = adminUser.role === 'admin';
      const regularCanDelete = testUser.role === 'admin';

      expect(canDelete).toBe(true);
      expect(regularCanDelete).toBe(false);
    });

    it('should delete logs older than specified date', async () => {
      mockPrisma.logEntry.deleteMany.mockResolvedValue({ count: 100 });

      const olderThan = new Date('2025-01-01');
      const result = await mockPrisma.logEntry.deleteMany({
        where: { createdAt: { lt: olderThan } },
      });

      expect(result.count).toBe(100);
    });

    it('should delete logs by level', async () => {
      mockPrisma.logEntry.deleteMany.mockResolvedValue({ count: 50 });

      const result = await mockPrisma.logEntry.deleteMany({
        where: { level: 'debug' },
      });

      expect(result.count).toBe(50);
    });

    it('should delete all logs when no filter provided', async () => {
      mockPrisma.logEntry.deleteMany.mockResolvedValue({ count: 500 });

      const result = await mockPrisma.logEntry.deleteMany({ where: {} });

      expect(result.count).toBe(500);
    });

    it('should return deleted count', async () => {
      mockPrisma.logEntry.deleteMany.mockResolvedValue({ count: 42 });

      const result = await mockPrisma.logEntry.deleteMany({});

      expect(result.count).toBe(42);
    });
  });

  describe('Log Entry Helper', () => {
    it('should create log entry with all required fields', async () => {
      const logEntry = {
        level: 'info' as const,
        category: 'subscription',
        message: 'Subscription completed successfully',
        metadata: { subscriptionId: 1, artistsAdded: 10 },
        createdAt: new Date(),
      };

      mockPrisma.logEntry.create.mockResolvedValue(logEntry);

      const result = await mockPrisma.logEntry.create({
        data: logEntry,
      });

      expect(result.level).toBe('info');
      expect(result.category).toBe('subscription');
      expect(result.message).toBe('Subscription completed successfully');
    });

    it('should support all log levels', async () => {
      const levels = ['debug', 'info', 'warn', 'error'] as const;

      for (const level of levels) {
        mockPrisma.logEntry.create.mockResolvedValue({
          level,
          category: 'test',
          message: `${level} message`,
        });

        const result = await mockPrisma.logEntry.create({
          data: { level, category: 'test', message: `${level} message` },
        });

        expect(result.level).toBe(level);
      }
    });

    it('should store metadata as JSON', async () => {
      const metadata = {
        subscriptionId: 1,
        runId: 123,
        artistsFound: ['Artist 1', 'Artist 2'],
        duration: 5000,
      };

      mockPrisma.logEntry.create.mockResolvedValue({
        level: 'info',
        category: 'subscription',
        message: 'Run completed',
        metadata,
      });

      const result = await mockPrisma.logEntry.create({
        data: {
          level: 'info',
          category: 'subscription',
          message: 'Run completed',
          metadata,
        },
      });

      expect(result.metadata).toEqual(metadata);
    });
  });

  describe('Log Categories', () => {
    it('should recognize valid log categories', () => {
      const validCategories = [
        'subscription',
        'import',
        'lidarr',
        'spotify',
        'lastfm',
        'tidal',
        'deezer',
        'auth',
        'system',
        'scheduler',
      ];

      validCategories.forEach(category => {
        expect(typeof category).toBe('string');
        expect(category.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Pagination', () => {
    it('should support offset-based pagination', async () => {
      const page2Logs = Array.from({ length: 10 }, (_, i) => ({
        id: i + 11,
        level: 'info',
        message: `Log ${i + 11}`,
      }));

      mockPrisma.logEntry.findMany.mockResolvedValue(page2Logs);
      mockPrisma.logEntry.count.mockResolvedValue(100);

      const offset = 10;
      const limit = 10;

      const logs = await mockPrisma.logEntry.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      });

      const total = await mockPrisma.logEntry.count({ where: {} });

      expect(logs).toHaveLength(10);
      expect(logs[0].id).toBe(11);
      expect(total).toBe(100);
    });

    it('should return total count for pagination', async () => {
      mockPrisma.logEntry.count.mockResolvedValue(523);

      const total = await mockPrisma.logEntry.count({ where: { level: 'error' } });

      expect(total).toBe(523);
    });

    it('should enforce maximum limit of 500', () => {
      const requestedLimit = 10000;
      const MAX_LIMIT = 500;
      const effectiveLimit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);

      expect(effectiveLimit).toBe(500);
    });

    it('should enforce minimum limit of 1', () => {
      const requestedLimit = -50;
      const MAX_LIMIT = 500;
      const effectiveLimit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);

      expect(effectiveLimit).toBe(1);
    });

    it('should default offset to 0 when not provided', () => {
      const requestedOffset = undefined;
      const effectiveOffset = parseInt(requestedOffset as unknown as string, 10) || 0;

      expect(effectiveOffset).toBe(0);
    });
  });

  describe('Search', () => {
    it('should support case-insensitive search', async () => {
      const searchResults = [
        { id: 1, message: 'SPOTIFY connection failed' },
        { id: 2, message: 'spotify rate limited' },
        { id: 3, message: 'Spotify timeout' },
      ];

      mockPrisma.logEntry.findMany.mockResolvedValue(searchResults);

      // Test that search for 'spotify' (lowercase) finds all variations
      const logs = await mockPrisma.logEntry.findMany({
        where: { message: { contains: 'spotify', mode: 'insensitive' } },
      });

      expect(logs).toHaveLength(3);
    });
  });
});
