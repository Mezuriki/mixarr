/**
 * End-to-End API Integration Tests
 * 
 * These tests run against a live API server
 * Set TEST_API_URL environment variable to target server
 * 
 * Usage:
 *   TEST_API_URL=https://192.168.1.245:3443 npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import https from 'https';

const API_URL = process.env.TEST_API_URL || 'https://localhost:3443';
const TEST_USERNAME = process.env.TEST_USERNAME || 'admin';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin';

// Skip if no API URL configured
const shouldRun = !!process.env.TEST_API_URL;

// Create HTTPS agent that allows self-signed certs
// lgtm[js/disabling-certificate-validation] - Test environment uses self-signed certs
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

interface SessionCookies {
  cookies: string[];
}

let session: SessionCookies = { cookies: [] };

async function apiRequest(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${API_URL}/api${path}`;
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  
  if (session.cookies.length > 0) {
    (headers as Record<string, string>)['Cookie'] = session.cookies.join('; ');
  }
  
  // Use dynamic import for node-fetch with agent support
  const { default: fetch } = await import('node-fetch');
  
  return fetch(url, {
    ...options,
    headers,
    agent: httpsAgent,
  }) as unknown as Response;
}

async function login(): Promise<void> {
  const response = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status}`);
  }
  
  // Extract session cookie
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    session.cookies = [setCookie.split(';')[0]];
  }
}

describe.skipIf(!shouldRun)('E2E API Integration Tests', () => {
  beforeAll(async () => {
    await login();
  });

  afterAll(() => {
    session = { cookies: [] };
  });

  describe('Health Check', () => {
    it('GET /api/health should return healthy', async () => {
      const response = await apiRequest('/health');
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data).toHaveProperty('status');
    });
  });

  describe('Authentication', () => {
    it('GET /api/auth/me should return current user', async () => {
      const response = await apiRequest('/auth/me');
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data).toHaveProperty('user');
      expect(data.user).toHaveProperty('username');
    });
  });

  describe('Connections', () => {
    it('GET /api/connections should return connections list', async () => {
      const response = await apiRequest('/connections');
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data).toHaveProperty('connections');
      expect(Array.isArray(data.connections)).toBe(true);
    });

    it('POST /api/connections/:id/test should test connection', async () => {
      // Get first connection
      const listResponse = await apiRequest('/connections');
      const { connections } = await listResponse.json();
      
      if (connections.length > 0) {
        const conn = connections[0];
        const response = await apiRequest(`/connections/${conn.id}/test`, {
          method: 'POST',
        });
        
        // May succeed or fail depending on actual connection
        expect([200, 400, 500]).toContain(response.status);
      }
    });
  });

  describe('Subscriptions', () => {
    let testSubscriptionId: number | null = null;

    it('GET /api/subscriptions should return subscriptions list', async () => {
      const response = await apiRequest('/subscriptions');
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data).toHaveProperty('subscriptions');
      expect(Array.isArray(data.subscriptions)).toBe(true);
    });

    it('POST /api/subscriptions should create subscription', async () => {
      const response = await apiRequest('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'E2E Test Subscription',
          type: 'lastfm_chart',
          config: { chartType: 'artists', period: 'week' },
          resultHandling: 'preview',
          isActive: false,
        }),
      });
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data).toHaveProperty('subscription');
      expect(data.subscription.name).toBe('E2E Test Subscription');
      
      testSubscriptionId = data.subscription.id;
    });

    it('GET /api/subscriptions/:id should return subscription', async () => {
      if (!testSubscriptionId) return;
      
      const response = await apiRequest(`/subscriptions/${testSubscriptionId}`);
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.subscription.id).toBe(testSubscriptionId);
    });

    it('PUT /api/subscriptions/:id should update subscription', async () => {
      if (!testSubscriptionId) return;
      
      const response = await apiRequest(`/subscriptions/${testSubscriptionId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: 'E2E Test Subscription Updated',
        }),
      });
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.subscription.name).toBe('E2E Test Subscription Updated');
    });

    it('DELETE /api/subscriptions/:id should delete subscription', async () => {
      if (!testSubscriptionId) return;
      
      const response = await apiRequest(`/subscriptions/${testSubscriptionId}`, {
        method: 'DELETE',
      });
      
      expect(response.ok).toBe(true);
    });
  });

  describe('Search', () => {
    it('GET /api/search/artists should search artists', async () => {
      const response = await apiRequest('/search/artists?q=pink+floyd');
      
      // May fail if no Lidarr connection
      if (response.ok) {
        const data = await response.json();
        expect(data).toHaveProperty('results');
        expect(Array.isArray(data.results)).toBe(true);
      } else {
        expect([400, 500]).toContain(response.status);
      }
    });
  });

  describe('Discover', () => {
    it('GET /api/discover/library should return library', async () => {
      const response = await apiRequest('/discover/library');
      
      if (response.ok) {
        const data = await response.json();
        expect(data).toHaveProperty('artists');
        expect(data).toHaveProperty('pagination');
      } else {
        expect([400, 500]).toContain(response.status);
      }
    });
  });

  describe('Review Queue', () => {
    it('GET /api/imports/review/queue should return review items', async () => {
      const response = await apiRequest('/imports/review/queue');
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data).toHaveProperty('items');
      expect(Array.isArray(data.items)).toBe(true);
    });
  });

  describe('Logs', () => {
    it('GET /api/logs should return logs', async () => {
      const response = await apiRequest('/logs');
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data).toHaveProperty('logs');
    });
  });

  describe('Settings', () => {
    it('GET /api/settings should return settings', async () => {
      const response = await apiRequest('/settings');
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(typeof data).toBe('object');
    });
  });
});
