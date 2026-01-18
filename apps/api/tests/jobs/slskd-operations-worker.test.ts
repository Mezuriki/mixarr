import { Job } from 'bullmq';
import { processSlskdJob } from '../../src/jobs/slskd-operations-worker';
import { SlskdSearchJobData, SlskdQueueDownloadJobData } from '../../src/jobs/slskd-operations-queue';
import { prisma } from '../../src/lib/db';
import { SlskdService } from '../../src/services/slskd';

// Mock SlskdService
vi.mock('../../src/services/slskd');

describe('SlskdOperationsWorker', () => {
  const createdConnections: number[] = [];
  
  beforeAll(async () => {
    // Clean up any existing test connections
    await prisma.connection.deleteMany({
      where: { name: 'Test slskd' },
    });
  });
  
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  afterEach(async () => {
    // Clean up all created connections
    for (const id of createdConnections) {
      await prisma.connection.deleteMany({ where: { id } });
    }
    createdConnections.length = 0;
  });
  
  test('processSlskdJob handles search job type', async () => {
    // Create mock connection
    const connection = await prisma.connection.create({
      data: {
        type: 'slskd',
        name: 'Test slskd',
        userId: 1,
        isActive: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
        },
      },
    });
    createdConnections.push(connection.id);
    
    const jobData: SlskdSearchJobData = {
      type: 'search',
      searchText: 'Pink Floyd',
      searchTimeout: 30000,
      connectionId: connection.id,
    };
    
    const mockJob = { data: jobData } as Job<SlskdSearchJobData>;
    
    // Mock SlskdService.search - returns SlskdSearch with id field
    const mockSearch = vi.fn().mockResolvedValue({ id: 'search-123', searchText: 'Pink Floyd', state: 'Completed' });
    vi.mocked(SlskdService).mockImplementation(function(this: any) {
      this.search = mockSearch;
      return this;
    } as any);
    
    const result = await processSlskdJob(mockJob);
    
    expect(mockSearch).toHaveBeenCalledWith('Pink Floyd');
    expect(result).toEqual({ searchId: 'search-123' });
  });
  
  test('processSlskdJob handles queue-download job type', async () => {
    const connection = await prisma.connection.create({
      data: {
        type: 'slskd',
        name: 'Test slskd',
        userId: 1,
        isActive: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
        },
      },
    });
    createdConnections.push(connection.id);
    
    const jobData: SlskdQueueDownloadJobData = {
      type: 'queue-download',
      username: 'testuser',
      filename: 'test.flac',
      connectionId: connection.id,
    };
    
    const mockJob = { data: jobData } as Job<SlskdQueueDownloadJobData>;
    
    // Mock SlskdService.queueDownload - takes (username, files[])
    const mockQueueDownload = vi.fn().mockResolvedValue(undefined);
    vi.mocked(SlskdService).mockImplementation(function(this: any) {
      this.queueDownload = mockQueueDownload;
      return this;
    } as any);
    
    const result = await processSlskdJob(mockJob);
    
    expect(mockQueueDownload).toHaveBeenCalledWith('testuser', [{ filename: 'test.flac', size: 0 }]);
    expect(result).toEqual({ success: true });
  });
  
  test('processSlskdJob throws error for invalid connection', async () => {
    const jobData: SlskdSearchJobData = {
      type: 'search',
      searchText: 'test',
      connectionId: 99999, // Non-existent
    };
    
    const mockJob = { data: jobData } as Job<SlskdSearchJobData>;
    
    await expect(processSlskdJob(mockJob)).rejects.toThrow('Invalid slskd connection');
  });
});
