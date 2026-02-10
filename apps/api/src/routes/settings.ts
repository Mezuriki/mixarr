import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { createLogger } from '../lib/logger.js';
import { SettingsService } from '../services/settings.service.js';

const logger = createLogger('SettingsRoute');

export const settingsRouter = Router();

// Public endpoint - get base URL (needed for OAuth redirect URI display)
settingsRouter.get('/base-url', async (_req, res) => {
  try {
    const baseUrl = await SettingsService.getBaseUrl();
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

    await SettingsService.setBaseUrl(baseUrl);
    
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
    const settings = await SettingsService.getUserSettings(req.user!.id);
    res.json({ settings });
  } catch (error) {
    logger.error('Failed to fetch settings', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Bulk update user settings
settingsRouter.put('/', async (req, res) => {
  try {
    const { settings } = req.body;

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      res.status(400).json({ error: 'settings must be a non-empty object' });
      return;
    }

    const entries = Object.entries(settings);
    if (entries.length === 0) {
      res.status(400).json({ error: 'settings must be a non-empty object' });
      return;
    }

    for (const [key, value] of entries) {
      await SettingsService.setUserSetting(req.user!.id, key, value as any);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to bulk update settings', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Update user setting
settingsRouter.put('/:key', async (req, res) => {
  const { key } = req.params;
  try {
    const { value } = req.body;
    
    await SettingsService.setUserSetting(req.user!.id, key, value);
    
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
    const preferences = await SettingsService.getUserPreferences(req.user!.id);
    res.json({ preferences });
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
    
    const merged = await SettingsService.updateUserPreferences(req.user!.id, preferences);
    
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
    const settings = await SettingsService.getGlobalSettings();
    res.json({ settings });
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
  const { key } = req.params;
  try {
    const { value } = req.body;
    
    await SettingsService.setGlobalSetting(key, value);
    
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

