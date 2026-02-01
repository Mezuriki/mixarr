/**
 * API Response DTOs
 * 
 * Data Transfer Objects for API responses.
 * These define the exact shape of data returned by API endpoints,
 * ensuring we don't leak Prisma model internals (SOC-007).
 * 
 * Benefits:
 * - Explicit contract between API and frontend
 * - Prevents accidental data leakage (passwords, tokens, etc.)
 * - Decouples API response shape from database schema
 * - Type-safe transformations
 */

export * from './connection.dto.js';
export * from './user.dto.js';
export * from './subscription.dto.js';
export * from './notification.dto.js';
