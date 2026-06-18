/**
 * AI recommendation subscription strategy.
 *
 * Cross-service strategy: reads the user's library from Spotify, Last.fm, or
 * Lidarr, then asks an AI service to suggest similar/new artists.
 *
 * Registered in the global strategy registry at module load time.
 */

import { registerStrategy } from './registry.js';
import {
  artistResult,
  type SubscriptionStrategy,
  type StrategyContext,
  type SubscriptionStrategyResult,
} from './types.js';
import { AIService } from '../../services/ai.js';
import { SpotifyService } from '../../services/spotify.js';
import { LastfmService } from '../../services/lastfm.js';
import { LidarrService } from '../../services/lidarr.js';
import { isSpotifyConfig, isLastFMConfig, isLidarrConfig } from '../../types/connections.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('AI-Strategy');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/**
 * ai_recommendation – AI-powered artist discovery.
 *
 * Uses the user's Spotify followed artists, Last.fm top artists, or Lidarr
 * library as seeds, then asks an AI provider (OpenAI / Anthropic) for
 * recommendations using a configurable strategy (similar, genre_expansion,
 * discovery).
 */
const aiRecommendation: SubscriptionStrategy = {
  async execute(context: StrategyContext): Promise<SubscriptionStrategyResult> {
    const source = context.config.source as 'spotify' | 'lastfm' | 'lidarr';
    const strategy = context.config.strategy || 'similar';
    const limit = context.config.limit || 20;

    logger.info('AI recommendation starting', { source, strategy, limit });
    logger.debug('Available connections', {
      types: Array.from(context.connections.keys()),
    });

    // Collect seed artists from the chosen source
    let sourceArtists: string[] = [];

    if (source === 'spotify') {
      const conn = context.connections.get('spotify');
      if (!conn) throw new Error('No active Spotify connection');
      if (!isSpotifyConfig(conn.config)) {
        throw new Error('Invalid Spotify connection config');
      }
      const spotify = new SpotifyService(conn.config);
      const followed = await spotify.getAllFollowedArtists();
      sourceArtists = followed.slice(0, 20).map(a => a.name);
    } else if (source === 'lastfm') {
      const conn = context.connections.get('lastfm');
      if (!conn) throw new Error('No active Last.fm connection');
      if (!isLastFMConfig(conn.config)) {
        throw new Error('Invalid Last.fm connection config');
      }
      const lastfm = new LastfmService({ apiKey: conn.config.apiKey });
      const top = await lastfm.getTopArtists(20);
      sourceArtists = top.artists.map(a => a.name);
    } else if (source === 'lidarr') {
      const conn = context.connections.get('lidarr');
      if (!conn) {
        logger.error('No lidarr connection found in context');
        throw new Error('No active Lidarr connection');
      }
      if (!isLidarrConfig(conn.config)) {
        logger.error('Invalid Lidarr config', { config: conn.config });
        throw new Error('Invalid Lidarr connection config');
      }
      logger.info('Fetching artists from Lidarr', { url: conn.config.url });
      const lidarr = new LidarrService({
        url: conn.config.url,
        apiKey: conn.config.apiKey,
      });
      const artists = await lidarr.getArtists();
      sourceArtists = artists.map(a => a.artistName);
      logger.info('Lidarr returned artists', { count: sourceArtists.length });
    }

    if (sourceArtists.length === 0) {
      throw new Error(`No artists found in ${source} library to analyze`);
    }

    logger.info('Seed artists collected', { count: sourceArtists.length, sample: sourceArtists.slice(0, 5) });

    // Get AI recommendations
    const aiService = new AIService();
    await aiService.loadSettings();

    const isAvailable = await aiService.isAvailable();
    if (!isAvailable) {
      logger.error('AI service not available - no provider configured or enabled');
      throw new Error('AI service not available. Check AI settings (API key, base URL, model).');
    }

    logger.info('Calling AI service for recommendations', { strategy, seedCount: sourceArtists.length });

    const recs = await aiService.getRecommendationsWithStrategy(
      sourceArtists,
      strategy,
      limit,
    );

    logger.info('AI service returned recommendations', { count: recs.length });

    return artistResult(
      recs.map(r => ({
        name: r.name,
        source: `ai-${source}-${strategy}`,
      })),
    );
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerStrategy('ai_recommendation', aiRecommendation);
