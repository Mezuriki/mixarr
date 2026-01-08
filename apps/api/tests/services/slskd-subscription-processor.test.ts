import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SlskdSubscriptionProcessor } from '../../src/services/slskd-subscription-processor';
import { SlskdService } from '../../src/services/slskd-service';

const prisma = new PrismaClient();

describe('SlskdSubscriptionProcessor - Per-File Download Model', () => {
  let processor: SlskdSubscriptionProcessor;
  let mockSlskdService: any;

  beforeEach(async () => {
    // Clean up test data
    await prisma.slskdDownload.deleteMany({});

    // Mock slskd service
    mockSlskdService = {
      createSearch: vi.fn(),
      getSearch: vi.fn(),
      queueDownload: vi.fn(),
    };

    processor = new SlskdSubscriptionProcessor(
      prisma,
      mockSlskdService as unknown as SlskdService
    );
  });

  it('should create one SlskdDownload record per file', async () => {
    const mockFiles = [
      {
        filename: '01 - Test Song 1.flac',
        size: 30000000,
        extension: '.flac',
        bitRate: 1411,
        sampleRate: 44100,
        bitDepth: 16,
      },
      {
        filename: '02 - Test Song 2.flac',
        size: 28000000,
        extension: '.flac',
        bitRate: 1411,
        sampleRate: 44100,
        bitDepth: 16,
      },
      {
        filename: '03 - Test Song 3.flac',
        size: 32000000,
        extension: '.flac',
        bitRate: 1411,
        sampleRate: 44100,
        bitDepth: 16,
      },
    ];

    // Mock search creation
    mockSlskdService.createSearch.mockResolvedValue({ id: 1 });

    // Mock search results with 3 files
    mockSlskdService.getSearch.mockResolvedValue({
      id: 1,
      state: 'Completed',
      responses: [
        {
          username: 'testuser',
          files: mockFiles,
          uploadSpeed: 1000000,
          queueLength: 5,
          hasFreeUploadSlot: true,
        },
      ],
    });

    mockSlskdService.queueDownload.mockResolvedValue(undefined);

    const result = await processor.processArtist(
      { name: 'Test Artist', album: 'Test Album' },
      { connectionId: 1, userId: 1, preferences: { preferLossless: true } }
    );

    expect(result.status).toBe('queued');

    // Should create 3 download records (one per file)
    const downloads = await prisma.slskdDownload.findMany({
      where: { artistName: 'Test Artist', albumName: 'Test Album' },
    });

    expect(downloads).toHaveLength(3);
    expect(downloads[0].filename).toBe('01 - Test Song 1.flac');
    expect(downloads[0].fileSize).toBe(BigInt(30000000));
    expect(downloads[1].filename).toBe('02 - Test Song 2.flac');
    expect(downloads[1].fileSize).toBe(BigInt(28000000));
    expect(downloads[2].filename).toBe('03 - Test Song 3.flac');
    expect(downloads[2].fileSize).toBe(BigInt(32000000));
  });

  it('should handle empty file array without creating records', async () => {
    // Mock search with no files
    mockSlskdService.createSearch.mockResolvedValue({ id: 2 });
    mockSlskdService.getSearch.mockResolvedValue({
      id: 2,
      state: 'Completed',
      responses: [
        {
          username: 'testuser',
          files: [], // Empty files array
          uploadSpeed: 1000000,
          queueLength: 5,
          hasFreeUploadSlot: true,
        },
      ],
    });

    const result = await processor.processArtist(
      { name: 'Empty Artist', album: 'Empty Album' },
      { connectionId: 1, userId: 1, preferences: { preferLossless: true } }
    );

    expect(result.status).toBe('no_results');

    // Should create zero records
    const downloads = await prisma.slskdDownload.findMany({
      where: { artistName: 'Empty Artist', albumName: 'Empty Album' },
    });

    expect(downloads).toHaveLength(0);
  });

  it('should wrap per-file creation in transaction for atomicity', async () => {
    const mockFiles = [
      {
        filename: 'track1.flac',
        size: 30000000,
        extension: '.flac',
        bitRate: 1411,
        sampleRate: 44100,
        bitDepth: 16,
      },
      {
        filename: 'track2.flac',
        size: 28000000,
        extension: '.flac',
        bitRate: 1411,
        sampleRate: 44100,
        bitDepth: 16,
      },
    ];

    mockSlskdService.createSearch.mockResolvedValue({ id: 3 });
    mockSlskdService.getSearch.mockResolvedValue({
      id: 3,
      state: 'Completed',
      responses: [
        {
          username: 'testuser',
          files: mockFiles,
          uploadSpeed: 1000000,
          queueLength: 5,
          hasFreeUploadSlot: true,
        },
      ],
    });

    // Mock a failure on queue to test transaction rollback
    mockSlskdService.queueDownload.mockRejectedValueOnce(new Error('Queue failed'));

    await expect(
      processor.processArtist(
        { name: 'Transaction Test', album: 'Test Album' },
        { connectionId: 1, userId: 1, preferences: { preferLossless: true } }
      )
    ).rejects.toThrow('Queue failed');

    // Transaction rollback means no records should exist
    const downloads = await prisma.slskdDownload.findMany({
      where: { artistName: 'Transaction Test', albumName: 'Test Album' },
    });

    expect(downloads).toHaveLength(0);
  });
});
