/**
 * Settings Helper
 * 
 * Provides easy access to global and user settings
 */

import prisma from './db.js';

const SLSKD_RATE_LIMITING_KEY = 'slskd_rate_limiting_enabled';

/**
 * Get a global setting value
 */
export async function getGlobalSetting<T = string>(key: string, defaultValue?: T): Promise<T | undefined> {
  const setting = await prisma.globalSetting.findUnique({
    where: { key },
  });
  
  if (!setting) {
    return defaultValue;
  }
  
  return setting.value as T;
}

/**
 * Set a global setting value
 */
export async function setGlobalSetting(key: string, value: any): Promise<void> {
  await prisma.globalSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/**
 * Get the base URL for OAuth callbacks and external links
 * Falls back to env var, then localhost
 */
export async function getBaseUrl(): Promise<string> {
  const dbValue = await getGlobalSetting<string>('baseUrl');
  if (dbValue) return dbValue;
  
  return process.env.BASE_URL || `http://localhost:${process.env.PORT || 3010}`;
}

/**
 * Check if slskd rate limiting is enabled
 * @returns true if rate limiting is enabled, false otherwise
 * @throws PrismaClientKnownRequestError if database query fails
 */
export async function isSlskdRateLimitingEnabled(): Promise<boolean> {
  const setting = await prisma.globalSetting.findUnique({
    where: { key: SLSKD_RATE_LIMITING_KEY },
  });
  
  // If setting doesn't exist, return false (safe default)
  // If setting exists, check if value is true
  return setting?.value === true;
}
