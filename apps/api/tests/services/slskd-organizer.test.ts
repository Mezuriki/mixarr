import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// Create mock functions that persist across test resets
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockRename = vi.fn().mockResolvedValue(undefined);
const mockReaddir = vi.fn().mockResolvedValue([]);
const mockRmdir = vi.fn().mockResolvedValue(undefined);
const mockStat = vi.fn().mockResolvedValue({ isFile: () => true });

// Mock the database
vi.mock('../../src/lib/db.js', () => ({
  prisma: {
    slskdDownload: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock fs with persistent references
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      mkdir: mockMkdir,
      rename: mockRename,
      readdir: mockReaddir,
      rmdir: mockRmdir,
      stat: mockStat,
    },
  };
});

describe('SlskdOrganizerService', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create service with config', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      
      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      expect(service).toBeDefined();
    });
  });

  describe('determineDestination', () => {
    it('should build correct path from metadata and download record', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      
      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      const result = service.determineDestination(
        { artist: 'Pink Floyd', album: 'The Wall', year: 1979, trackNumber: 1, title: 'In The Flesh' },
        { artistName: 'Pink Floyd', albumName: 'The Wall', albumYear: 1979 },
        '01 - In The Flesh.flac'
      );

      expect(result).toContain('/data/plex/music');
      expect(result).toContain('Pink Floyd');
      expect(result).toContain('The Wall');
      expect(result).toContain('1979');
      expect(result).toContain('.flac');
    });

    it('should use download record when metadata missing', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      
      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      const result = service.determineDestination(
        {}, // No metadata
        { artistName: 'Radiohead', albumName: 'Kid A', albumYear: 2000 },
        'track.flac'
      );

      expect(result).toContain('Radiohead');
      expect(result).toContain('Kid A');
      expect(result).toContain('2000');
    });

    it('should sanitize filesystem-unsafe characters', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      
      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      const result = service.determineDestination(
        { artist: 'AC/DC', album: 'Back In Black: Remastered' },
        { artistName: 'AC/DC', albumName: 'Back In Black: Remastered', albumYear: 1980 },
        '01 - Hells Bells.flac'
      );

      // Should not contain / in artist name or : in album name
      expect(result).not.toMatch(/AC\/DC/);
      expect(result).not.toContain('Black: ');
    });
  });

  describe('organizeFile', () => {
    it('should move file to destination and update database', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      const { prisma } = await import('../../src/lib/db.js');
      
      const mockDownload = {
        id: 1,
        artistName: 'Pink Floyd',
        albumName: 'DSOTM',
        albumYear: 1973,
        downloadPath: '/data/slskd/downloads/user1/Pink Floyd - DSOTM/01 - Breathe.flac',
        filename: '01 - Breathe.flac',
      };

      (prisma.slskdDownload.findUnique as any).mockResolvedValue(mockDownload);
      (prisma.slskdDownload.update as any).mockResolvedValue({ ...mockDownload, status: 'completed' });

      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      const destination = await service.organizeFile(1);

      expect(destination).toContain('/data/plex/music');
      expect(destination).toContain('Pink Floyd');
      expect(mockMkdir).toHaveBeenCalled();
      expect(mockRename).toHaveBeenCalled();
      expect(prisma.slskdDownload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            status: 'completed',
            finalPath: expect.any(String),
          }),
        })
      );
    });

    it('should throw if download not found', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      const { prisma } = await import('../../src/lib/db.js');
      
      (prisma.slskdDownload.findUnique as any).mockResolvedValue(null);

      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      await expect(service.organizeFile(999)).rejects.toThrow();
    });
  });

  describe('cleanupEmptyDirs', () => {
    it('should remove empty directories recursively', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      
      mockReaddir.mockResolvedValue([]);

      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      await service.cleanupEmptyDirs('/data/slskd/downloads/user/artist/album');

      expect(mockRmdir).toHaveBeenCalled();
    });

    it('should not fail if directory is not empty', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      
      mockReaddir.mockResolvedValue(['file.flac']);

      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      // Should not throw
      await expect(service.cleanupEmptyDirs('/data/slskd/downloads/user')).resolves.not.toThrow();
    });
  });
});
