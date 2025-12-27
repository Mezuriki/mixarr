/**
 * Test Setup - Global configuration for all tests
 * 
 * Sets up:
 * - Environment variables
 * - Database connection
 * - Test utilities
 */

import { beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://user:password@localhost:3306/mixarr_test';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.BASE_URL = 'http://localhost:3010';

// Global test setup
beforeAll(async () => {
  // Any global setup
});

afterAll(async () => {
  // Any global cleanup
});

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

// Extend vitest matchers if needed
declare global {
  namespace Vi {
    interface Assertion {
      toBeValidUser(): void;
    }
  }
}
