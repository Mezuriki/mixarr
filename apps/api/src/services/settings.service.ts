/**
 * Settings Service
 * 
 * Business logic for user and global settings management.
 * Extracted from routes/settings.ts per SOC-005.
 */

import prisma from '../lib/db.js';
import { getBaseUrl as getConfiguredBaseUrl } from '../lib/settings.js';
import { createLogger } from '../lib/logger.js';
import type { JsonValue } from '@prisma/client/runtime/library';

const logger = createLogger('SettingsService');

/**
 * Default user preferences
 */
export const DEFAULT_USER_PREFERENCES = {
  theme: 'system',
  sidebarCollapsed: false,
  defaultResultHandling: 'preview',
} as const;

export type UserPreferences = typeof DEFAULT_USER_PREFERENCES;

export class SettingsService {
  // ============================================================================
  // Base URL (Global)
  // ============================================================================

  /**
   * Get the configured base URL
   */
  static async getBaseUrl(): Promise<string> {
    return getConfiguredBaseUrl();
  }

  /**
   * Set the base URL
   */
  static async setBaseUrl(baseUrl: string): Promise<void> {
    await prisma.globalSetting.upsert({
      where: { key: 'baseUrl' },
      create: { key: 'baseUrl', value: baseUrl },
      update: { value: baseUrl },
    });
  }

  // ============================================================================
  // User Settings
  // ============================================================================

  /**
   * Get all settings for a user as a key-value map
   */
  static async getUserSettings(userId: number): Promise<Record<string, JsonValue>> {
    const settings = await prisma.userSetting.findMany({
      where: { userId },
    });

    const settingsMap: Record<string, JsonValue> = {};
    for (const setting of settings) {
      settingsMap[setting.key] = setting.value;
    }

    return settingsMap;
  }

  /**
   * Get a specific user setting
   */
  static async getUserSetting(userId: number, key: string): Promise<JsonValue | null> {
    const setting = await prisma.userSetting.findUnique({
      where: { userId_key: { userId, key } },
    });

    return setting?.value ?? null;
  }

  /**
   * Set a user setting (upsert)
   */
  static async setUserSetting(userId: number, key: string, value: JsonValue): Promise<void> {
    await prisma.userSetting.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, value },
      update: { value },
    });
  }

  // ============================================================================
  // User Preferences (special case of user settings)
  // ============================================================================

  /**
   * Get user preferences with defaults
   */
  static async getUserPreferences(userId: number): Promise<UserPreferences & Record<string, unknown>> {
    const setting = await prisma.userSetting.findUnique({
      where: { userId_key: { userId, key: 'preferences' } },
    });

    const stored = (setting?.value as object) || {};
    return { ...DEFAULT_USER_PREFERENCES, ...stored };
  }

  /**
   * Update user preferences (merge with existing)
   */
  static async updateUserPreferences(
    userId: number,
    updates: Partial<UserPreferences> & Record<string, unknown>
  ): Promise<UserPreferences & Record<string, unknown>> {
    const existing = await prisma.userSetting.findUnique({
      where: { userId_key: { userId, key: 'preferences' } },
    });

    const merged = {
      ...DEFAULT_USER_PREFERENCES,
      ...((existing?.value as object) || {}),
      ...updates,
    };

    await prisma.userSetting.upsert({
      where: { userId_key: { userId, key: 'preferences' } },
      create: { userId, key: 'preferences', value: merged },
      update: { value: merged },
    });

    return merged;
  }

  // ============================================================================
  // Global Settings (Admin only)
  // ============================================================================

  /**
   * Get all global settings as a key-value map
   */
  static async getGlobalSettings(): Promise<Record<string, JsonValue>> {
    const settings = await prisma.globalSetting.findMany();

    const settingsMap: Record<string, JsonValue> = {};
    for (const setting of settings) {
      settingsMap[setting.key] = setting.value;
    }

    return settingsMap;
  }

  /**
   * Get a specific global setting
   */
  static async getGlobalSetting(key: string): Promise<JsonValue | null> {
    const setting = await prisma.globalSetting.findUnique({
      where: { key },
    });

    return setting?.value ?? null;
  }

  /**
   * Set a global setting (upsert)
   */
  static async setGlobalSetting(key: string, value: JsonValue): Promise<void> {
    await prisma.globalSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}

// Export a default instance for convenience
export const settingsService = SettingsService;
