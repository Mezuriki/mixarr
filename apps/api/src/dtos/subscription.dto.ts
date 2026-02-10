/**
 * Subscription DTOs
 * 
 * API response shapes for subscription-related endpoints.
 */

import type { Subscription, SubscriptionType, ResultHandling } from '@prisma/client';

/**
 * Subscription response for list/detail endpoints
 */
export interface SubscriptionResponseDto {
  id: number;
  userId: number;
  name: string;
  type: SubscriptionType;
  config: SubscriptionConfigDto;
  resultHandling: ResultHandling;
  schedule: string | null;
  isActive: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Subscription config - type-specific configuration
 */
export interface SubscriptionConfigDto {
  // Common
  limit?: number;
  
  // Last.fm
  chartType?: string;
  period?: string;
  country?: string;
  tag?: string;
  
  // Spotify
  playlistId?: string;
  publicPlaylistUrl?: string;
  
  // ListenBrainz
  listenbrainzPlaylistId?: string;
  listenbrainzSeedMbid?: string;
  
  // Bandcamp
  bandcampTag?: string;
  
  // Discogs
  labelId?: string;
  discogsStyle?: string;
  
  // AI
  seedArtists?: string[];
  prompt?: string;
  
  [key: string]: string | number | boolean | string[] | undefined;
}

/**
 * Subscription with run counts for list views
 */
export interface SubscriptionWithStatsDto extends SubscriptionResponseDto {
  runCount: number;
  successCount: number;
  lastRunStatus: 'success' | 'failed' | 'running' | null;
}

/**
 * Transform a Prisma Subscription to API response DTO
 */
export function toSubscriptionDto(subscription: Subscription): SubscriptionResponseDto {
  const config = (subscription.config ?? {}) as SubscriptionConfigDto;
  
  return {
    id: subscription.id,
    userId: subscription.userId,
    name: subscription.name,
    type: subscription.type,
    config,
    resultHandling: subscription.resultHandling,
    schedule: subscription.schedule,
    isActive: subscription.isActive,
    lastRun: subscription.lastRun,
    nextRun: subscription.nextRun,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}

/**
 * Transform multiple subscriptions to DTOs
 */
export function toSubscriptionDtoList(subscriptions: Subscription[]): SubscriptionResponseDto[] {
  return subscriptions.map(toSubscriptionDto);
}
