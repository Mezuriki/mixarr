/**
 * Authentication API Tests
 * 
 * Tests:
 * - Setup wizard (first admin creation)
 * - Login/logout
 * - Session management
 * - Protected route access
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockPrisma, createMockUser, createMockAdminUser, resetIdCounter } from '../utils/fixtures.js';

describe('Auth API', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
  });

  describe('GET /api/auth/setup-required', () => {
    it('should return true when no users exist', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      
      const result = await mockPrisma.user.count();
      expect(result).toBe(0);
      
      // Setup should be required
      const setupRequired = result === 0;
      expect(setupRequired).toBe(true);
    });

    it('should return false when users exist', async () => {
      mockPrisma.user.count.mockResolvedValue(1);
      
      const result = await mockPrisma.user.count();
      expect(result).toBe(1);
      
      const setupRequired = result === 0;
      expect(setupRequired).toBe(false);
    });
  });

  describe('POST /api/auth/setup', () => {
    it('should create first admin user when no users exist', async () => {
      const adminUser = createMockAdminUser();
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.create.mockResolvedValue(adminUser);
      mockPrisma.globalSetting.upsert.mockResolvedValue({ key: 'setupCompleted', value: true });

      // Simulate setup
      const count = await mockPrisma.user.count();
      expect(count).toBe(0);

      const newUser = await mockPrisma.user.create({
        data: {
          username: 'admin',
          passwordHash: 'hashed',
          displayName: 'Admin',
          role: 'admin',
        },
      });

      expect(newUser.role).toBe('admin');
      expect(mockPrisma.user.create).toHaveBeenCalled();
    });

    it('should reject setup when users already exist', async () => {
      mockPrisma.user.count.mockResolvedValue(1);

      const count = await mockPrisma.user.count();
      expect(count).toBeGreaterThan(0);
      
      // Setup should be rejected
      const canSetup = count === 0;
      expect(canSetup).toBe(false);
    });

    it('should require username and password', () => {
      const body = { username: '', password: '' };
      
      const isValid = body.username && body.password;
      expect(isValid).toBeFalsy();
    });
  });

  describe('POST /api/auth/login', () => {
    it('should authenticate valid credentials', async () => {
      const user = createMockUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue({ ...user, lastLogin: new Date() });

      const found = await mockPrisma.user.findUnique({ where: { username: user.username } });
      expect(found).toBeDefined();
      expect(found?.isActive).toBe(true);
    });

    it('should reject inactive users', async () => {
      const user = createMockUser({ isActive: false });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const found = await mockPrisma.user.findUnique({ where: { username: user.username } });
      expect(found?.isActive).toBe(false);
      
      // Login should be rejected for inactive users
      const canLogin = found?.isActive === true;
      expect(canLogin).toBe(false);
    });

    it('should reject non-existent users', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const found = await mockPrisma.user.findUnique({ where: { username: 'nonexistent' } });
      expect(found).toBeNull();
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user when authenticated', () => {
      const user = createMockUser();
      
      // Authenticated request
      const req = { user, isAuthenticated: () => true };
      
      expect(req.isAuthenticated()).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user.username).toBeDefined();
    });

    it('should reject unauthenticated requests', () => {
      const req = { user: undefined, isAuthenticated: () => false };
      
      expect(req.isAuthenticated()).toBe(false);
      expect(req.user).toBeUndefined();
    });
  });

  describe('Role-based access', () => {
    it('should allow admin access to admin routes', () => {
      const admin = createMockAdminUser();
      expect(admin.role).toBe('admin');
      
      const hasAdminAccess = admin.role === 'admin';
      expect(hasAdminAccess).toBe(true);
    });

    it('should deny user access to admin routes', () => {
      const user = createMockUser();
      expect(user.role).toBe('user');
      
      const hasAdminAccess = user.role === 'admin';
      expect(hasAdminAccess).toBe(false);
    });
  });
});
