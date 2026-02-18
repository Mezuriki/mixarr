import { z } from 'zod';

// ============================================================================
// Query schemas
// ============================================================================

/**
 * Query schema for GET /
 * Filters duplicate results by minimum confidence level.
 */
export const duplicatesQuerySchema = z.object({
  minConfidence: z.enum(['low', 'medium', 'high']).optional(),
});

// ============================================================================
// Body schemas
// ============================================================================

/**
 * Body schema for POST /:id/dismiss
 * Both MBIDs must be valid UUIDs (MusicBrainz artist IDs).
 */
export const dismissDuplicateBodySchema = z.object({
  mbid1: z.string().uuid('mbid1 must be a valid UUID'),
  mbid2: z.string().uuid('mbid2 must be a valid UUID'),
});

// ============================================================================
// Query schemas for guidance
// ============================================================================

/**
 * Query schema for GET /:id/guidance
 * Artist IDs are Lidarr numeric IDs passed as query strings.
 */
export const guidanceQuerySchema = z.object({
  artist1Id: z.string().regex(/^\d+$/, 'artist1Id must be a numeric string'),
  artist2Id: z.string().regex(/^\d+$/, 'artist2Id must be a numeric string'),
});
