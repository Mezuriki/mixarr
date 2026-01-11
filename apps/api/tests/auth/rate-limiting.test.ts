import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js';

describe('Auth Rate Limiting', () => {
  it('should rate limit login attempts after 5 tries', async () => {
    const attempts = [];
    
    // Make 6 rapid login attempts
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'wrong' });
      
      attempts.push(res.status);
    }

    // First 5 should be 401 (unauthorized), 6th should be 429 (rate limited)
    expect(attempts.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(attempts[5]).toBe(429);
  });

  it('should include rate limit headers in response', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrong' });

    expect(res.headers).toHaveProperty('ratelimit-limit');
    expect(res.headers).toHaveProperty('ratelimit-remaining');
    expect(res.headers).toHaveProperty('ratelimit-reset');
  });

  it('should return helpful error message when rate limited', async () => {
    // Exhaust rate limit
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'rate-limit@example.com', password: 'wrong' });
    }

    // Next attempt should be rate limited with message
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rate-limit@example.com', password: 'wrong' });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many login attempts');
    expect(res.body.error).toContain('15 minutes');
  });
});
