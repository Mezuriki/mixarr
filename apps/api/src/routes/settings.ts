import { Router } from 'express';
import prisma from '../lib/db.js';
import { getBaseUrl } from '../lib/settings.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('SettingsRoute');

export const settingsRouter = Router();

// Public endpoint - get base URL (needed for OAuth redirect URI display)
settingsRouter.get('/base-url', async (_req, res) => {
  try {
    const baseUrl = await getBaseUrl();
    res.json({ baseUrl });
  } catch (error) {
    logger.error('Failed to get base URL', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to get base URL' });
  }
});

// Public endpoint - set base URL during setup
settingsRouter.post('/base-url', async (req, res) => {
  try {
    const { baseUrl } = req.body;
    
    if (!baseUrl || typeof baseUrl !== 'string') {
      res.status(400).json({ error: 'baseUrl is required' });
      return;
    }

    await prisma.globalSetting.upsert({
      where: { key: 'baseUrl' },
      create: { key: 'baseUrl', value: baseUrl },
      update: { value: baseUrl },
    });
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to set base URL', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to set base URL' });
  }
});

settingsRouter.use(requireAuth);

// Get user settings
settingsRouter.get('/', async (req, res) => {
  try {
    const settings = await prisma.userSetting.findMany({
      where: { userId: req.user!.id },
    });
    
    const settingsMap: Record<string, any> = {};
    for (const setting of settings) {
      settingsMap[setting.key] = setting.value;
    }
    
    res.json({ settings: settingsMap });
  } catch (error) {
    logger.error('Failed to fetch settings', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update user setting
settingsRouter.put('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    
    await prisma.userSetting.upsert({
      where: {
        userId_key: { userId: req.user!.id, key },
      },
      create: {
        userId: req.user!.id,
        key,
        value,
      },
      update: { value },
    });
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to update setting', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { key },
    });
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// Get user preferences (convenience endpoint)
settingsRouter.get('/preferences', async (req, res) => {
  try {
    const defaults = {
      theme: 'system',
      sidebarCollapsed: false,
      defaultResultHandling: 'preview',
    };
    
    const setting = await prisma.userSetting.findUnique({
      where: {
        userId_key: { userId: req.user!.id, key: 'preferences' },
      },
    });
    
    res.json({ preferences: { ...defaults, ...(setting?.value as object || {}) } });
  } catch (error) {
    logger.error('Failed to fetch preferences', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// Update user preferences
settingsRouter.put('/preferences', async (req, res) => {
  try {
    const { preferences } = req.body;
    
    const existing = await prisma.userSetting.findUnique({
      where: {
        userId_key: { userId: req.user!.id, key: 'preferences' },
      },
    });
    
    const merged = { ...(existing?.value as object || {}), ...preferences };
    
    await prisma.userSetting.upsert({
      where: {
        userId_key: { userId: req.user!.id, key: 'preferences' },
      },
      create: {
        userId: req.user!.id,
        key: 'preferences',
        value: merged,
      },
      update: { value: merged },
    });
    
    res.json({ success: true, preferences: merged });
  } catch (error) {
    logger.error('Failed to update preferences', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Admin: Get global settings
settingsRouter.get('/global', requireAdmin, async (_req, res) => {
  try {
    const settings = await prisma.globalSetting.findMany();
    
    const settingsMap: Record<string, any> = {};
    for (const setting of settings) {
      settingsMap[setting.key] = setting.value;
    }
    
    res.json({ settings: settingsMap });
  } catch (error) {
    logger.error('Failed to fetch global settings', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to fetch global settings' });
  }
});

// Admin: Update global setting
settingsRouter.put('/global/:key', requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    
    await prisma.globalSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to update global setting', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { key },
    });
    res.status(500).json({ error: 'Failed to update global setting' });
  }
});
