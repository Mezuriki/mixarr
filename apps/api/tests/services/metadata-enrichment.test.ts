// apps/api/tests/services/metadata-enrichment.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataEnrichmentService } from '../../src/services/metadata-enrichment.js';
import type { LidarrService, LidarrArtist } from '../../src/services/lidarr.js';
import type { LastfmService } from '../../src/services/lastfm.js';

// Mock adapters
const mockLastfmFetchMetadata = vi.fn();
const mockDeezerFetchMetadata = vi.fn();
const mockMerge = vi.fn();

vi.mock('../../src/services/adapters/lastfm-adapter.js', () => ({
  LastfmMetadataAdapter: class {
    fetchMetadata = mockLastfmFetchMetadata;
  },
}));

vi.mock('../../src/services/adapters/deezer-adapter.js', () => ({
  DeezerMetadataAdapter: class {
    fetchMetadata = mockDeezerFetchMetadata;
  },
}));

vi.mock('../../src/services/metadata-merger.js', () => ({
  MetadataMerger: class {
    merge = mockMerge;
  },
}));

describe('MetadataEnrichmentService', () => {
  let service: MetadataEnrichmentService;
  let mockLidarrService: Partial<LidarrService>;
  let mockLastfmService: Partial<LastfmService>;

  const mockArtist: LidarrArtist = {
    id: 123,
    artistName: 'Radiohead',
    foreignArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    path: '/music/Radiohead',
    rootFolderPath: '/music',
    qualityProfileId: 1,
    metadataProfileId: 1,
    monitored: true,
    overview: '',
    genres: [],
    images: [],
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockLidarrService = {
      getArtist: vi.fn().mockResolvedValue(mockArtist),
      patchArtist: vi.fn().mockResolvedValue(mockArtist),
    };

    mockLastfmService = {
      getArtistInfo: vi.fn(),
    };

    service = new MetadataEnrichmentService(
      mockLidarrService as LidarrService,
      mockLastfmService as LastfmService
    );
  });

  describe('enrichArtist', () => {
    it('should fetch metadata from all sources and merge', async () => {
      mockLastfmFetchMetadata.mockResolvedValue({
        source: 'lastfm',
        overview: 'Radiohead are an English rock band.',
        genres: ['alternative rock', 'art rock'],
        fetchedAt: new Date(),
      });

      mockDeezerFetchMetadata.mockResolvedValue({
        source: 'deezer',
        images: [{ url: 'https://deezer.com/xl.jpg', width: 1000, height: 1000, type: 'poster' }],
        fetchedAt: new Date(),
      });

      mockMerge.mockReturnValue({
        overview: 'Radiohead are an English rock band.',
        overviewSource: 'lastfm',
        genres: ['alternative rock', 'art rock'],
        genreSources: ['lastfm'],
        images: [{ url: 'https://deezer.com/xl.jpg', width: 1000, height: 1000, type: 'poster', source: 'deezer' }],
        sourcesUsed: ['lastfm', 'deezer'],
        mergedAt: new Date(),
      });

      const result = await service.enrichArtist(123, { updateLidarr: false });

      expect(result.success).toBe(true);
      expect(result.artistName).toBe('Radiohead');
    });

    it('should update Lidarr when updateLidarr option is true', async () => {
      mockLastfmFetchMetadata.mockResolvedValue({
        source: 'lastfm',
        overview: 'New bio',
        genres: ['rock'],
        fetchedAt: new Date(),
      });

      mockDeezerFetchMetadata.mockResolvedValue({
        source: 'deezer',
        fetchedAt: new Date(),
      });

      mockMerge.mockReturnValue({
        overview: 'New bio',
        genres: ['rock'],
        images: [],
        sourcesUsed: ['lastfm'],
        genreSources: ['lastfm'],
        mergedAt: new Date(),
      });

      await service.enrichArtist(123, { updateLidarr: true });

      expect(mockLidarrService.patchArtist).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          overview: 'New bio',
          genres: ['rock'],
        })
      );
    });

    it('should not update Lidarr if no new metadata found', async () => {
      mockLastfmFetchMetadata.mockResolvedValue({
        source: 'lastfm',
        fetchedAt: new Date(),
      });

      mockDeezerFetchMetadata.mockResolvedValue({
        source: 'deezer',
        fetchedAt: new Date(),
      });

      mockMerge.mockReturnValue({
        genres: [],
        images: [],
        sourcesUsed: [],
        genreSources: [],
        mergedAt: new Date(),
      });

      const result = await service.enrichArtist(123, { updateLidarr: true });

      expect(result.updated).toBe(false);
      expect(mockLidarrService.patchArtist).not.toHaveBeenCalled();
    });

    it('should track which fields were updated', async () => {
      // Simulate artist already has genres but no overview
      vi.mocked(mockLidarrService.getArtist!).mockResolvedValue({
        ...mockArtist,
        genres: ['existing genre'],
        overview: '',
      });

      mockLastfmFetchMetadata.mockResolvedValue({
        source: 'lastfm',
        overview: 'New overview from enrichment',
        genres: ['rock', 'existing genre'],
        fetchedAt: new Date(),
      });

      mockDeezerFetchMetadata.mockResolvedValue({
        source: 'deezer',
        fetchedAt: new Date(),
      });

      mockMerge.mockReturnValue({
        overview: 'New overview from enrichment',
        genres: ['rock', 'existing genre'],
        images: [],
        sourcesUsed: ['lastfm'],
        genreSources: ['lastfm'],
        mergedAt: new Date(),
      });

      const result = await service.enrichArtist(123, { updateLidarr: true });

      expect(result.fieldsUpdated).toContain('overview');
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(mockLidarrService.getArtist!).mockRejectedValue(
        new Error('Lidarr connection failed')
      );

      const result = await service.enrichArtist(123);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Lidarr connection failed');
    });
  });
});
