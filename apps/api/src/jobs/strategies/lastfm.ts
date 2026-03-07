/**
 * Last.fm subscription strategies.
 *
 * Each Last.fm subscription type is implemented as a SubscriptionStrategy and
 * registered in the global strategy registry at module load time.
 */

import { registerStrategy } from './registry.js';
import {
  artistResult,
  type SubscriptionStrategy,
  type StrategyContext,
} from './types.js';
import { LastfmService } from '../../services/lastfm.js';
import { isLastFMConfig } from '../../types/connections.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a LastfmService from the strategy context. */
function getLastfmService(context: StrategyContext): LastfmService {
  const conn = context.connections.get('lastfm');
  if (!conn) throw new Error('No active Last.fm connection');
  if (!isLastFMConfig(conn.config)) throw new Error('Invalid Last.fm connection config');
  return new LastfmService({ apiKey: conn.config.apiKey });
}

/** Resolve the Last.fm username from the strategy context. */
function getLastfmUsername(context: StrategyContext): string {
  const conn = context.connections.get('lastfm');
  if (!conn) throw new Error('No active Last.fm connection');
  if (!isLastFMConfig(conn.config)) throw new Error('Invalid Last.fm connection config');
  if (!conn.config.username) {
    throw new Error('Last.fm connection is missing username. Please update your Last.fm connection with your username.');
  }
  return conn.config.username;
}



// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/** lastfm_chart – top artists from global Last.fm charts. */
const lastfmChart: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const result = await lastfm.getTopArtists(context.config.limit || 50);
    return artistResult(
      result.artists.map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: 'lastfm-chart',
      })),
    );
  },
};

/** lastfm_tag – top artists for a given tag/genre. */
const lastfmTag: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const result = await lastfm.getTagTopArtists(context.config.tag, context.config.limit || 50);
    return artistResult(
      result.artists.map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: `lastfm-tag-${context.config.tag}`,
      })),
    );
  },
};

/** lastfm_geo – top artists for a given country. */
const lastfmGeo: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const result = await lastfm.getGeoTopArtists(context.config.country, context.config.limit || 50);
    return artistResult(
      result.artists.map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: `lastfm-geo-${context.config.country}`,
      })),
    );
  },
};

/** lastfm_library – user's top artists from scrobble history. */
const lastfmLibrary: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const username = getLastfmUsername(context);
    const period = context.config.period || 'overall'; // overall, 7day, 1month, 3month, 6month, 12month
    const limit = context.config.limit || 100;
    const result = await lastfm.getUserTopArtists(username, period, limit);
    return artistResult(
      result.artists.map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: `lastfm-library-${period}`,
      })),
    );
  },
};

/** lastfm_similar – artists similar to user's top scrobbled artists. */
const lastfmSimilar: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const username = getLastfmUsername(context);

    // Config options
    const topArtistsLimit = context.config.topArtistsLimit || 20; // How many of user's top artists to use as seeds
    const similarPerArtist = context.config.similarPerArtist || 25; // How many similar artists per seed (deeper = more discovery)
    const period = context.config.period || 'overall';
    const totalLimit = context.config.limit || 100; // Max total results

    // Get user's top artists as seed artists
    const topResult = await lastfm.getUserTopArtists(username, period, topArtistsLimit);
    const seedArtists = topResult.artists;

    // Build a set of seed artist names so we can exclude them from results.
    // The user's own top-scrobbled artists cross-pollinate into each other's
    // similarity lists and dominate the results — exactly the artists already
    // in the user's Lidarr library.
    const seedNames = new Set(seedArtists.map(a => a.name.toLowerCase()));

    // Collect similar artists from each seed, excluding seeds themselves
    const similarMap = new Map<string, { name: string; mbid?: string; match: number; seedCount: number }>();

    for (const seed of seedArtists) {
      try {
        const similarArtists = await lastfm.getSimilarArtists(seed.name, similarPerArtist);
        for (const similar of similarArtists) {
          const key = similar.name.toLowerCase();

          // Skip artists that are themselves seeds (user's top artists)
          if (seedNames.has(key)) continue;

          const existing = similarMap.get(key);
          if (existing) {
            // Seen from multiple seeds - increase relevance
            existing.seedCount++;
            if (similar.match > existing.match) {
              existing.match = similar.match;
            }
          } else {
            similarMap.set(key, {
              name: similar.name,
              mbid: similar.mbid,
              match: similar.match,
              seedCount: 1,
            });
          }
        }
      } catch {
        // Skip this seed if API call fails
      }
    }

    // Sort by seedCount (appears similar to multiple top artists) then by match score
    const sortedSimilar = Array.from(similarMap.values())
      .sort((a, b) => {
        if (b.seedCount !== a.seedCount) return b.seedCount - a.seedCount;
        return b.match - a.match;
      })
      .slice(0, totalLimit);

    return artistResult(
      sortedSimilar.map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: `lastfm-similar-${period}`,
      })),
    );
  },
};

