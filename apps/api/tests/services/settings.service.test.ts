/**
 * Settings Service Tests
 * 
 * Tests for SettingsService (SOC-005)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsService, DEFAULT_USER_PREFERENCES } from '../../src/services/settings.service.js';
import prisma from '../../src/lib/db.js';

// Mock prisma
vi.mock('../../src/lib/db.js', () => ({
  default: {
    globalSetting: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    userSetting: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

// Mock settings lib
vi.mock('../../src/lib/settings.js', () => ({
  getBaseUrl: vi.fn().mockResolvedValue('http://localhost:3010'),
}));

describe('SettingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBaseUrl', () => {
    it('should return the configured base URL', async () => {
      const result = await SettingsService.getBaseUrl();
      expect(result).toBe('http://localhost:3010');
    });
  });

  describe('setBaseUrl', () => {
    it('should upsert the base URL setting', async () => {
      await SettingsService.setBaseUrl('https://mixarr.example.com');
      
      expect(prisma.globalSetting.upsert).toHaveBeenCalledWith({
        where: { key: 'baseUrl' },
        create: { key: 'baseUrl', value: 'https://mixarr.example.com' },
        update: { value: 'https://mixarr.example.com' },
      });
    });
  });

  describe('getUserSettings', () => {
    it('should return all user settings as a map', async () => {
      vi.mocked(prisma.userSetting.findMany).mockResolvedValue([
        { id: 1, userId: 1, key: 'theme', value: 'dark' },
        { id: 2, userId: 1, key: 'language', value: 'en' },
      ] as any);

      const result = await SettingsService.getUserSettings(1);

      expect(result).toEqual({ theme: 'dark', language: 'en' });
    });

    it('should return empty object when no settings', async () => {
      vi.mocked(prisma.userSetting.findMany).mockResolvedValue([]);

      const result = await SettingsService.getUserSettings(1);

      expect(result).toEqual({});
    });
  });

  describe('setUserSetting', () => {
    it('should upsert a user setting', async () => {
      await SettingsService.setUserSetting(1, 'theme', 'dark');

      expect(prisma.userSetting.upsert).toHaveBeenCalledWith({
        where: { userId_key: { userId: 1, key: 'theme' } },
        create: { userId: 1, key: 'theme', value: 'dark' },
        update: { value: 'dark' },
      });
    });
  });

  describe('getUserPreferences', () => {
    it('should return defaults when no stored preferences', async () => {
      vi.mocked(prisma.userSetting.findUnique).mockResolvedValue(null);

      const result = await SettingsService.getUserPreferences(1);

      expect(result).toEqual(DEFAULT_USER_PREFERENCES);
    });

    it('should merge stored preferences with defaults', async () => {
      vi.mocked(prisma.userSetting.findUnique).mockResolvedValue({
        id: 1,
        userId: 1,
        key: 'preferences',
        value: { theme: 'dark', customSetting: true },
      } as any);

      const result = await SettingsService.getUserPreferences(1);

      expect(result.theme).toBe('dark');
      expect(result.sidebarCollapsed).toBe(false); // from defaults
      expect((result as any).customSetting).toBe(true); // preserved
    });
  });

  describe('updateUserPreferences', () => {
    it('should merge updates with existing preferences', async () => {
      vi.mocked(prisma.userSetting.findUnique).mockResolvedValue({
        id: 1,
        userId: 1,
        key: 'preferences',
        value: { theme: 'dark' },
      } as any);

      const result = await SettingsService.updateUserPreferences(1, {
        sidebarCollapsed: true,
      });

      expect(result.theme).toBe('dark'); // preserved
      expect(result.sidebarCollapsed).toBe(true); // updated
      expect(prisma.userSetting.upsert).toHaveBeenCalled();
    });
  });

  describe('getGlobalSettings', () => {
    it('should return all global settings as a map', async () => {
      vi.mocked(prisma.globalSetting.findMany).mockResolvedValue([
        { id: 1, key: 'baseUrl', value: 'http://localhost' },
        { id: 2, key: 'feature_flag', value: true },
      ] as any);

      const result = await SettingsService.getGlobalSettings();

      expect(result).toEqual({
        baseUrl: 'http://localhost',
        feature_flag: true,
      });
    });
  });

  describe('setGlobalSetting', () => {
    it('should upsert a global setting', async () => {
      await SettingsService.setGlobalSetting('feature_flag', true);

      expect(prisma.globalSetting.upsert).toHaveBeenCalledWith({
        where: { key: 'feature_flag' },
        create: { key: 'feature_flag', value: true },
        update: { value: true },
      });
    });
  });
});
