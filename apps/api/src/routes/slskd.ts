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
import prisma from '../lib/db.js';
import { SlskdService } from '../services/slskd.js';
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
 * Returns: Array of SlskdDownload objects, most recent first (limit 100)
 */
router.get('/downloads', async (_req: Request, res: Response) => {
  try {
    const downloads = await prisma.slskdDownload.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(downloads);
  } catch (error) {
    log.error('Failed to get downloads', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Failed to get downloads' });
  }
});

export default router;
