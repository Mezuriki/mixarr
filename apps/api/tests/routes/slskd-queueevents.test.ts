import { describe, it, expect } from 'vitest';

describe('slskd routes QueueEvents', () => {
  it('should export cleanup function', async () => {
    // This test verifies the cleanup function exists and is callable
    const routes = await import('../../src/routes/slskd.js');
    
    expect(typeof routes.cleanupQueueEvents).toBe('function');
  });
});
