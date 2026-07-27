import { z } from 'zod';

// Valid connection types
export const connectionTypes = [
  'lidarr',
  'spotify',
  'lastfm',
  'tautulli',
  'deezer',
  'tidal',
  'listenbrainz',
  'discogs',
  'jellyfin',
  'slskd',
  'navidrome',
] as const;

export type ConnectionType = (typeof connectionTypes)[number];

// Config schemas for each connection type (for reference/documentation)
export const lidarrConfigSchema = z.object({
  url: z.string().url(),
  apiKey: z.string(),
});

// Navidrome is a Subsonic-compatible server. The native /api/ai/* endpoints
// share the same URL/user as the Subsonic API, so a single set of credentials
// covers both library reads (Subsonic) and AI orchestration (native API).
export const navidromeConfigSchema = z.object({
  url: z.string().url(),
  username: z.string(),
  password: z.string(),
});

export const lastfmConfigSchema = z.object({
  apiKey: z.string(),
});

export const tautulliConfigSchema = z.object({
  tautulliUrl: z.string().url(),
  tautulliApiKey: z.string(),
  plexLibraryId: z.number().int().optional(),
  plexUserId: z.number().int().optional(),
});

export const jellyfinConfigSchema = z.object({
  jellyfinUrl: z.string().url(),
  jellyfinApiKey: z.string(),
  jellyfinUserId: z.string().optional(),
  jellyfinLibraryId: z.string().optional(),
});

export const slskdConfigSchema = z.object({
  url: z.string().url(),
  apiKey: z.string(),
  downloadDir: z.string(),
  musicLibraryDir: z.string(),
  // Quality profile
  minQuality: z.enum(['any', 'mp3-128', 'mp3-256', 'mp3-320', 'lossless']).default('mp3-320'),
  preferredQuality: z.enum(['highest', 'flac', 'mp3-320', 'mp3-256']).default('highest'),
  requireCompleteAlbums: z.boolean().default(false),
  minTrackCount: z.number().int().min(1).default(3),
  minSourceFiles: z.number().int().min(0).default(100),
  // Rate limits
  artistsPerRun: z.number().int().min(1).max(100).default(25),
  searchDelaySeconds: z.number().int().min(5).max(120).default(30),
});

export const listenbrainzConfigSchema = z.object({
  username: z.string(),
  token: z.string().optional(),
});

// Schema for POST /connections
export const createConnectionSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(connectionTypes),
  isActive: z.boolean().default(true),
  config: z.record(z.unknown()),
});

// Schema for PUT /connections/:id
export const updateConnectionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

// Schema for POST /connections/test
export const testConnectionSchema = z.object({
  type: z.enum(connectionTypes),
  config: z.record(z.unknown()),
});

// Export inferred types
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
export type TestConnectionInput = z.infer<typeof testConnectionSchema>;
