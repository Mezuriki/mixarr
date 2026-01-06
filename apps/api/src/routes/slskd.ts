/**
 * slskd API Routes
 * 
 * Provides endpoints for:
 * - Search: Start searches, poll results, delete searches
 * - Downloads: Queue files, track download status
 * 
 * All routes require authentication and use the SlskdService internally.
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import prisma from '../lib/db.js';
import { SlskdDownloadStatus, Prisma } from '@prisma/client';
import { SlskdService } from '../services/slskd.js';
import { SlskdOrganizerService } from '../services/slskd-organizer.js';
import { requireAuth } from '../middleware/auth.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('SlskdRoutes');

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * Helper to get slskd connection and service
 * Returns null if no enabled slskd connection exists
 */
async function getSlskdService(): Promise<{ service: SlskdService; connectionId: number } | null> {
  const connection = await prisma.connection.findFirst({
    where: { type: 'slskd', isActive: true },
  });

  if (!connection) {
    return null;
  }

  const config = connection.config as { url: string; apiKey: string };
  return {
    service: new SlskdService({ url: config.url, apiKey: config.apiKey }),
    connectionId: connection.id,
  };
}

// ============================================================================
// SEARCH ENDPOINTS
// ============================================================================

/**
 * POST /api/slskd/search - Start a new search
 * 
 * Body:
 *   - query: string (required) - Search text
 *   - options: object (optional) - Search options (filterResponses, minimumPeerUploadSpeed, etc.)
 * 
 * Returns: SlskdSearch object with id, searchText, state
 */
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, options } = req.body;

    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    const slskd = await getSlskdService();
    if (!slskd) {
      res.status(400).json({ error: 'No slskd connection configured' });
      return;
    }

    const result = await slskd.service.search(query, options);
    res.json(result);
  } catch (error) {
    log.error('slskd search failed', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/slskd/search/:id - Get search results
 * 
 * Params:
 *   - id: string - Search ID from POST /search
 * 
 * Returns: SlskdSearch object with responses
 */
router.get('/search/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const slskd = await getSlskdService();
    if (!slskd) {
      res.status(400).json({ error: 'No slskd connection configured' });
      return;
    }

    const result = await slskd.service.getSearchResults(id);
    res.json(result);
  } catch (error) {
    log.error('Failed to get search results', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Failed to get search results' });
  }
});

/**
 * DELETE /api/slskd/search/:id - Cancel/delete a search
 * 
 * Params:
 *   - id: string - Search ID to delete
 * 
 * Returns: { success: true }
 */
router.delete('/search/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const slskd = await getSlskdService();
    if (!slskd) {
      res.status(400).json({ error: 'No slskd connection configured' });
      return;
    }

    await slskd.service.deleteSearch(id);
    res.json({ success: true });
  } catch (error) {
    log.error('Failed to delete search', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Failed to delete search' });
  }
});

// ============================================================================
// DOWNLOAD ENDPOINTS
// ============================================================================

/**
 * POST /api/slskd/download - Queue files for download
 * 
 * Body:
 *   - username: string (required) - Soulseek username to download from
 *   - files: array (required) - Array of { filename, size } objects
 *   - artistName: string (optional) - Artist name for tracking
 *   - albumName: string (optional) - Album name for tracking
 *   - albumYear: number (optional) - Album year for tracking
 * 
 * Returns: { success: true, downloads: SlskdDownload[] }
 */
router.post('/download', async (req: Request, res: Response) => {
  try {
    const { username, files, artistName, albumName, albumYear } = req.body;

    if (!username || !files || !Array.isArray(files)) {
      res.status(400).json({ error: 'Username and files are required' });
      return;
    }

    const slskd = await getSlskdService();
    if (!slskd) {
      res.status(400).json({ error: 'No slskd connection configured' });
      return;
    }

    // Queue the download in slskd
    await slskd.service.queueDownload(username, files);

    // Track each file in our database
    const downloads = await Promise.all(
      files.map((file: { filename: string; size: number }) =>
        prisma.slskdDownload.create({
          data: {
            connectionId: slskd.connectionId,
            username,
            artistName: artistName || 'Unknown Artist',
            albumName,
            albumYear,
            filename: file.filename,
            fileSize: file.size,
            status: 'pending',
          },
        })
      )
    );

    res.json({ success: true, downloads });
  } catch (error) {
    log.error('Failed to queue download', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Failed to queue download' });
  }
});

/**
 * GET /api/slskd/downloads - Get tracked downloads
 * 
 * Query params:
 *   - status: string (optional) - Filter by status (comma-separated for multiple)
 *   - limit: number (optional) - Max results (default 100)
 * 
 * Returns: Array of SlskdDownload objects, most recent first
 */
router.get('/downloads', async (req: Request, res: Response) => {
  try {
    const { status, limit = '100' } = req.query;
    
    // Build where clause with proper Prisma types
    const where: Prisma.SlskdDownloadWhereInput = {};
    
    if (status && typeof status === 'string') {
      const statuses = status.split(',').map(s => s.trim()) as SlskdDownloadStatus[];
      if (statuses.length === 1) {
        where.status = statuses[0];
      } else {
        where.status = { in: statuses };
      }
    }
    
    const downloads = await prisma.slskdDownload.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit as string, 10) || 100, 500),
    });
    res.json(downloads);
  } catch (error) {
    log.error('Failed to get downloads', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Failed to get downloads' });
  }
});

