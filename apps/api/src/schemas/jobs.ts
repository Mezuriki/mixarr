import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

/**
 * Valid queue names matching QUEUE_NAMES from jobs/queue.ts
 */
export const VALID_QUEUES = ['subscription', 'import'] as const;

/**
 * Valid result handling modes matching Prisma ResultHandling enum
 */
export const VALID_RESULT_HANDLING = [
  'preview',
  'queue',
  'auto',
  'slskd_preview',
  'slskd_queue',
  'slskd_auto',
] as const;

// ============================================================================
// Param schemas
// ============================================================================

/**
 * Params schema for GET /status/:queue/:jobId
 */
export const jobStatusParamsSchema = z.object({
  queue: z.enum(VALID_QUEUES),
  jobId: z.string().min(1, 'Job ID is required'),
});

/**
 * Params schema for GET /recent/:queue
 */
export const recentJobsParamsSchema = z.object({
  queue: z.enum(VALID_QUEUES),
});

/**
 * Params schema for routes with :id (run subscription, run import, history)
 */
export const jobIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'ID must be a positive integer'),
});

// ============================================================================
// Query schemas
// ============================================================================

/**
 * Query schema for endpoints that accept a limit parameter.
 * Kept as string to match Express query param behavior;
 * the handler converts with parseInt().
 */
export const limitQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/, 'Must be a positive number').optional(),
});

// ============================================================================
// Body schemas
// ============================================================================

/**
 * Body schema for POST /run/import/:id
 */
export const runImportBodySchema = z.object({
  mode: z.enum(VALID_RESULT_HANDLING).optional(),
});
