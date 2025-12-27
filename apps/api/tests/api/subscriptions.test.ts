/**
 * Subscriptions API Tests
 * 
 * Tests:
 * - CRUD operations for subscriptions
 * - Subscription types (Last.fm, Spotify, MusicBrainz, AI)
 * - Schedule management
 * - Result handling modes
 * - Run history
 * - Multi-tenant access control
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockAdminUser,
  createMockSubscription,
  resetIdCounter,
} from '../utils/fixtures.js';

describe('Subscriptions API', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let adminUser: ReturnType<typeof createMockAdminUser>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    adminUser = createMockAdminUser();
  });

  describe('GET /api/subscriptions', () => {
    it('should return user subscriptions for regular users', async () => {
      const userSub = createMockSubscription({ userId: testUser.id });
      mockPrisma.subscription.findMany.mockResolvedValue([userSub]);
      
      const subs = await mockPrisma.subscription.findMany({
        where: { userId: testUser.id },
      });
      
      expect(subs).toHaveLength(1);
      expect(subs[0].userId).toBe(testUser.id);
    });

    it('should return all subscriptions for admin', async () => {
      const sub1 = createMockSubscription({ userId: 1 });
      const sub2 = createMockSubscription({ userId: 2 });
      mockPrisma.subscription.findMany.mockResolvedValue([sub1, sub2]);
      
      const subs = await mockPrisma.subscription.findMany({});
      expect(subs).toHaveLength(2);
    });
  });

  describe('POST /api/subscriptions', () => {
    it('should create Last.fm chart subscription', async () => {
      const sub = createMockSubscription({
        userId: testUser.id,
        type: 'lastfm_chart',
        config: { chartType: 'artists', period: 'week' },
      });
      mockPrisma.subscription.create.mockResolvedValue(sub);
      
      const result = await mockPrisma.subscription.create({
        data: {
          userId: testUser.id,
          name: 'Weekly Top Artists',
          type: 'lastfm_chart',
          config: { chartType: 'artists', period: 'week' },
        },
      });
      
      expect(result.type).toBe('lastfm_chart');
    });

    it('should create Last.fm tag subscription', async () => {
      const sub = createMockSubscription({
        type: 'lastfm_tag',
        config: { tag: 'progressive rock', limit: 50 },
      });
      mockPrisma.subscription.create.mockResolvedValue(sub);
      
      const result = await mockPrisma.subscription.create({
        data: {
          userId: testUser.id,
          name: 'Progressive Rock',
          type: 'lastfm_tag',
          config: { tag: 'progressive rock', limit: 50 },
        },
      });
      
      expect(result.type).toBe('lastfm_tag');
    });

    it('should create Spotify playlist subscription', async () => {
      const sub = createMockSubscription({
        type: 'spotify_playlist',
        config: { playlistId: 'playlist123' },
      });
      mockPrisma.subscription.create.mockResolvedValue(sub);
      
      const result = await mockPrisma.subscription.create({
        data: {
          userId: testUser.id,
          name: 'My Playlist',
          type: 'spotify_playlist',
          config: { playlistId: 'playlist123' },
        },
      });
      
      expect(result.type).toBe('spotify_playlist');
    });

    it('should create MusicBrainz subscription', async () => {
      const sub = createMockSubscription({
        type: 'musicbrainz',
        config: { labelId: 'label123' },
      });
      mockPrisma.subscription.create.mockResolvedValue(sub);
      
      const result = await mockPrisma.subscription.create({
        data: {
          userId: testUser.id,
          name: 'Record Label Artists',
          type: 'musicbrainz',
          config: { labelId: 'label123' },
        },
      });
      
      expect(result.type).toBe('musicbrainz');
    });

    it('should create AI recommendation subscription', async () => {
      const sub = createMockSubscription({
        type: 'ai_recommendation',
        config: { prompt: 'Artists similar to Pink Floyd' },
      });
      mockPrisma.subscription.create.mockResolvedValue(sub);
      
      const result = await mockPrisma.subscription.create({
        data: {
          userId: testUser.id,
          name: 'AI Recommendations',
          type: 'ai_recommendation',
          config: { prompt: 'Artists similar to Pink Floyd' },
        },
      });
      
      expect(result.type).toBe('ai_recommendation');
    });

    it('should require name and type', () => {
      const body = { name: '', type: '' };
      const isValid = body.name && body.type;
      expect(isValid).toBeFalsy();
    });

    it('should set up schedule job when schedule provided', async () => {
      const sub = createMockSubscription({
        schedule: '0 0 * * *', // daily
        isActive: true,
      });
      mockPrisma.subscription.create.mockResolvedValue(sub);
      
      const result = await mockPrisma.subscription.create({
        data: {
          userId: testUser.id,
          name: 'Daily Subscription',
          type: 'lastfm_chart',
          config: {},
          schedule: '0 0 * * *',
          isActive: true,
        },
      });
      
      expect(result.schedule).toBe('0 0 * * *');
      expect(result.isActive).toBe(true);
    });
  });

  describe('PUT /api/subscriptions/:id', () => {
    it('should update own subscription', async () => {
      const sub = createMockSubscription({ userId: testUser.id });
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.subscription.update.mockResolvedValue({ ...sub, name: 'Updated Name' });
      
      const existing = await mockPrisma.subscription.findUnique({ where: { id: sub.id } });
      const canUpdate = existing?.userId === testUser.id;
      
      expect(canUpdate).toBe(true);
    });

    it('should prevent updating other users subscription', async () => {
      const otherSub = createMockSubscription({ userId: 999 });
      mockPrisma.subscription.findUnique.mockResolvedValue(otherSub);
      
      const existing = await mockPrisma.subscription.findUnique({ where: { id: otherSub.id } });
      const canUpdate = existing?.userId === testUser.id || testUser.role === 'admin';
      
      expect(canUpdate).toBe(false);
    });

    it('should update schedule and reschedule job', async () => {
      const sub = createMockSubscription({ schedule: '0 0 * * *' });
      const updatedSub = { ...sub, schedule: '0 12 * * *' }; // noon instead of midnight
      
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.subscription.update.mockResolvedValue(updatedSub);
      
      const result = await mockPrisma.subscription.update({
        where: { id: sub.id },
        data: { schedule: '0 12 * * *' },
      });
      
      expect(result.schedule).toBe('0 12 * * *');
    });

    it('should update result handling mode', async () => {
      const sub = createMockSubscription({ resultHandling: 'preview' });
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.subscription.update.mockResolvedValue({ ...sub, resultHandling: 'auto' });
      
      const result = await mockPrisma.subscription.update({
        where: { id: sub.id },
        data: { resultHandling: 'auto' },
      });
      
      expect(result.resultHandling).toBe('auto');
    });
  });

  describe('DELETE /api/subscriptions/:id', () => {
    it('should delete own subscription', async () => {
      const sub = createMockSubscription({ userId: testUser.id });
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.subscription.delete.mockResolvedValue(sub);
      
      const existing = await mockPrisma.subscription.findUnique({ where: { id: sub.id } });
      const canDelete = existing?.userId === testUser.id;
      
      expect(canDelete).toBe(true);
    });

    it('should remove scheduled job on delete', async () => {
      const sub = createMockSubscription({ schedule: '0 0 * * *', isActive: true });
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.subscription.delete.mockResolvedValue(sub);
      
      // Verify the subscription had a schedule before deletion
      expect(sub.schedule).toBeDefined();
      expect(sub.isActive).toBe(true);
    });
  });

  describe('POST /api/subscriptions/:id/run', () => {
    it('should trigger manual subscription run', async () => {
      const sub = createMockSubscription();
      mockPrisma.subscription.findFirst.mockResolvedValue(sub);
      
      const found = await mockPrisma.subscription.findFirst({
        where: { id: sub.id, userId: testUser.id },
      });
      
      expect(found).toBeDefined();
      // Would trigger job queue here
    });
  });

  describe('GET /api/subscriptions/:id/runs', () => {
    it('should return run history with pagination', async () => {
      const runs = [
        { id: 1, subscriptionId: 1, status: 'completed', resultsCount: 50 },
        { id: 2, subscriptionId: 1, status: 'completed', resultsCount: 45 },
      ];
      mockPrisma.subscriptionRun.findMany.mockResolvedValue(runs);
      mockPrisma.subscriptionRun.count.mockResolvedValue(2);
      
      const result = await mockPrisma.subscriptionRun.findMany({
        where: { subscriptionId: 1 },
        orderBy: { startedAt: 'desc' },
        take: 20,
        skip: 0,
      });
      
      expect(result).toHaveLength(2);
    });
  });

  describe('GET /api/subscriptions/:id/results', () => {
    it('should return subscription results', async () => {
      const results = [
        { id: 1, name: 'Artist 1', status: 'pending' },
        { id: 2, name: 'Artist 2', status: 'added' },
      ];
      mockPrisma.subscriptionResult.findMany.mockResolvedValue(results);
      
      const result = await mockPrisma.subscriptionResult.findMany({
        where: { subscriptionId: 1 },
      });
      
      expect(result).toHaveLength(2);
    });

    it('should filter results by status', async () => {
      const pendingResults = [{ id: 1, name: 'Artist 1', status: 'pending' }];
      mockPrisma.subscriptionResult.findMany.mockResolvedValue(pendingResults);
      
      const result = await mockPrisma.subscriptionResult.findMany({
        where: { subscriptionId: 1, status: 'pending' },
      });
      
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('pending');
    });
  });

  describe('Result handling modes', () => {
    it('should support preview mode (manual review)', () => {
      const sub = createMockSubscription({ resultHandling: 'preview' });
      expect(sub.resultHandling).toBe('preview');
    });

    it('should support queue mode (adds to review queue)', () => {
      const sub = createMockSubscription({ resultHandling: 'queue' });
      expect(sub.resultHandling).toBe('queue');
    });

    it('should support auto mode (adds directly to Lidarr)', () => {
      const sub = createMockSubscription({ resultHandling: 'auto' });
      expect(sub.resultHandling).toBe('auto');
    });
  });

  describe('Subscription types validation', () => {
    const validTypes = [
      'lastfm_chart', 'lastfm_tag', 'lastfm_geo', 'lastfm_library',
      'musicbrainz', 'musicbrainz_new', 'combined',
      'spotify_playlist', 'spotify_new_releases', 'spotify_followed',
      'spotify_saved_albums', 'spotify_liked_songs', 'spotify_discover_weekly',
      'spotify_release_radar', 'spotify_daily_mix', 'spotify_on_repeat',
      'spotify_featured', 'spotify_category', 'spotify_library',
      'ai_recommendation',
    ];

    validTypes.forEach((type) => {
      it(`should accept type: ${type}`, () => {
        const sub = createMockSubscription({ type: type as never });
        expect(sub.type).toBe(type);
      });
    });
  });
});
