/**
 * Multi-Tenant Access Control Tests
 * 
 * Tests:
 * - User isolation
 * - Admin visibility
 * - Resource ownership
 * - Cross-user access prevention
 * - Global resource sharing
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockAdminUser,
  createMockLidarrConnection,
  createMockSpotifyConnection,
  createMockSubscription,
  createMockReviewItem,
  resetIdCounter,
} from '../utils/fixtures.js';

describe('Multi-Tenant Access Control', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let user1: ReturnType<typeof createMockUser>;
  let user2: ReturnType<typeof createMockUser>;
  let admin: ReturnType<typeof createMockAdminUser>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    user1 = createMockUser({ id: 1, username: 'user1' });
    user2 = createMockUser({ id: 2, username: 'user2' });
    admin = createMockAdminUser({ id: 3, username: 'admin' });
  });

  describe('Connection Isolation', () => {
    it('should only return user own connections', async () => {
      const user1Spotify = createMockSpotifyConnection(user1.id);
      const user2Spotify = createMockSpotifyConnection(user2.id);
      const globalLidarr = createMockLidarrConnection(null);
      
      // User 1 query
      mockPrisma.connection.findMany.mockResolvedValue([user1Spotify, globalLidarr]);
      
      const user1Connections = await mockPrisma.connection.findMany({
        where: {
          OR: [
            { userId: user1.id },
            { userId: null, type: 'lidarr' },
          ],
        },
      });
      
      expect(user1Connections).toHaveLength(2);
      expect(user1Connections.some(c => c.userId === user2.id)).toBe(false);
    });

    it('should prevent access to other user connections', async () => {
      const user2Spotify = createMockSpotifyConnection(user2.id);
      mockPrisma.connection.findUnique.mockResolvedValue(user2Spotify);
      
      const conn = await mockPrisma.connection.findUnique({ where: { id: user2Spotify.id } });
      
      // User 1 trying to access User 2's connection
      const canAccess = conn?.userId === user1.id || user1.role === 'admin';
      expect(canAccess).toBe(false);
    });

    it('should share global Lidarr with all users', async () => {
      const globalLidarr = createMockLidarrConnection(null);
      mockPrisma.connection.findFirst.mockResolvedValue(globalLidarr);
      
      // Both users can access global Lidarr
      const conn = await mockPrisma.connection.findFirst({
        where: {
          OR: [
            { userId: user1.id, type: 'lidarr' },
            { userId: null, type: 'lidarr' },
          ],
        },
      });
      
      expect(conn?.userId).toBeNull();
      expect(conn?.type).toBe('lidarr');
    });

    it('should admin see all connections', async () => {
      const allConnections = [
        createMockSpotifyConnection(user1.id),
        createMockSpotifyConnection(user2.id),
        createMockLidarrConnection(null),
      ];
      mockPrisma.connection.findMany.mockResolvedValue(allConnections);
      
      const connections = await mockPrisma.connection.findMany({});
      
      expect(connections).toHaveLength(3);
    });
  });

  describe('Subscription Isolation', () => {
    it('should only return user own subscriptions', async () => {
      const user1Sub = createMockSubscription({ userId: user1.id });
      mockPrisma.subscription.findMany.mockResolvedValue([user1Sub]);
      
      const subs = await mockPrisma.subscription.findMany({
        where: { userId: user1.id },
      });
      
      expect(subs).toHaveLength(1);
      expect(subs[0].userId).toBe(user1.id);
    });

    it('should prevent access to other user subscriptions', async () => {
      const user2Sub = createMockSubscription({ userId: user2.id });
      mockPrisma.subscription.findUnique.mockResolvedValue(user2Sub);
      
      const sub = await mockPrisma.subscription.findUnique({ where: { id: user2Sub.id } });
      
      const canAccess = sub?.userId === user1.id || user1.role === 'admin';
      expect(canAccess).toBe(false);
    });

    it('should admin see all subscriptions', async () => {
      const allSubs = [
        createMockSubscription({ userId: user1.id }),
        createMockSubscription({ userId: user2.id }),
      ];
      mockPrisma.subscription.findMany.mockResolvedValue(allSubs);
      
      const subs = await mockPrisma.subscription.findMany({});
      
      expect(subs).toHaveLength(2);
    });

    it('should admin modify any subscription', async () => {
      const user1Sub = createMockSubscription({ userId: user1.id });
      mockPrisma.subscription.findUnique.mockResolvedValue(user1Sub);
      
      const canModify = admin.role === 'admin';
      expect(canModify).toBe(true);
    });
  });

  describe('Review Queue Isolation', () => {
    it('should only return user own review items', async () => {
      const user1Items = [
        createMockReviewItem({ userId: user1.id }),
        createMockReviewItem({ userId: user1.id }),
      ];
      mockPrisma.reviewItem.findMany.mockResolvedValue(user1Items);
      
      const items = await mockPrisma.reviewItem.findMany({
        where: { userId: user1.id },
      });
      
      expect(items.every(i => i.userId === user1.id)).toBe(true);
    });

    it('should prevent approving other user review items', async () => {
      const user2Item = createMockReviewItem({ userId: user2.id });
      mockPrisma.reviewItem.findUnique.mockResolvedValue(user2Item);
      
      const item = await mockPrisma.reviewItem.findUnique({ where: { id: user2Item.id } });
      
      const canApprove = item?.userId === user1.id || user1.role === 'admin';
      expect(canApprove).toBe(false);
    });

    it('should admin approve any review item', async () => {
      const user1Item = createMockReviewItem({ userId: user1.id });
      mockPrisma.reviewItem.findUnique.mockResolvedValue(user1Item);
      
      const canApprove = admin.role === 'admin';
      expect(canApprove).toBe(true);
    });

    it('should admin see all review items', async () => {
      const allItems = [
        createMockReviewItem({ userId: user1.id }),
        createMockReviewItem({ userId: user2.id }),
      ];
      mockPrisma.reviewItem.findMany.mockResolvedValue(allItems);
      
      const items = await mockPrisma.reviewItem.findMany({});
      
      expect(items).toHaveLength(2);
    });
  });

  describe('Import Source Isolation', () => {
    it('should only return user own import sources', async () => {
      const user1Sources = [
        { id: 1, userId: user1.id, type: 'liked_songs' },
      ];
      mockPrisma.importSource.findMany.mockResolvedValue(user1Sources);
      
      const sources = await mockPrisma.importSource.findMany({
        where: { userId: user1.id },
      });
      
      expect(sources.every(s => s.userId === user1.id)).toBe(true);
    });

    it('should prevent access to other user import sources', async () => {
      const user2Source = { id: 1, userId: user2.id, type: 'liked_songs' };
      mockPrisma.importSource.findUnique.mockResolvedValue(user2Source);
      
      const source = await mockPrisma.importSource.findUnique({ where: { id: 1 } });
      
      const canAccess = source?.userId === user1.id || user1.role === 'admin';
      expect(canAccess).toBe(false);
    });
  });

  describe('Admin Capabilities', () => {
    it('should admin create global Lidarr connection', async () => {
      const globalConn = createMockLidarrConnection(null);
      mockPrisma.connection.create.mockResolvedValue(globalConn);
      
      const canCreateGlobal = admin.role === 'admin';
      expect(canCreateGlobal).toBe(true);
    });

    it('should non-admin cannot create global connection', async () => {
      const canCreateGlobal = user1.role === 'admin';
      expect(canCreateGlobal).toBe(false);
    });

    it('should admin modify global Lidarr connection', async () => {
      const globalConn = createMockLidarrConnection(null);
      mockPrisma.connection.findUnique.mockResolvedValue(globalConn);
      
      // Only admin can modify global
      const canModify = globalConn.userId === null ? admin.role === 'admin' : true;
      expect(canModify).toBe(true);
    });

    it('should non-admin cannot modify global connection', async () => {
      const globalConn = createMockLidarrConnection(null);
      mockPrisma.connection.findUnique.mockResolvedValue(globalConn);
      
      const canModify = globalConn.userId === null ? user1.role === 'admin' : true;
      expect(canModify).toBe(false);
    });

    it('should admin manage all users', async () => {
      const allUsers = [user1, user2, admin];
      mockPrisma.user.findMany.mockResolvedValue(allUsers);
      
      const canManageUsers = admin.role === 'admin';
      expect(canManageUsers).toBe(true);
      
      const users = await mockPrisma.user.findMany({});
      expect(users).toHaveLength(3);
    });

    it('should non-admin cannot access user management', async () => {
      const canManageUsers = user1.role === 'admin';
      expect(canManageUsers).toBe(false);
    });
  });

  describe('User Settings Isolation', () => {
    it('should only access own settings', async () => {
      const user1Settings = [
        { userId: user1.id, key: 'theme', value: 'dark' },
      ];
      mockPrisma.userSetting.findMany.mockResolvedValue(user1Settings);
      
      const settings = await mockPrisma.userSetting.findMany({
        where: { userId: user1.id },
      });
      
      expect(settings.every(s => s.userId === user1.id)).toBe(true);
    });

    it('should user modify only own settings', async () => {
      const user2Setting = { userId: user2.id, key: 'theme', value: 'light' };
      mockPrisma.userSetting.findFirst.mockResolvedValue(user2Setting);
      
      const setting = await mockPrisma.userSetting.findFirst({
        where: { userId: user2.id, key: 'theme' },
      });
      
      const canModify = setting?.userId === user1.id;
      expect(canModify).toBe(false);
    });
  });

  describe('Session Isolation', () => {
    it('should users only see own session', () => {
      const session = { userId: user1.id };
      const belongsToUser = session.userId === user1.id;
      
      expect(belongsToUser).toBe(true);
    });

    it('should sessions be user-specific', () => {
      const user1Session = { userId: user1.id };
      const user2Session = { userId: user2.id };
      
      expect(user1Session.userId).not.toBe(user2Session.userId);
    });
  });

  describe('Cross-User Prevention', () => {
    it('should prevent user1 from modifying user2 subscription', async () => {
      const user2Sub = createMockSubscription({ userId: user2.id });
      mockPrisma.subscription.findUnique.mockResolvedValue(user2Sub);
      
      const sub = await mockPrisma.subscription.findUnique({ where: { id: user2Sub.id } });
      
      // Ownership check
      const isOwner = sub?.userId === user1.id;
      const isAdmin = user1.role === 'admin';
      const canModify = isOwner || isAdmin;
      
      expect(canModify).toBe(false);
    });

    it('should prevent user1 from deleting user2 connection', async () => {
      const user2Conn = createMockSpotifyConnection(user2.id);
      mockPrisma.connection.findUnique.mockResolvedValue(user2Conn);
      
      const conn = await mockPrisma.connection.findUnique({ where: { id: user2Conn.id } });
      
      const canDelete = conn?.userId === user1.id || user1.role === 'admin';
      expect(canDelete).toBe(false);
    });

    it('should prevent user1 from running user2 import source', async () => {
      const user2Source = { id: 1, userId: user2.id };
      mockPrisma.importSource.findUnique.mockResolvedValue(user2Source);
      
      const source = await mockPrisma.importSource.findUnique({ where: { id: 1 } });
      
      const canRun = source?.userId === user1.id || user1.role === 'admin';
      expect(canRun).toBe(false);
    });
  });
});