/** lastfm_tag_albums – artists from top albums for a given tag/genre. */
const lastfmTagAlbums: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const tag = context.config.tag;
    if (!tag) throw new Error('Missing required config: tag');
    const result = await lastfm.getTagTopAlbums(tag, context.config.limit || 50);
    // Deduplicate artists from album list (multiple albums by same artist)
    const artistMap = new Map<string, { name: string; mbid?: string }>();
    for (const album of result.albums) {
      const key = album.artist.name.toLowerCase();
      if (!artistMap.has(key)) {
        artistMap.set(key, { name: album.artist.name, mbid: album.artist.mbid });
      }
    }
    return artistResult(
      Array.from(artistMap.values()).map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: `lastfm-tag-albums-${tag}`,
      })),
    );
  },
};

/** lastfm_tag_similar – artists from genres related to a seed tag. */
const lastfmTagSimilar: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const tag = context.config.tag;
    if (!tag) throw new Error('Missing required config: tag');
    const relatedTagLimit = context.config.relatedTagLimit || 5;
    const limitPerTag = context.config.limitPerTag || 30;

    // Get related tags
    const relatedTags = await lastfm.getTagSimilar(tag);
    const tagsToFetch = relatedTags.slice(0, relatedTagLimit).map(t => t.name);

    // Early return if no related tags found
    if (tagsToFetch.length === 0) {
      return artistResult([]);
    }

    // Collect artists from each related tag
    const artistMap = new Map<string, { name: string; mbid?: string; tagCount: number }>();
    for (const relatedTag of tagsToFetch) {
      try {
        const result = await lastfm.getTagTopArtists(relatedTag, limitPerTag);
        for (const a of result.artists) {
          const key = a.name.toLowerCase();
          const existing = artistMap.get(key);
          if (existing) {
            existing.tagCount++;
          } else {
            artistMap.set(key, { name: a.name, mbid: a.mbid, tagCount: 1 });
          }
        }
      } catch {
        // Skip failed tag lookups
      }
    }

    // Sort by tagCount (appears in multiple related genres), then alphabetically
    const sorted = Array.from(artistMap.values())
      .sort((a, b) => b.tagCount - a.tagCount || a.name.localeCompare(b.name))
      .slice(0, context.config.limit || 100);

    return artistResult(
      sorted.map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: `lastfm-tag-similar-${tag}`,
      })),
    );
  },
};

/** lastfm_user_albums – artists from user's top scrobbled albums. */
const lastfmUserAlbums: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const username = getLastfmUsername(context);
    const period = context.config.period || 'overall';
    const limit = context.config.limit || 100;
    const result = await lastfm.getUserTopAlbums(username, period, limit);
    // Deduplicate artists
    const artistMap = new Map<string, { name: string; mbid?: string }>();
    for (const album of result.albums) {
      const key = album.artist.name.toLowerCase();
      if (!artistMap.has(key)) {
        artistMap.set(key, { name: album.artist.name, mbid: album.artist.mbid });
      }
    }
    return artistResult(
      Array.from(artistMap.values()).map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: `lastfm-user-albums-${period}`,
      })),
    );
  },
};

/** lastfm_weekly_artists – user's most-played artists this week. */
const lastfmWeeklyArtists: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const username = getLastfmUsername(context);
    const result = await lastfm.getUserWeeklyArtistChart(username);
    return artistResult(
      result.artists.map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: 'lastfm-weekly-artists',
      })),
    );
  },
};

/** lastfm_weekly_albums – artists from user's most-played albums this week. */
const lastfmWeeklyAlbums: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const username = getLastfmUsername(context);
    const result = await lastfm.getUserWeeklyAlbumChart(username);
    // Extract and deduplicate artists — weekly album chart uses '#text' for artist name
    const artistMap = new Map<string, { name: string; mbid?: string }>();
    for (const album of result.albums) {
      const artistName = album.artist['#text'];
      const key = artistName.toLowerCase();
      if (!artistMap.has(key)) {
        artistMap.set(key, { name: artistName, mbid: album.artist.mbid });
      }
    }
    return artistResult(
      Array.from(artistMap.values()).map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: 'lastfm-weekly-albums',
      })),
    );
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerStrategy('lastfm_chart', lastfmChart);
registerStrategy('lastfm_tag', lastfmTag);
registerStrategy('lastfm_geo', lastfmGeo);
registerStrategy('lastfm_library', lastfmLibrary);
registerStrategy('lastfm_similar', lastfmSimilar);
registerStrategy('lastfm_tag_albums', lastfmTagAlbums);
registerStrategy('lastfm_tag_similar', lastfmTagSimilar);
registerStrategy('lastfm_user_albums', lastfmUserAlbums);
registerStrategy('lastfm_weekly_artists', lastfmWeeklyArtists);
registerStrategy('lastfm_weekly_albums', lastfmWeeklyAlbums);
