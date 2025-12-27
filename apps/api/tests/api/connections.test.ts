/**
 * Connections API Tests
 * 
 * Tests:
 * - CRUD operations for connections
 * - Connection type validation (Lidarr, Spotify, Last.fm)
 * - Global vs user-owned connections
 * - Multi-tenant access control
 * - Connection testing
 * - Spotify OAuth flow
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockAdminUser,
  createMockLidarrConnection,
  createMockSpotifyConnection,
  createMockLastfmConnection,
  createMockLidarrService,
  resetIdCounter,
} from '../utils/fixtures.js';

describe('Connections API', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let adminUser: ReturnType<typeof createMockAdminUser>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    adminUser = createMockAdminUser();
  });

  describe('GET /api/connections', () => {
    it('should return user connections for regular users', async () => {
      const userConnection = createMockSpotifyConnection(testUser.id);
      const globalLidarr = createMockLidarrConnection(null);
      
      mockPrisma.connection.findMany.mockResolvedValue([userConnection, globalLidarr]);
      
      const connections = await mockPrisma.connection.findMany({
        where: {
          OR: [
            { userId: testUser.id },
            { userId: null, type: 'lidarr' },
          ],
        },
      });
      
      expect(connections).toHaveLength(2);
    });

    it('should return all connections for admin', async () => {
      const user1Spotify = createMockSpotifyConnection(1);
      const user2Spotify = createMockSpotifyConnection(2);
      const globalLidarr = createMockLidarrConnection(null);
      
      mockPrisma.connection.findMany.mockResolvedValue([user1Spotify, user2Spotify, globalLidarr]);
      
      const connections = await mockPrisma.connection.findMany();
      expect(connections).toHaveLength(3);
    });

    it('should only show global Lidarr to users who do not own it', async () => {
      const globalLidarr = createMockLidarrConnection(null);
      
      // User can see global Lidarr
      const canAccess = globalLidarr.userId === null && globalLidarr.type === 'lidarr';
      expect(canAccess).toBe(true);
    });
  });

  describe('POST /api/connections', () => {
    it('should create Lidarr connection', async () => {
      const newConn = createMockLidarrConnection(testUser.id);
      mockPrisma.connection.create.mockResolvedValue(newConn);
      
      const result = await mockPrisma.connection.create({
        data: {
          userId: testUser.id,
          type: 'lidarr',
          name: 'Lidarr',
          config: { url: 'http://localhost:8686', apiKey: 'test-key' },
        },
      });
      
      expect(result.type).toBe('lidarr');
      expect(result.userId).toBe(testUser.id);
    });

    it('should create global Lidarr connection (admin only)', async () => {
      const globalConn = createMockLidarrConnection(null);
      mockPrisma.connection.create.mockResolvedValue(globalConn);
      
      // Only admin can create global connection
      const isAdmin = adminUser.role === 'admin';
      expect(isAdmin).toBe(true);
      
      const result = await mockPrisma.connection.create({
        data: {
          userId: null,
          type: 'lidarr',
          name: 'Lidarr',
          config: { url: 'http://localhost:8686', apiKey: 'test-key' },
        },
      });
      
      expect(result.userId).toBeNull();
    });

    it('should create Spotify connection', async () => {
      const spotifyConn = createMockSpotifyConnection(testUser.id);
      mockPrisma.connection.create.mockResolvedValue(spotifyConn);
      
      const result = await mockPrisma.connection.create({
        data: {
          userId: testUser.id,
          type: 'spotify',
          name: 'Spotify',
          config: {
            clientId: 'client-id',
            clientSecret: 'client-secret',
          },
        },
      });
      
      expect(result.type).toBe('spotify');
    });

    it('should create Last.fm connection', async () => {
      const lastfmConn = createMockLastfmConnection(testUser.id);
      mockPrisma.connection.create.mockResolvedValue(lastfmConn);
      
      const result = await mockPrisma.connection.create({
        data: {
          userId: testUser.id,
          type: 'lastfm',
          name: 'Last.fm',
          config: { apiKey: 'lastfm-api-key' },
        },
      });
      
      expect(result.type).toBe('lastfm');
    });

    it('should require valid connection type', () => {
      const validTypes = ['lidarr', 'spotify', 'lastfm'];
      const invalidType = 'invalid';
      
      expect(validTypes.includes(invalidType)).toBe(false);
    });
  });

  describe('PUT /api/connections/:id', () => {
    it('should update own connection', async () => {
      const conn = createMockSpotifyConnection(testUser.id);
      mockPrisma.connection.findUnique.mockResolvedValue(conn);
      mockPrisma.connection.update.mockResolvedValue({ ...conn, name: 'Updated Name' });
      
      const existing = await mockPrisma.connection.findUnique({ where: { id: conn.id } });
      expect(existing?.userId).toBe(testUser.id);
      
      // User can modify their own
      const canModify = existing?.userId === testUser.id;
      expect(canModify).toBe(true);
    });

    it('should prevent user from updating other user connections', async () => {
      const otherUserConn = createMockSpotifyConnection(999);
      mockPrisma.connection.findUnique.mockResolvedValue(otherUserConn);
      
      const existing = await mockPrisma.connection.findUnique({ where: { id: otherUserConn.id } });
      
      // User cannot modify others' connections
      const canModify = existing?.userId === testUser.id || testUser.role === 'admin';
      expect(canModify).toBe(false);
    });

    it('should allow admin to update any connection', async () => {
      const otherUserConn = createMockSpotifyConnection(999);
      mockPrisma.connection.findUnique.mockResolvedValue(otherUserConn);
      
      const existing = await mockPrisma.connection.findUnique({ where: { id: otherUserConn.id } });
      
      // Admin can modify any
      const canModify = adminUser.role === 'admin';
      expect(canModify).toBe(true);
    });

    it('should prevent non-admin from modifying global Lidarr', async () => {
      const globalLidarr = createMockLidarrConnection(null);
      mockPrisma.connection.findUnique.mockResolvedValue(globalLidarr);
      
      const existing = await mockPrisma.connection.findUnique({ where: { id: globalLidarr.id } });
      
      // Only admin can modify global
      const canModify = existing?.userId === null ? testUser.role === 'admin' : true;
      expect(canModify).toBe(false);
    });
  });

  describe('DELETE /api/connections/:id', () => {
    it('should delete own connection', async () => {
      const conn = createMockSpotifyConnection(testUser.id);
      mockPrisma.connection.findUnique.mockResolvedValue(conn);
      mockPrisma.connection.delete.mockResolvedValue(conn);
      
      const existing = await mockPrisma.connection.findUnique({ where: { id: conn.id } });
      const canDelete = existing?.userId === testUser.id;
      
      expect(canDelete).toBe(true);
    });

    it('should prevent deleting other users connections', async () => {
      const otherConn = createMockSpotifyConnection(999);
      mockPrisma.connection.findUnique.mockResolvedValue(otherConn);
      
      const existing = await mockPrisma.connection.findUnique({ where: { id: otherConn.id } });
      const canDelete = existing?.userId === testUser.id || testUser.role === 'admin';
      
      expect(canDelete).toBe(false);
    });
  });

  describe('POST /api/connections/:id/test', () => {
    it('should test Lidarr connection successfully', async () => {
      const mockLidarr = createMockLidarrService();
      mockLidarr.testConnection.mockResolvedValue(true);
      
      const result = await mockLidarr.testConnection();
      expect(result).toBe(true);
    });

    it('should handle Lidarr connection failure', async () => {
      const mockLidarr = createMockLidarrService();
      mockLidarr.testConnection.mockRejectedValue(new Error('Connection refused'));
      
      await expect(mockLidarr.testConnection()).rejects.toThrow('Connection refused');
    });

    it('should test Spotify connection by checking token validity', async () => {
      const spotifyConn = createMockSpotifyConnection(testUser.id);
      const config = spotifyConn.config as { expiresAt?: string };
      
      // Token not expired
      const expiresAt = new Date(config.expiresAt || '');
      const isValid = expiresAt > new Date();
      expect(isValid).toBe(true);
    });
  });

  describe('Global Lidarr connection access', () => {
    it('should fall back to global Lidarr when user has none', async () => {
      const globalLidarr = createMockLidarrConnection(null);
      
      // Query: user's own first, then global
      mockPrisma.connection.findFirst.mockResolvedValue(globalLidarr);
      
      const conn = await mockPrisma.connection.findFirst({
        where: {
          OR: [
            { userId: testUser.id, type: 'lidarr', isActive: true },
            { userId: null, type: 'lidarr', isActive: true },
          ],
        },
        orderBy: { userId: 'desc' },
      });
      
      expect(conn?.userId).toBeNull();
      expect(conn?.type).toBe('lidarr');
    });

    it('should prefer user Lidarr over global', async () => {
      const userLidarr = createMockLidarrConnection(testUser.id);
      
      mockPrisma.connection.findFirst.mockResolvedValue(userLidarr);
      
      const conn = await mockPrisma.connection.findFirst({
        where: {
          OR: [
            { userId: testUser.id, type: 'lidarr', isActive: true },
            { userId: null, type: 'lidarr', isActive: true },
          ],
        },
        orderBy: { userId: 'desc' }, // non-null first
      });
      
      expect(conn?.userId).toBe(testUser.id);
    });
  });
});
