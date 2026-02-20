/**
 * Duplicates API Tests
 *
 * Tests:
 * - Input validation for all endpoints
 * - Query parameter validation (minConfidence)
 * - Body validation (dismiss with UUIDs)
 * - Query validation (guidance with numeric artist IDs)
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mocks required to mount the duplicates router in supertest
// ---------------------------------------------------------------------------

vi.mock('../../src/lib/db.js', () => ({
  default: {
    dismissedDuplicate: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../../src/services/duplicate-detection.js', () => ({
  detectDuplicates: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: any) => {
    _req.user = { id: 1, role: 'user', username: 'testuser' };
    next();
  },
}));

vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../src/lib/connection-resolver.js', () => ({
  getLidarrService: vi.fn().mockResolvedValue(null),
}));

import { duplicatesRouter } from '../../src/routes/duplicates.js';

// =============================================================================
// Input Validation Tests
// =============================================================================

describe('Duplicates API - Input Validation', () => {
  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/duplicates', duplicatesRouter);
    return app;
  }

  describe('GET /api/duplicates', () => {
    it('should reject invalid minConfidence value', async () => {
      const response = await request(buildApp())
        .get('/api/duplicates?minConfidence=invalid');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.minConfidence).toBeDefined();
    });

    it('should accept minConfidence=high', async () => {
      const response = await request(buildApp())
        .get('/api/duplicates?minConfidence=high');

      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });

    it('should accept minConfidence=medium', async () => {
      const response = await request(buildApp())
        .get('/api/duplicates?minConfidence=medium');

      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });

    it('should accept minConfidence=low', async () => {
      const response = await request(buildApp())
        .get('/api/duplicates?minConfidence=low');

      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });

    it('should accept request without minConfidence (optional)', async () => {
      const response = await request(buildApp())
        .get('/api/duplicates');

      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/duplicates/:id/dismiss', () => {
    it('should reject missing mbid1 and mbid2', async () => {
      const response = await request(buildApp())
        .post('/api/duplicates/1/dismiss')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject non-UUID mbid1', async () => {
      const response = await request(buildApp())
        .post('/api/duplicates/1/dismiss')
        .send({
          mbid1: 'not-a-uuid',
          mbid2: '550e8400-e29b-41d4-a716-446655440001',
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.mbid1).toBeDefined();
    });

    it('should reject non-UUID mbid2', async () => {
      const response = await request(buildApp())
        .post('/api/duplicates/1/dismiss')
        .send({
          mbid1: '550e8400-e29b-41d4-a716-446655440000',
          mbid2: 'bad-uuid',
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.mbid2).toBeDefined();
    });

    it('should reject missing mbid2', async () => {
      const response = await request(buildApp())
        .post('/api/duplicates/1/dismiss')
        .send({
          mbid1: '550e8400-e29b-41d4-a716-446655440000',
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.mbid2).toBeDefined();
    });

    it('should accept valid UUIDs', async () => {
      const response = await request(buildApp())
        .post('/api/duplicates/1/dismiss')
        .send({
          mbid1: '550e8400-e29b-41d4-a716-446655440000',
          mbid2: '550e8400-e29b-41d4-a716-446655440001',
        });

      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/duplicates/:id/guidance', () => {
    it('should reject missing artist1Id and artist2Id', async () => {
      const response = await request(buildApp())
        .get('/api/duplicates/1/guidance');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject non-numeric artist1Id', async () => {
      const response = await request(buildApp())
        .get('/api/duplicates/1/guidance?artist1Id=abc&artist2Id=2');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.artist1Id).toBeDefined();
    });

    it('should reject non-numeric artist2Id', async () => {
      const response = await request(buildApp())
        .get('/api/duplicates/1/guidance?artist1Id=1&artist2Id=xyz');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.artist2Id).toBeDefined();
    });

    it('should reject missing artist2Id', async () => {
      const response = await request(buildApp())
        .get('/api/duplicates/1/guidance?artist1Id=1');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.artist2Id).toBeDefined();
    });

    it('should accept valid numeric artist IDs', async () => {
      const response = await request(buildApp())
        .get('/api/duplicates/1/guidance?artist1Id=1&artist2Id=2');

      // Should not be a validation error (400 from "Lidarr not configured" is expected)
      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/duplicates/scan', () => {
    it('should not require any body (no validation needed)', async () => {
      const response = await request(buildApp())
        .post('/api/duplicates/scan');

      // 400 from "Lidarr not configured" is expected, not a validation error
      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/duplicates/cache', () => {
    it('should succeed with no parameters', async () => {
      const response = await request(buildApp())
        .delete('/api/duplicates/cache');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
