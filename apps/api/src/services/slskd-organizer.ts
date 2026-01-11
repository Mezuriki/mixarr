import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '../lib/db.js';
import { createLogger } from '../lib/logger.js';
import { parseFilename, buildTargetPath } from '../utils/slskd-parser.js';
import { addLogEntry } from '../routes/logs.js';

const logger = createLogger('SlskdOrganizer');

export interface OrganizerConfig {
  downloadDir: string;
  musicLibraryDir: string;
}

export interface AudioMetadata {
  artist?: string;
  album?: string;
  year?: number;
  trackNumber?: number;
  title?: string;
}

export class SlskdOrganizerService {
  constructor(private config: OrganizerConfig) {}

  /**
   * Parse audio metadata from file
   * For MVP, extracts from filename. Could be enhanced with music-metadata library.
   */
  parseAudioMetadata(filePath: string): AudioMetadata {
    const filename = path.basename(filePath);
    const parsed = parseFilename(filename);
    
    return {
      trackNumber: parsed.trackNumber,
      title: parsed.title,
    };
  }

  /**
   * Determine destination path for a file
   * Combines metadata with download record data
   */
  determineDestination(
    metadata: AudioMetadata,
    downloadRecord: { artistName: string; albumName?: string | null; albumYear?: number | null },
    filename: string
  ): string {
    return buildTargetPath(
      this.config.musicLibraryDir,
      metadata.artist || downloadRecord.artistName,
      metadata.album || downloadRecord.albumName || undefined,
      metadata.year || downloadRecord.albumYear || undefined,
      filename
    );
  }

  /**
   * Organize a downloaded file - move to music library with proper naming
   */
  async organizeFile(downloadId: number): Promise<string> {
    const download = await prisma.slskdDownload.findUnique({
      where: { id: downloadId },
    });

    if (!download) {
      throw new Error(`Download ${downloadId} not found`);
    }

    if (!download.downloadPath) {
      throw new Error(`Download ${downloadId} has no download path`);
    }

    const metadata = this.parseAudioMetadata(download.downloadPath);
    const destination = this.determineDestination(
      metadata,
      {
        artistName: download.artistName,
        albumName: download.albumName,
        albumYear: download.albumYear,
      },
      path.basename(download.downloadPath)
    );

    // Create parent directories
    await fs.mkdir(path.dirname(destination), { recursive: true });

    // Move file
    await fs.rename(download.downloadPath, destination);

    // Update database
    await prisma.slskdDownload.update({
      where: { id: downloadId },
      data: {
        status: 'completed',
        finalPath: destination,
        completedAt: new Date(),
      },
    });

    logger.info('Organized slskd download', { 
      downloadId, 
      artist: download.artistName,
      album: download.albumName,
      destination,
    });

    // Add activity log entry
    await addLogEntry('info', 'slskd', `Downloaded and organized: ${download.artistName}${download.albumName ? ` - ${download.albumName}` : ''}`, {
      downloadId,
      artist: download.artistName,
      album: download.albumName,
      year: download.albumYear,
      filename: path.basename(destination),
      destination,
      source: download.username,
    });

    // Cleanup empty source directories
    const sourceDir = path.dirname(download.downloadPath);
    await this.cleanupEmptyDirs(sourceDir);

    return destination;
  }

  /**
   * Recursively remove empty directories up to downloadDir
   */
  async cleanupEmptyDirs(dirPath: string): Promise<void> {
    // Don't go above the download directory
    if (dirPath === this.config.downloadDir || !dirPath.startsWith(this.config.downloadDir)) {
      return;
    }

    try {
      const files = await fs.readdir(dirPath);
      if (files.length === 0) {
        await fs.rmdir(dirPath);
        logger.debug('Removed empty directory', { dirPath });
        // Recursively clean parent
        await this.cleanupEmptyDirs(path.dirname(dirPath));
      }
    } catch {
      // Directory doesn't exist or not empty - that's OK
    }
  }
}
