/**
 * slskd API Routes Tests
 * 
 * Tests:
 * - Search: Start searches, get results, delete searches
 * - Downloads: Queue downloads, get tracked downloads
 * - Connection validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock the rate limiter
vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

// Helper to create a mock fetch response
function mockFetchResponse(data: unknown, ok = true, status = 200): Partial<Response> {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe('slskd API Routes', () => {
  let app: express.Express;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockPrisma: {
    connection: {
      findFirst: ReturnType<typeof vi.fn>;
    };
    slskdDownload: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    vi.resetModules();
    
    // Setup mock fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    
    // Setup mock prisma
    mockPrisma = {
      connection: {
        findFirst: vi.fn(),
      },
      slskdDownload: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    
    // Mock the database module
    vi.doMock('../../src/lib/db.js', () => ({
      prisma: mockPrisma,
      default: mockPrisma,
    }));
    
    // Mock auth middleware to skip auth
    vi.doMock('../../src/middleware/auth.js', () => ({
      requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
        (_req as any).user = { id: 1, username: 'testuser', role: 'user' };
        next();
      },
    }));
    
    app = express();
    app.use(express.json());
    
    const { default: slskdRouter } = await import('../../src/routes/slskd.js');
    app.use('/api/slskd', slskdRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe('POST /api/slskd/search', () => {
    it('should start a search with valid connection', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test-key' },
      });

      mockFetch.mockResolvedValue(mockFetchResponse({
        id: 'search-123',
        searchText: 'Pink Floyd',
        state: 'InProgress',
      }));

      const response = await request(app)
        .post('/api/slskd/search')
        .send({ query: 'Pink Floyd' });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('search-123');
      expect(response.body.searchText).toBe('Pink Floyd');
    });

    it('should return 400 when no slskd connection exists', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/slskd/search')
        .send({ query: 'Pink Floyd' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No slskd connection configured');
    });

    it('should return 400 when query is missing', async () => {
      const response = await request(app)
        .post('/api/slskd/search')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Query is required');
    });

    it('should pass search options to slskd', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test-key' },
      });

      mockFetch.mockResolvedValue(mockFetchResponse({
        id: 'search-456',
        searchText: 'Tool',
        state: 'InProgress',
      }));

      const response = await request(app)
        .post('/api/slskd/search')
        .send({ 
          query: 'Tool', 
          options: { 
            filterResponses: true,
            minimumPeerUploadSpeed: 1000,
          } 
        });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalled();
      
      // Verify fetch was called with correct options
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.searchText).toBe('Tool');
      expect(body.filterResponses).toBe(true);
      expect(body.minimumPeerUploadSpeed).toBe(1000);
    });
  });

  describe('GET /api/slskd/search/:id', () => {
    it('should return search results', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test-key' },
      });

      mockFetch.mockResolvedValue(mockFetchResponse({
        id: 'search-123',
        searchText: 'Pink Floyd',
        state: 'Completed',
        responses: [
          {
            username: 'user1',
            files: [{ filename: 'song.flac', size: 50000000 }],
          },
        ],
      }));

      const response = await request(app)
        .get('/api/slskd/search/search-123');

      expect(response.status).toBe(200);
      expect(response.body.state).toBe('Completed');
      expect(response.body.responses).toHaveLength(1);
    });

    it('should return 400 when no slskd connection exists', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/slskd/search/search-123');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No slskd connection configured');
    });
  });

  describe('DELETE /api/slskd/search/:id', () => {
    it('should delete a search', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test-key' },
      });

      // DELETE typically returns empty or no-content
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      });

      const response = await request(app)
        .delete('/api/slskd/search/search-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/slskd/download', () => {
    it('should queue files for download', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test-key' },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 201,
        statusText: 'Created',
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      });

      mockPrisma.slskdDownload.create.mockImplementation((args: { data: Record<string, unknown> }) => 
        Promise.resolve({
          id: 1,
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      );

      const response = await request(app)
        .post('/api/slskd/download')
        .send({
          username: 'soulseekuser',
          files: [
            { filename: '/music/Pink Floyd/DSOTM/01-track.flac', size: 50000000 },
          ],
          artistName: 'Pink Floyd',
          albumName: 'Dark Side of the Moon',
          albumYear: 1973,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.downloads).toHaveLength(1);
    });

    it('should return 400 when username is missing', async () => {
      const response = await request(app)
        .post('/api/slskd/download')
        .send({
          files: [{ filename: 'test.flac', size: 1000 }],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Username and files are required');
    });

    it('should return 400 when files is missing', async () => {
      const response = await request(app)
        .post('/api/slskd/download')
        .send({
          username: 'soulseekuser',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Username and files are required');
    });

    it('should return 400 when no slskd connection exists', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/slskd/download')
        .send({
          username: 'soulseekuser',
          files: [{ filename: 'test.flac', size: 1000 }],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No slskd connection configured');
    });
  });

  describe('GET /api/slskd/downloads', () => {
    it('should return tracked downloads', async () => {
      mockPrisma.slskdDownload.findMany.mockResolvedValue([
        {
          id: 1,
          connectionId: 1,
          username: 'soulseekuser',
          artistName: 'Pink Floyd',
          albumName: 'Dark Side of the Moon',
          albumYear: 1973,
          filename: 'track.flac',
          fileSize: 50000000,
          status: 'completed',
          progress: 100,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 2,
          connectionId: 1,
          username: 'anotheruser',
          artistName: 'Tool',
          albumName: 'Lateralus',
          albumYear: 2001,
          filename: 'track.flac',
          fileSize: 60000000,
          status: 'downloading',
          progress: 45,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const response = await request(app)
        .get('/api/slskd/downloads');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].artistName).toBe('Pink Floyd');
      expect(response.body[1].artistName).toBe('Tool');
    });

    it('should return empty array when no downloads exist', async () => {
      mockPrisma.slskdDownload.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/slskd/downloads');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });
  });

  describe('Error handling', () => {
    it('should handle slskd API errors gracefully', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test-key' },
      });

      mockFetch.mockResolvedValue(mockFetchResponse(
        { error: 'Internal Server Error' },
        false,
        500
      ));

      const response = await request(app)
        .post('/api/slskd/search')
        .send({ query: 'Pink Floyd' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Search failed');
    });

    it('should handle database errors gracefully', async () => {
      mockPrisma.slskdDownload.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/slskd/downloads');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get downloads');
    });
  });

  describe('POST /api/slskd/webhook', () => {
    it('should accept download completion webhook', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockPrisma.slskdDownload.findFirst.mockResolvedValue({
        id: 1,
        username: 'soulseekuser',
        filename: 'track.flac',
        status: 'pending',
        artistName: 'Pink Floyd',
      });

      mockPrisma.slskdDownload.update.mockResolvedValue({
        id: 1,
        username: 'soulseekuser',
        filename: 'track.flac',
        status: 'downloading',
      });

      // Mock the organizer service
      vi.doMock('../../src/services/slskd-organizer.js', () => ({
        SlskdOrganizerService: vi.fn().mockImplementation(() => ({
          organizeFile: vi.fn().mockResolvedValue('/data/plex/music/Pink Floyd/track.flac'),
        })),
      }));

      const response = await request(app)
        .post('/api/slskd/webhook')
        .send({
          event: 'DownloadComplete',
          username: 'soulseekuser',
          filename: '/music/Pink Floyd/track.flac',
          directory: 'Pink Floyd - DSOTM',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should ignore non-download events', async () => {
      const response = await request(app)
        .post('/api/slskd/webhook')
        .send({
          event: 'SearchComplete',
          searchId: 'search-123',
        });

      expect(response.status).toBe(200);
      expect(response.body.ignored).toBe(true);
    });

    it('should handle unknown downloads gracefully', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        type: 'slskd',
        enabled: true,
        config: { url: 'http://localhost:5030', apiKey: 'key' },
      });

      mockPrisma.slskdDownload.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/slskd/webhook')
        .send({
          event: 'DownloadComplete',
          username: 'unknown',
          filename: 'unknown.flac',
          directory: 'Album',
        });

      expect(response.status).toBe(200);
      expect(response.body.matched).toBe(false);
    });

    it('should return 400 when no slskd connection exists', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/slskd/webhook')
        .send({
          event: 'DownloadComplete',
          username: 'soulseekuser',
          filename: 'track.flac',
          directory: 'Album',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No slskd connection configured');
    });

    it('should handle organization errors gracefully', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockPrisma.slskdDownload.findFirst.mockResolvedValue({
        id: 1,
        username: 'soulseekuser',
        filename: 'track.flac',
        status: 'pending',
      });

      // First update succeeds (status to downloading), second fails (DB error during organization)
      mockPrisma.slskdDownload.update.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .post('/api/slskd/webhook')
        .send({
          event: 'DownloadComplete',
          username: 'soulseekuser',
          filename: 'track.flac',
          directory: 'Album',
        });

      expect(response.status).toBe(500);
    });
  });
});