/**
 * POST /api/slskd/downloads/:id/retry - Retry a failed download
 * 
 * Params:
 *   - id: number - Download ID
 * 
 * Returns: { success: true, download: SlskdDownload }
 */
router.post('/downloads/:id/retry', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    
    const download = await prisma.slskdDownload.findUnique({ where: { id } });
    
    if (!download) {
      res.status(404).json({ error: 'Download not found' });
      return;
    }
    
    if (download.status !== 'failed') {
      res.status(400).json({ error: 'Only failed downloads can be retried' });
      return;
    }
    
    const slskd = await getSlskdService();
    if (!slskd) {
      res.status(400).json({ error: 'No slskd connection configured' });
      return;
    }
    
    // Queue download again
    await slskd.service.queueDownload(download.username, [{
      filename: download.filename,
      size: download.fileSize,
    }]);
    
    // Update status
    const updated = await prisma.slskdDownload.update({
      where: { id },
      data: { status: 'pending', error: null },
    });
    
    res.json({ success: true, download: updated });
  } catch (error) {
    log.error('Failed to retry download', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Failed to retry download' });
  }
});

/**
 * DELETE /api/slskd/downloads/:id - Cancel or remove a download
 * 
 * Params:
 *   - id: number - Download ID
 * 
 * Query params:
 *   - remove: boolean (optional) - If true, delete record; otherwise cancel
 * 
 * Returns: { success: true }
 */
router.delete('/downloads/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const remove = req.query.remove === 'true';
    
    const download = await prisma.slskdDownload.findUnique({ where: { id } });
    
    if (!download) {
      res.status(404).json({ error: 'Download not found' });
      return;
    }
    
    if (remove) {
      // Delete the record entirely
      await prisma.slskdDownload.delete({ where: { id } });
      res.json({ success: true, removed: true });
    } else {
      // Cancel the download (set status to cancelled)
      await prisma.slskdDownload.update({
        where: { id },
        data: { status: 'cancelled' },
      });
      res.json({ success: true, cancelled: true });
    }
  } catch (error) {
    log.error('Failed to cancel/remove download', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Failed to cancel/remove download' });
  }
});

// ============================================================================
// WEBHOOK ENDPOINTS
// ============================================================================

/**
 * POST /api/slskd/webhook - Receive slskd completion events
 * 
 * Body:
 *   - event: string - Event type (DownloadComplete, etc.)
 *   - username: string - Soulseek username
 *   - filename: string - Downloaded file path
 *   - directory: string - Directory name
 * 
 * Returns: { success: true, organized: boolean }
 * 
 * Note: This endpoint does NOT require authentication as it's called by slskd
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const { event, username, filename, directory } = req.body;

    // Only handle download completion events
    if (event !== 'DownloadComplete') {
      res.json({ success: true, ignored: true });
      return;
    }

    log.info('slskd webhook received', { event, username, filename });

    // Get connection config
    const connection = await prisma.connection.findFirst({
      where: { type: 'slskd', isActive: true },
    });

    if (!connection) {
      res.status(400).json({ error: 'No slskd connection configured' });
      return;
    }

    const config = connection.config as {
      url: string;
      apiKey: string;
      downloadDir?: string;
      musicLibraryDir?: string;
    };

    // Find matching download record
    const download = await prisma.slskdDownload.findFirst({
      where: {
        username,
        filename: { contains: path.basename(filename) },
        status: { in: ['pending', 'downloading'] },
      },
    });

    if (!download) {
      log.warn('Webhook for unknown download', { username, filename });
      res.json({ success: true, matched: false });
      return;
    }

    const downloadDir = config.downloadDir || '/data/slskd/downloads';
    const musicLibraryDir = config.musicLibraryDir || '/data/plex/music';

    // Build download path
    const downloadPath = `${downloadDir}/${username}/${directory}/${path.basename(filename)}`;

    // Update download with path
    await prisma.slskdDownload.update({
      where: { id: download.id },
      data: { downloadPath, status: 'downloading' },
    });

    // Trigger organization
    const organizer = new SlskdOrganizerService({ downloadDir, musicLibraryDir });

    try {
      const finalPath = await organizer.organizeFile(download.id);
      log.info('Webhook triggered file organization', { downloadId: download.id, finalPath });
      res.json({ success: true, organized: true, finalPath });
    } catch (orgError) {
      log.error('Webhook organization failed', { downloadId: download.id, error: orgError });
      await prisma.slskdDownload.update({
        where: { id: download.id },
        data: { status: 'failed', error: String(orgError) },
      });
      res.status(500).json({ error: 'Organization failed' });
    }
  } catch (error) {
    log.error('Webhook processing failed', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
