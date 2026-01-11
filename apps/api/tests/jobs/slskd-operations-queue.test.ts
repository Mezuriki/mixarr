import { Queue } from 'bullmq';
import { vi } from 'vitest';
import { slskdQueue, SLSKD_QUEUE_NAME, enqueueSlskdSearch, enqueueSlskdDownload } from '../../src/jobs/slskd-operations-queue';

describe('SlskdOperationsQueue', () => {
  afterEach(async () => {
    await slskdQueue.obliterate({ force: true });
  });
  
  afterAll(async () => {
    await slskdQueue.close();
  });
  
  test('queue is created with correct name', () => {
    expect(slskdQueue).toBeInstanceOf(Queue);
    expect(slskdQueue.name).toBe(SLSKD_QUEUE_NAME);
  });
  
  test('enqueueSlskdSearch creates job with search type', async () => {
    const job = await enqueueSlskdSearch({
      searchText: 'Pink Floyd Dark Side',
      searchTimeout: 30000,
      connectionId: 1,
    });
    
    expect(job.data.type).toBe('search');
    expect(job.data.searchText).toBe('Pink Floyd Dark Side');
    expect(job.data.connectionId).toBe(1);
    
    await job.remove(); // Cleanup
  });
  
  test('enqueueSlskdDownload creates job with queue-download type', async () => {
    const job = await enqueueSlskdDownload({
      username: 'testuser',
      filename: 'test.flac',
      connectionId: 1,
    });
    
    expect(job.data.type).toBe('queue-download');
    expect(job.data.username).toBe('testuser');
    expect(job.data.filename).toBe('test.flac');
    
    await job.remove(); // Cleanup
  });
  
  test('enqueueSlskdSearch rejects when queue is full', async () => {
    // Mock count to return MAX_QUEUE_SIZE
    const originalCount = slskdQueue.count;
    slskdQueue.count = vi.fn().mockResolvedValue(1000);
    
    await expect(
      enqueueSlskdSearch({
        searchText: 'test',
        connectionId: 1,
      })
    ).rejects.toThrow('SLSKD operations queue is full');
    
    // Restore
    slskdQueue.count = originalCount;
  });
  
  test('enqueueSlskdDownload rejects when queue is full', async () => {
    // Mock count to return MAX_QUEUE_SIZE
    const originalCount = slskdQueue.count;
    slskdQueue.count = vi.fn().mockResolvedValue(1000);
    
    await expect(
      enqueueSlskdDownload({
        username: 'testuser',
        filename: 'test.flac',
        connectionId: 1,
      })
    ).rejects.toThrow('SLSKD operations queue is full');
    
    // Restore
    slskdQueue.count = originalCount;
  });
});
