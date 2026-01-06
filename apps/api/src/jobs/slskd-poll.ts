import path from 'path';
import { prisma } from '../lib/db.js';
import { SlskdService } from '../services/slskd.js';
import { SlskdOrganizerService } from '../services/slskd-organizer.js';
import { log } from '../lib/logger.js';

interface SlskdConnectionConfig {
  url: string;
  apiKey: string;
  downloadDir?: string;
  musicLibraryDir?: string;
}

/**
 * Poll slskd for download status updates and trigger organization
 */
export async function pollSlskdDownloads(): Promise<void> {
  // Get active slskd connection
  const connection = await prisma.connection.findFirst({
    where: { type: 'slskd', enabled: true },
  });

  if (!connection) {
    return; // No slskd configured
  }

  const config = connection.config as SlskdConnectionConfig;
  const downloadDir = config.downloadDir || '/data/slskd/downloads';
  const musicLibraryDir = config.musicLibraryDir || '/data/plex/music';

  const slskdService = new SlskdService({ url: config.url, apiKey: config.apiKey });
  const organizer = new SlskdOrganizerService({ downloadDir, musicLibraryDir });

  try {
    // Get pending downloads from our database
    const pendingDownloads = await prisma.slskdDownload.findMany({
      where: { status: { in: ['pending', 'downloading'] } },
    });

    if (pendingDownloads.length === 0) {
      return; // Nothing to check
    }

    log.debug('Polling slskd for download status', { count: pendingDownloads.length });

    // Get current downloads from slskd
    const slskdDownloads = await slskdService.getDownloads();

    // Build lookup by username + filename (basename for matching)
    const slskdLookup = new Map<string, { state: string; directory: string }>();
    for (const userDownload of slskdDownloads) {
      for (const dir of userDownload.directories) {
        for (const file of dir.files) {
          const basename = path.basename(file.filename);
          const key = `${userDownload.username}:${basename}`;
          slskdLookup.set(key, {
            state: file.state || 'None',
            directory: dir.directory,
          });
        }
      }
    }

    // Update each pending download
    for (const download of pendingDownloads) {
      const basename = path.basename(download.filename);
      const key = `${download.username}:${basename}`;
      const slskdStatus = slskdLookup.get(key);

      if (!slskdStatus) {
        // Not found in slskd - might not have started yet or completed and cleared
        continue;
      }

      if (slskdStatus.state === 'Completed') {
        // Download finished - update path and trigger organization
        const downloadPath = `${downloadDir}/${download.username}/${slskdStatus.directory}/${basename}`;

        await prisma.slskdDownload.update({
          where: { id: download.id },
          data: {
            status: 'downloading',
            downloadPath,
          },
        });

        try {
          await organizer.organizeFile(download.id);
          log.info('Organized completed slskd download', { downloadId: download.id });
        } catch (error) {
          log.error('Failed to organize download', { downloadId: download.id, error });
          await prisma.slskdDownload.update({
            where: { id: download.id },
            data: { status: 'failed', error: String(error) },
          });
        }
      } else if (slskdStatus.state === 'InProgress') {
        // Still downloading
        if (download.status !== 'downloading') {
          await prisma.slskdDownload.update({
            where: { id: download.id },
            data: { status: 'downloading' },
          });
        }
      } else if (slskdStatus.state === 'Errored' || slskdStatus.state === 'Cancelled') {
        // Failed or cancelled
        await prisma.slskdDownload.update({
          where: { id: download.id },
          data: { status: 'failed', error: slskdStatus.state },
        });
        log.warn('slskd download failed', { downloadId: download.id, state: slskdStatus.state });
      }
    }
  } catch (error) {
    log.error('slskd poll job failed', { error });
  }
}
