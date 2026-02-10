import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';

// Mock Prisma
const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../src/lib/db.js', () => ({
  prisma: {
    slskdDownload: {
      findMany: mockFindMany,
      findUnique: mockFindUnique,
      update: mockUpdate,
      delete: mockDelete,
    },
    connection: {
      findFirst: vi.fn().mockResolvedValue({
        id: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test' },
      }),
    },
  },
  default: {
    slskdDownload: {
      findMany: mockFindMany,
      findUnique: mockFindUnique,
      update: mockUpdate,
      delete: mockDelete,
    },
    connection: {
      findFirst: vi.fn().mockResolvedValue({
        id: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test' },
      }),
    },
  },
}));

// Mock slskd service
vi.mock('../../src/services/slskd.js', () => ({
  SlskdService: class MockSlskdService {
    queueDownload = vi.fn().mockResolvedValue({});
  },
}));

// Mock settings
vi.mock('../../src/lib/settings.js', () => ({
  isSlskdRateLimitingEnabled: vi.fn().mockResolvedValue(false),
}));

// Mock queue operations
vi.mock('../../src/jobs/slskd-operations-queue.js', () => ({
  enqueueSlskdDownload: vi.fn().mockResolvedValue({
    waitUntilFinished: vi.fn().mockResolvedValue({}),
  }),
  SLSKD_QUEUE_NAME: 'slskd-operations',
}));

// Mock redis
vi.mock('../../src/lib/redis.js', () => ({
  createRedisConnection: vi.fn().mockReturnValue({
    duplicate: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      connect: vi.fn().mockResolvedValue({}),
    }),
  }),
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

// Mock auth middleware
vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// Create app with routes
async function createTestApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  
  const { default: slskdRoutes } = await import('../../src/routes/slskd.js');
  app.use('/api/slskd', slskdRoutes);
  
  return app;
}

describe('slskd Downloads API', () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/slskd/downloads', () => {
    it('should return all downloads when no status filter', async () => {
      const mockDownloads = [
        { id: 1, artistName: 'Pink Floyd', status: 'completed' },
        { id: 2, artistName: 'Led Zeppelin', status: 'failed' },
      ];
      mockFindMany.mockResolvedValue(mockDownloads);

      const response = await request(app).get('/api/slskd/downloads');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
    });

    it('should filter downloads by status', async () => {
      const mockDownloads = [
        { id: 2, artistName: 'Led Zeppelin', status: 'failed' },
      ];
      mockFindMany.mockResolvedValue(mockDownloads);

      const response = await request(app).get('/api/slskd/downloads?status=failed');

      expect(response.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'failed' }),
        })
      );
    });

    it('should filter downloads by multiple statuses', async () => {
      mockFindMany.mockResolvedValue([]);

      const response = await request(app).get('/api/slskd/downloads?status=pending,downloading');

      expect(response.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['pending', 'downloading'] },
          }),
        })
      );
    });
  });

  describe('POST /api/slskd/downloads/:id/retry', () => {
    it('should retry a failed download', async () => {
      const mockDownload = {
        id: 1,
        username: 'testuser',
        filename: '/music/album/track.flac',
        fileSize: 50000000,
        status: 'failed',
      };
      mockFindUnique.mockResolvedValue(mockDownload);
      mockUpdate.mockResolvedValue({ ...mockDownload, status: 'pending' });

      const response = await request(app).post('/api/slskd/downloads/1/retry');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({ status: 'pending', error: null }),
      });
    });

    it('should return 404 for non-existent download', async () => {
      mockFindUnique.mockResolvedValue(null);

      const response = await request(app).post('/api/slskd/downloads/999/retry');

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });

    it('should reject retry for non-failed download', async () => {
      const mockDownload = {
        id: 1,
        status: 'completed',
      };
      mockFindUnique.mockResolvedValue(mockDownload);

      const response = await request(app).post('/api/slskd/downloads/1/retry');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Only failed');
    });
  });

  describe('DELETE /api/slskd/downloads/:id', () => {
    it('should cancel a pending download', async () => {
      const mockDownload = {
        id: 1,
        status: 'pending',
      };
      mockFindUnique.mockResolvedValue(mockDownload);
      mockUpdate.mockResolvedValue({ ...mockDownload, status: 'cancelled' });

      const response = await request(app).delete('/api/slskd/downloads/1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should remove a completed/cancelled download record', async () => {
      const mockDownload = {
        id: 1,
        status: 'completed',
      };
      mockFindUnique.mockResolvedValue(mockDownload);
      mockDelete.mockResolvedValue(mockDownload);

      const response = await request(app).delete('/api/slskd/downloads/1?remove=true');

      expect(response.status).toBe(200);
      expect(mockDelete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('should return 404 for non-existent download', async () => {
      mockFindUnique.mockResolvedValue(null);

      const response = await request(app).delete('/api/slskd/downloads/999');

      expect(response.status).toBe(404);
    });
  });
});
