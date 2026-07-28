/**
 * Navidrome routes
 *
 * Exposes the Navidrome (Subsonic) library and an AI lyrics batch-enrichment
 * job to the Mixarr UI. The enrichment itself is delegated to Navidrome's
 * native AI pipeline; this router only orchestrates and tracks progress.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getNavidromeService } from '../lib/connection-resolver.js';
import { navidromeEnrichmentService, type QueueItem } from '../services/navidrome-enrichment.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('NavidromeRoute');

export const navidromeRouter = Router();
navidromeRouter.use(requireAuth);

/**
 * GET /api/navidrome/library
 * Returns the list of artists from the configured Navidrome instance.
 */
navidromeRouter.get('/library', async (req, res) => {
  try {
    const service = await getNavidromeService(req.user!.id);
    if (!service) {
      res.status(404).json({ error: 'No Navidrome connection configured' });
      return;
    }
    const artists = await service.getArtists();
    res.json({ artists });
  } catch (error) {
    log.error('Failed to load Navidrome library:', error);
    res.status(500).json({ error: 'Failed to load library' });
  }
});

/**
 * GET /api/navidrome/albums?artistId=
 * Returns albums for an artist.
 */
navidromeRouter.get('/albums', async (req, res) => {
  try {
    const artistId = req.query.artistId as string | undefined;
    if (!artistId) {
      res.status(400).json({ error: 'artistId is required' });
      return;
    }
    const service = await getNavidromeService(req.user!.id);
    if (!service) {
      res.status(404).json({ error: 'No Navidrome connection configured' });
      return;
    }
    const albums = await service.getAlbumsByArtist(artistId);
    res.json({ albums });
  } catch (error) {
    log.error('Failed to load albums:', error);
    res.status(500).json({ error: 'Failed to load albums' });
  }
});

/**
 * GET /api/navidrome/missing?artistId=&albumId=
 * Returns tracks missing a synced lyrics sidecar, scoped to an artist/album.
 */
navidromeRouter.get('/missing', async (req, res) => {
  try {
    const service = await getNavidromeService(req.user!.id);
    if (!service) {
      res.status(404).json({ error: 'No Navidrome connection configured' });
      return;
    }
    const token = await service.login();
    const params = {
      artistId: req.query.artistId as string | undefined,
      albumId: req.query.albumId as string | undefined,
    };
    const mode = (req.query.mode as string) || 'lyrics';
    const items =
      mode === 'decode'
        ? await service.getMissingDecode(token, params)
        : await service.getMissingLyrics(token, params);
    res.json({ items });
  } catch (error) {
    log.error('Failed to fetch missing items:', error);
    res.status(500).json({ error: 'Failed to fetch missing items' });
  }
});

/**
 * POST /api/navidrome/enrich
 * Body: { mode: 'lyrics'|'decode', all?: boolean, artistIds?: string[], albumIds?: string[], trackIds?: string[] }
 *
 * Builds queue items from the request and appends them to the user's enrichment
 * queue. The worker drains the queue sequentially with quota-aware throttling.
 * `all: true` expands to one item per artist in the library.
 */
navidromeRouter.post('/enrich', async (req, res) => {
  try {
    const service = await getNavidromeService(req.user!.id);
    if (!service) {
      res.status(404).json({ error: 'No Navidrome connection configured' });
      return;
    }

    const { mode = 'lyrics', all, artistIds, albumIds, trackIds } = (req.body || {}) as {
      mode?: 'lyrics' | 'decode';
      all?: boolean;
      artistIds?: string[];
      albumIds?: string[];
      trackIds?: string[];
    };
    const enrichMode = mode === 'decode' ? 'decode' : 'lyrics';

    const items: QueueItem[] = [];

    if (trackIds && trackIds.length > 0) {
      items.push({ type: 'tracks', label: `${trackIds.length} tracks`, trackIds, mode: enrichMode });
    }
    if (albumIds && albumIds.length > 0) {
      // Fetch album names for readable labels.
      for (const albumId of albumIds) {
        const { album } = await service.getAlbum(albumId);
        items.push({
          type: 'album',
          ref: albumId,
          label: album?.name ? `${album.name}${album.artist ? ' — ' + album.artist : ''}` : albumId,
          mode: enrichMode,
        });
      }
    }
    if (artistIds && artistIds.length > 0) {
      for (const artistId of artistIds) {
        items.push({ type: 'artist', ref: artistId, label: artistId, mode: enrichMode });
      }
    }
    if (all) {
      const artists = await service.getArtists();
      for (const a of artists) {
        items.push({ type: 'artist', ref: a.id, label: a.name || a.id, mode: enrichMode });
      }
    }

    if (items.length === 0) {
      res.json({ status: 'idle', message: 'Nothing to enqueue' });
      return;
    }

    const status = await navidromeEnrichmentService.enqueue(req.user!.id, items, service);
    res.json(status);
  } catch (error) {
    log.error('Failed to start Navidrome enrichment:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to start enrichment' });
  }
});

/**
 * GET /api/navidrome/enrich/status
 */
navidromeRouter.get('/enrich/status', async (req, res) => {
  try {
    const status = await navidromeEnrichmentService.getStatus(req.user!.id);
    res.json(status);
  } catch (error) {
    log.error('Failed to get enrichment status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * POST /api/navidrome/enrich/cancel
 */
navidromeRouter.post('/enrich/cancel', async (req, res) => {
  try {
    const cancelled = await navidromeEnrichmentService.cancel(req.user!.id);
    res.json({ cancelled });
  } catch (error) {
    log.error('Failed to cancel enrichment:', error);
    res.status(500).json({ error: 'Failed to cancel' });
  }
});

// Cancel a single queued item by id (the rest of the queue keeps running).
navidromeRouter.post('/enrich/cancel/:itemId', async (req, res) => {
  try {
    const itemId = req.params.itemId;
    if (!itemId) {
      res.status(400).json({ error: 'Missing itemId' });
      return;
    }
    const cancelled = await navidromeEnrichmentService.cancelItem(req.user!.id, itemId);
    res.json({ cancelled, itemId });
  } catch (error) {
    log.error('Failed to cancel enrichment item:', error);
    res.status(500).json({ error: 'Failed to cancel item' });
  }
});
