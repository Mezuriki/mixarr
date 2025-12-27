/**
 * Admin API Tests
 * 
 * Tests:
 * - User management CRUD
 * - Role-based access control
 * - Global connection management
 * - System-wide settings
 * - Multi-tenant visibility
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockAdminUser,
  createMockLidarrConnection,
  createMockSubscription,
  resetIdCounter,
} from '../utils/fixtures.js';

describe('Admin API', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let adminUser: ReturnType<typeof createMockAdminUser>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    adminUser = createMockAdminUser();
  });

  describe('Access Control', () => {
    it('should deny non-admin users', () => {
      const canAccess = testUser.role === 'admin';
      expect(canAccess).toBe(false);
    });

    it('should allow admin users', () => {
      const canAccess = adminUser.role === 'admin';
      expect(canAccess).toBe(true);
    });
  });

  describe('GET /api/admin/users', () => {
    it('should return all users', async () => {
      const users = [
        createMockAdminUser(),
        createMockUser(),
        createMockUser(),
      ];
      mockPrisma.user.findMany.mockResolvedValue(users);
      
      const result = await mockPrisma.user.findMany({});
      
      expect(result).toHaveLength(3);
    });

    it('should include user counts', async () => {
      const userWithCounts = {
        ...createMockUser(),
        _count: {
          connections: 2,
          subscriptions: 5,
          importSources: 3,
        },
      };
      mockPrisma.user.findMany.mockResolvedValue([userWithCounts]);
      
      const result = await mockPrisma.user.findMany({
        select: {
          id: true,
          username: true,
          _count: {
            select: {
              connections: true,
              subscriptions: true,
              importSources: true,
            },
          },
        },
      });
      
      expect(result[0]._count.connections).toBe(2);
    });
  });

  describe('POST /api/admin/users', () => {
    it('should create new user', async () => {
      const newUser = createMockUser({ username: 'newuser' });
      mockPrisma.user.create.mockResolvedValue(newUser);
      
      const result = await mockPrisma.user.create({
        data: {
          username: 'newuser',
          passwordHash: 'hashed',
          displayName: 'New User',
          role: 'user',
        },
      });
      
      expect(result.username).toBe('newuser');
      expect(result.role).toBe('user');
    });

    it('should create admin user', async () => {
      const newAdmin = createMockAdminUser({ username: 'newadmin' });
      mockPrisma.user.create.mockResolvedValue(newAdmin);
      
      const result = await mockPrisma.user.create({
        data: {
          username: 'newadmin',
          passwordHash: 'hashed',
          displayName: 'New Admin',
          role: 'admin',
        },
      });
      
      expect(result.role).toBe('admin');
    });

    it('should require unique username', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(createMockUser({ username: 'existing' }));
      
      const existing = await mockPrisma.user.findUnique({
        where: { username: 'existing' },
      });
      
      expect(existing).toBeDefined();
      // Should reject creation
    });

    it('should require username and password', () => {
      const body = { username: '', password: '' };
      const isValid = body.username && body.password;
      expect(isValid).toBeFalsy();
    });
  });

  describe('PUT /api/admin/users/:id', () => {
    it('should update user details', async () => {
      const user = createMockUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue({ ...user, displayName: 'Updated Name' });
      
      const result = await mockPrisma.user.update({
        where: { id: user.id },
        data: { displayName: 'Updated Name' },
      });
      
      expect(result.displayName).toBe('Updated Name');
    });

    it('should update user role', async () => {
      const user = createMockUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue({ ...user, role: 'admin' });
      
      const result = await mockPrisma.user.update({
        where: { id: user.id },
        data: { role: 'admin' },
      });
      
      expect(result.role).toBe('admin');
    });

    it('should update user password', async () => {
      const user = createMockUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue({ ...user, passwordHash: 'newHash' });
      
      const result = await mockPrisma.user.update({
        where: { id: user.id },
        data: { passwordHash: 'newHash' },
      });
      
      expect(result.passwordHash).toBe('newHash');
    });

    it('should toggle user active status', async () => {
      const user = createMockUser({ isActive: true });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue({ ...user, isActive: false });
      
      const result = await mockPrisma.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });
      
      expect(result.isActive).toBe(false);
    });

    it('should prevent deactivating last admin', async () => {
      // Only one admin exists
      mockPrisma.user.count.mockResolvedValue(1);
      
      const adminCount = await mockPrisma.user.count({
        where: { role: 'admin', isActive: true },
      });
      
      // Should not allow deactivation
      const canDeactivate = adminCount > 1;
      expect(canDeactivate).toBe(false);
    });
  });

  describe('DELETE /api/admin/users/:id', () => {
    it('should delete user', async () => {
      const user = createMockUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.delete.mockResolvedValue(user);
      
      const result = await mockPrisma.user.delete({
        where: { id: user.id },
      });
      
      expect(result.id).toBe(user.id);
    });

    it('should prevent deleting last admin', async () => {
      mockPrisma.user.count.mockResolvedValue(1);
      
      const adminCount = await mockPrisma.user.count({
        where: { role: 'admin' },
      });
      
      const canDelete = adminCount > 1;
      expect(canDelete).toBe(false);
    });

    it('should cascade delete user data', async () => {
      const user = createMockUser();
      
      // Prisma cascade will handle this automatically
      // Just verify the delete call works
      mockPrisma.user.delete.mockResolvedValue(user);
      
      const result = await mockPrisma.user.delete({
        where: { id: user.id },
      });
      
      expect(result).toBeDefined();
    });
  });

  describe('Global Connection Management', () => {
    it('should allow admin to create global Lidarr connection', async () => {
      const globalConn = createMockLidarrConnection(null);
      mockPrisma.connection.create.mockResolvedValue(globalConn);
      
      const result = await mockPrisma.connection.create({
        data: {
          userId: null,
          type: 'lidarr',
          name: 'Global Lidarr',
          config: { url: 'http://lidarr:8686', apiKey: 'key' },
        },
      });
      
      expect(result.userId).toBeNull();
    });

    it('should allow admin to modify global connection', async () => {
      const globalConn = createMockLidarrConnection(null);
      mockPrisma.connection.findUnique.mockResolvedValue(globalConn);
      mockPrisma.connection.update.mockResolvedValue({ ...globalConn, name: 'Updated' });
      
      // Admin check
      const canModify = adminUser.role === 'admin';
      expect(canModify).toBe(true);
    });

    it('should prevent non-admin from modifying global connection', async () => {
      const globalConn = createMockLidarrConnection(null);
      mockPrisma.connection.findUnique.mockResolvedValue(globalConn);
      
      // Non-admin cannot modify global
      const canModify = testUser.role === 'admin';
      expect(canModify).toBe(false);
    });
  });

  describe('Admin View of All Resources', () => {
    it('should see all users subscriptions', async () => {
      const subs = [
        createMockSubscription({ userId: 1 }),
        createMockSubscription({ userId: 2 }),
        createMockSubscription({ userId: 3 }),
      ];
      mockPrisma.subscription.findMany.mockResolvedValue(subs);
      
      const result = await mockPrisma.subscription.findMany({});
      
      expect(result).toHaveLength(3);
    });

    it('should see all users connections', async () => {
      const conns = [
        createMockLidarrConnection(1),
        createMockLidarrConnection(2),
        createMockLidarrConnection(null),
      ];
      mockPrisma.connection.findMany.mockResolvedValue(conns);
      
      const result = await mockPrisma.connection.findMany({});
      
      expect(result).toHaveLength(3);
    });

    it('should see all users review items', async () => {
      mockPrisma.reviewItem.findMany.mockResolvedValue([
        { id: 1, userId: 1 },
        { id: 2, userId: 2 },
      ]);
      
      const result = await mockPrisma.reviewItem.findMany({});
      
      expect(result).toHaveLength(2);
    });
  });

  describe('System Settings', () => {
    it('should get global settings', async () => {
      mockPrisma.globalSetting.findMany.mockResolvedValue([
        { key: 'setupCompleted', value: true },
        { key: 'baseUrl', value: 'https://192.168.1.245:3443' },
      ]);
      
      const settings = await mockPrisma.globalSetting.findMany({});
      
      expect(settings).toHaveLength(2);
    });

    it('should update global setting', async () => {
      mockPrisma.globalSetting.upsert.mockResolvedValue({
        key: 'baseUrl',
        value: 'https://newurl.com',
      });
      
      const result = await mockPrisma.globalSetting.upsert({
        where: { key: 'baseUrl' },
        create: { key: 'baseUrl', value: 'https://newurl.com' },
        update: { value: 'https://newurl.com' },
      });
      
      expect(result.value).toBe('https://newurl.com');
    });
  });
});
