import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mock functions at module level
const mockGetDownloads = vi.fn();
const mockOrganizeFile = vi.fn();
const mockConnectionFindFirst = vi.fn();
const mockDownloadFindMany = vi.fn();
const mockDownloadUpdate = vi.fn();
const mockDownloadUpdateMany = vi.fn();

// Mock the database
vi.mock('../../src/lib/db.js', () => ({
  prisma: {
    connection: {
      findFirst: mockConnectionFindFirst,
    },
    slskdDownload: {
      findMany: mockDownloadFindMany,
      update: mockDownloadUpdate,
      updateMany: mockDownloadUpdateMany,
    },
  },
}));

// Mock SlskdService as a class
vi.mock('../../src/services/slskd.js', () => ({
  SlskdService: class MockSlskdService {
    getDownloads = mockGetDownloads;
  },
}));

// Mock SlskdOrganizerService as a class
vi.mock('../../src/services/slskd-organizer.js', () => ({
  SlskdOrganizerService: class MockSlskdOrganizerService {
    organizeFile = mockOrganizeFile;
  },
}));

// Mock logger to avoid console noise
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SlskdPollJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('pollSlskdDownloads', () => {
    it('should skip if no slskd connection configured', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue(null);

      await pollSlskdDownloads();

      expect(mockDownloadFindMany).not.toHaveBeenCalled();
    });

    it('should fetch pending downloads from database', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([]);
      mockGetDownloads.mockResolvedValue([]);

      await pollSlskdDownloads();

      expect(mockDownloadFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: ['pending', 'downloading'] } },
        })
      );
    });

    it('should update status when download is in progress', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: 'user1', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockResolvedValue([
        {
          username: 'user1',
          directories: [{
            directory: 'Album',
            files: [{ filename: '/music/track.flac', state: 'InProgress' }],
          }],
        },
      ]);

      mockDownloadUpdate.mockResolvedValue({});

      await pollSlskdDownloads();

      expect(mockDownloadUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ status: 'downloading' }),
        })
      );
    });

    it('should trigger organization when download completes', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: 'user1', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockResolvedValue([
        {
          username: 'user1',
          directories: [{
            directory: 'Album',
            files: [{ filename: '/music/track.flac', state: 'Completed' }],
          }],
        },
      ]);

      // Mock atomic updateMany to succeed (we win the race)
      mockDownloadUpdateMany.mockResolvedValue({ count: 1 });

      mockOrganizeFile.mockResolvedValue('/data/plex/music/Artist/Album/track.flac');
      mockDownloadUpdate.mockResolvedValue({});

      await pollSlskdDownloads();

      expect(mockOrganizeFile).toHaveBeenCalledWith(1);
    });

    it('should skip organization if race condition lost', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: 'user1', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockResolvedValue([
        {
          username: 'user1',
          directories: [{
            directory: 'Album',
            files: [{ filename: '/music/track.flac', state: 'Completed' }],
          }],
        },
      ]);

      // Mock atomic updateMany to return 0 (lost the race)
      mockDownloadUpdateMany.mockResolvedValue({ count: 0 });

      await pollSlskdDownloads();

      // Should not call organizeFile if we lost the race
      expect(mockOrganizeFile).not.toHaveBeenCalled();
    });

    it('should mark download as failed on error', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: 'user1', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockResolvedValue([
        {
          username: 'user1',
          directories: [{
            directory: 'Album',
            files: [{ filename: '/music/track.flac', state: 'Errored' }],
          }],
        },
      ]);

      mockDownloadUpdate.mockResolvedValue({});

      await pollSlskdDownloads();

      expect(mockDownloadUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ status: 'failed' }),
        })
      );
    });

    it('should handle slskd connection errors gracefully', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: 'user1', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockRejectedValue(new Error('Connection refused'));

      // Should not throw
      await expect(pollSlskdDownloads()).resolves.not.toThrow();
    });
  });
});
