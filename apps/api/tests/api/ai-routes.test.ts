/**
 * AI Routes API Tests
 * 
 * Tests for AI settings endpoints including Ollama support
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { aiRouter } from '../../src/routes/ai.js';

// Mock dependencies
vi.mock('../../src/lib/db.js', () => ({
  default: {
    aISettings: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../../src/services/ai.js', () => ({
  aiService: {
    loadSettings: vi.fn(),
    getRecommendations: vi.fn(),
    isAvailable: vi.fn(),
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 1, username: 'test', role: 'user' };
    next();
  }),
  requireAdmin: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 1, username: 'test', role: 'admin' };
    next();
  }),
}));

import prisma from '../../src/lib/db.js';
import { aiService } from '../../src/services/ai.js';

const app = express();
app.use(express.json());
app.use('/api/ai', aiRouter);

describe('AI Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/ai/settings', () => {
    it('should return default settings when none exist', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue(null);

      const res = await request(app).get('/api/ai/settings');

      expect(res.status).toBe(200);
      expect(res.body.settings).toEqual({
        openaiEnabled: false,
        openaiConfigured: false,
        openaiBaseUrl: null,
        openaiModel: null,
        anthropicEnabled: false,
        anthropicConfigured: false,
      });
    });

    it('should return settings for admin user', async () => {
      // Override requireAuth to return admin user
      const { requireAuth } = await import('../../src/middleware/auth.js');
      vi.mocked(requireAuth).mockImplementation((req: any, _res: any, next: any) => {
        req.user = { id: 1, username: 'admin', role: 'admin' };
        next();
      });

      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue({
        id: 1,
        openaiApiKey: 'sk-test-key',
        openaiEnabled: true,
        openaiStrategy: 'similar',
        openaiBaseUrl: 'http://localhost:11434/v1',
        openaiModel: 'llama3.2',
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app).get('/api/ai/settings');

      expect(res.status).toBe(200);
      expect(res.body.settings.openaiApiKey).toBe('sk-test-key');
      expect(res.body.settings.openaiBaseUrl).toBe('http://localhost:11434/v1');
      expect(res.body.settings.openaiModel).toBe('llama3.2');
      expect(res.body.settings.openaiConfigured).toBe(true);
    });

    it('should hide API keys for non-admin users', async () => {
      // Override requireAuth to return non-admin user
      const { requireAuth } = await import('../../src/middleware/auth.js');
      vi.mocked(requireAuth).mockImplementation((req: any, _res: any, next: any) => {
        req.user = { id: 2, username: 'user', role: 'user' };
        next();
      });

      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue({
        id: 1,
        openaiApiKey: 'sk-test-key',
        openaiEnabled: true,
        openaiStrategy: 'similar',
        openaiBaseUrl: 'http://localhost:11434/v1',
        openaiModel: 'llama3.2',
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app).get('/api/ai/settings');

      expect(res.status).toBe(200);
      expect(res.body.settings.openaiApiKey).toBeUndefined();
      expect(res.body.settings.openaiBaseUrl).toBeUndefined();
      expect(res.body.settings.openaiModel).toBeUndefined();
      expect(res.body.settings.openaiConfigured).toBe(true);
    });

    it('should mark OpenAI as configured when base URL is set (Ollama mode)', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue({
        id: 1,
        openaiApiKey: null,
        openaiEnabled: true,
        openaiStrategy: 'similar',
        openaiBaseUrl: 'http://localhost:11434/v1',
        openaiModel: 'llama3.2',
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app).get('/api/ai/settings');

      expect(res.status).toBe(200);
      expect(res.body.settings.openaiConfigured).toBe(true);
    });
  });

  describe('PUT /api/ai/settings', () => {
    it('should create new settings with Ollama configuration', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.aISettings.create).mockResolvedValue({
        id: 1,
        openaiApiKey: null,
        openaiEnabled: true,
        openaiStrategy: 'similar',
        openaiBaseUrl: 'http://localhost:11434/v1',
        openaiModel: 'llama3.2',
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiEnabled: true,
          openaiBaseUrl: 'http://localhost:11434/v1',
          openaiModel: 'llama3.2',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.settings.openaiConfigured).toBe(true);
      expect(prisma.aISettings.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          openaiEnabled: true,
          openaiBaseUrl: 'http://localhost:11434/v1',
          openaiModel: 'llama3.2',
        }),
      });
      expect(aiService.loadSettings).toHaveBeenCalled();
    });

    it('should update existing settings with Ollama configuration', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue({
        id: 1,
        openaiApiKey: 'sk-old-key',
        openaiEnabled: false,
        openaiStrategy: 'similar',
        openaiBaseUrl: null,
        openaiModel: null,
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.aISettings.update).mockResolvedValue({
        id: 1,
        openaiApiKey: null,
        openaiEnabled: true,
        openaiStrategy: 'similar',
        openaiBaseUrl: 'http://localhost:11434/v1',
        openaiModel: 'llama3.2',
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiEnabled: true,
          openaiBaseUrl: 'http://localhost:11434/v1',
          openaiModel: 'llama3.2',
          openaiApiKey: null, // Clear API key when using Ollama
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.settings.openaiConfigured).toBe(true);
      expect(prisma.aISettings.update).toHaveBeenCalled();
      expect(aiService.loadSettings).toHaveBeenCalled();
    });

    it('should reject invalid URL format', async () => {
      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiBaseUrl: 'not-a-valid-url',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid OpenAI base URL format');
    });

    it('should accept valid URLs including localhost', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.aISettings.create).mockResolvedValue({
        id: 1,
        openaiApiKey: null,
        openaiEnabled: true,
        openaiStrategy: 'similar',
        openaiBaseUrl: 'http://localhost:11434/v1',
        openaiModel: null,
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiBaseUrl: 'http://localhost:11434/v1',
        });

      expect(res.status).toBe(200);
    });

    it('should accept valid URLs including IP addresses', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.aISettings.create).mockResolvedValue({
        id: 1,
        openaiApiKey: null,
        openaiEnabled: true,
        openaiStrategy: 'similar',
        openaiBaseUrl: 'http://192.168.1.100:11434/v1',
        openaiModel: null,
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiBaseUrl: 'http://192.168.1.100:11434/v1',
        });

      expect(res.status).toBe(200);
    });

    it('should validate model name length', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.aISettings.create).mockResolvedValue({
        id: 1,
        openaiApiKey: null,
        openaiEnabled: true,
        openaiStrategy: 'similar',
        openaiBaseUrl: null,
        openaiModel: 'a'.repeat(100),
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiModel: 'a'.repeat(100), // Max length
        });

      expect(res.status).toBe(200);
    });

    it('should reject model names longer than 100 characters with 400 error', async () => {
      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiModel: 'a'.repeat(101), // Too long
        });

      // Should return 400 with clear error message (not silently truncate)
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('100 characters');
    });

    // Security: URL scheme validation (SSRF prevention)
    it('should reject file:// URLs to prevent SSRF', async () => {
      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiBaseUrl: 'file:///etc/passwd',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('http or https');
    });

    it('should reject javascript: URLs to prevent SSRF', async () => {
      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiBaseUrl: 'javascript:alert(1)',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('http or https');
    });

    it('should reject ftp:// URLs to prevent SSRF', async () => {
      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiBaseUrl: 'ftp://example.com/file',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('http or https');
    });

    // Security: URL length limit (DoS prevention)
    it('should reject URLs longer than 2048 characters', async () => {
      const longUrl = 'http://example.com/' + 'a'.repeat(2048);
      
      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiBaseUrl: longUrl,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('too long');
    });

    // Security: Model name character validation
    it('should reject model names with newline characters', async () => {
      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiModel: 'llama3.2\n\ninjected',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid model name');
    });

    it('should reject model names with control characters', async () => {
      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiModel: 'llama3.2\x00null',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid model name');
    });

    it('should accept valid model names with dots, dashes, colons', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.aISettings.create).mockResolvedValue({
        id: 1,
        openaiApiKey: null,
        openaiEnabled: true,
        openaiStrategy: 'similar',
        openaiBaseUrl: null,
        openaiModel: 'meta-llama:llama-3.2-8b_q4',
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiModel: 'meta-llama:llama-3.2-8b_q4',
        });

      expect(res.status).toBe(200);
    });

    it('should allow clearing base URL and model', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue({
        id: 1,
        openaiApiKey: null,
        openaiEnabled: true,
        openaiStrategy: 'similar',
        openaiBaseUrl: 'http://localhost:11434/v1',
        openaiModel: 'llama3.2',
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.aISettings.update).mockResolvedValue({
        id: 1,
        openaiApiKey: null,
        openaiEnabled: true,
        openaiStrategy: 'similar',
        openaiBaseUrl: null,
        openaiModel: null,
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiBaseUrl: '',
          openaiModel: '',
        });

      expect(res.status).toBe(200);
      expect(prisma.aISettings.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          openaiBaseUrl: null,
          openaiModel: null,
        }),
      });
    });

    // Security: URL credential validation
    it('should reject URLs with embedded username', async () => {
      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiBaseUrl: 'http://user@localhost:11434/v1',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('credentials');
    });

    it('should reject URLs with embedded username and password', async () => {
      const res = await request(app)
        .put('/api/ai/settings')
        .send({
          openaiBaseUrl: 'http://user:pass@localhost:11434/v1',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('credentials');
    });
  });

  describe('GET /api/ai/settings error handling', () => {
    it('should handle Prisma errors gracefully', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockRejectedValue(
        new Error('Database connection failed')
      );

      const res = await request(app).get('/api/ai/settings');

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('POST /api/ai/test', () => {
    it('should test OpenAI connection', async () => {
      vi.mocked(aiService.isAvailable).mockResolvedValue(true);
      vi.mocked(aiService.getRecommendations).mockResolvedValue([
        { name: 'Test Artist', source: 'openai', strategy: 'similar' },
      ]);

      const res = await request(app)
        .post('/api/ai/test')
        .send({ provider: 'openai' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('openai');
    });

    it('should reject invalid provider', async () => {
      const res = await request(app)
        .post('/api/ai/test')
        .send({ provider: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('openai or anthropic');
    });
  });

  describe('GET /api/ai/status', () => {
    it('should return available status when Ollama is configured', async () => {
      vi.mocked(aiService.isAvailable).mockResolvedValue(true);

      const res = await request(app).get('/api/ai/status');

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(true);
    });

    it('should return unavailable status when no AI is configured', async () => {
      vi.mocked(aiService.isAvailable).mockResolvedValue(false);

      const res = await request(app).get('/api/ai/status');

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(false);
    });
  });
});
