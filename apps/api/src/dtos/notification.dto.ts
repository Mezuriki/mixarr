/**
 * Notification DTOs
 * 
 * API response shapes for notification-related endpoints.
 */

import type { NotificationChannel } from '@prisma/client';

/**
 * Notification channel types
 */
export type NotificationChannelType = 'discord' | 'webhook' | 'telegram' | 'pushover' | 'email';

/**
 * Notification channel response for list/detail endpoints
 * Sensitive webhook URLs are partially masked
 */
export interface NotificationChannelResponseDto {
  id: number;
  userId: number;
  type: NotificationChannelType;
  name: string;
  config: NotificationChannelConfigDto;
  events: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Channel config - type-specific with masked sensitive URLs
 */
export interface NotificationChannelConfigDto {
  // Discord
  webhookUrl?: string;
  username?: string;
  avatarUrl?: string;
  
  // Generic webhook
  url?: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  
  [key: string]: string | Record<string, string> | undefined;
}

/**
 * Mask a webhook URL to show only domain
 * https://discord.com/api/webhooks/123/abc -> https://discord.com/api/webhooks/••••
 */
function maskWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/');
    // Keep first 3 parts of path, mask the rest
    const maskedPath = pathParts.slice(0, 4).join('/') + (pathParts.length > 4 ? '/••••' : '');
    return `${parsed.origin}${maskedPath}`;
  } catch {
    return '••••';
  }
}

/**
 * Transform a Prisma NotificationChannel to API response DTO
 */
export function toNotificationChannelDto(channel: NotificationChannel): NotificationChannelResponseDto {
  const rawConfig = (channel.config ?? {}) as Record<string, unknown>;
  const config: NotificationChannelConfigDto = {};
  
  // Copy non-sensitive fields
  if (rawConfig.username) config.username = String(rawConfig.username);
  if (rawConfig.avatarUrl) config.avatarUrl = String(rawConfig.avatarUrl);
  if (rawConfig.method) config.method = rawConfig.method as 'POST' | 'PUT';
  if (rawConfig.headers) config.headers = rawConfig.headers as Record<string, string>;
  
  // Mask webhook URLs
  if (rawConfig.webhookUrl) {
    config.webhookUrl = maskWebhookUrl(String(rawConfig.webhookUrl));
  }
  if (rawConfig.url) {
    config.url = maskWebhookUrl(String(rawConfig.url));
  }
  
  return {
    id: channel.id,
    userId: channel.userId,
    type: channel.type as NotificationChannelType,
    name: channel.name,
    config,
    events: (Array.isArray(channel.events) ? channel.events : []) as string[],
    isActive: channel.isActive,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}

/**
 * Transform multiple notification channels to DTOs
 */
export function toNotificationChannelDtoList(channels: NotificationChannel[]): NotificationChannelResponseDto[] {
  return channels.map(toNotificationChannelDto);
}
