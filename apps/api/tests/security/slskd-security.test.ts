import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../../src/index';

const prisma = new PrismaClient();

describe('slskd security - path traversal', () => {
  let connectionId: number;

  beforeEach(async () => {
    // Clean up
    await prisma.slskdDownload.deleteMany({});
    await prisma.connection.deleteMany({ where: { type: 'slskd' } });

    // Create slskd connection
    const connection = await prisma.connection.create({
      data: {
        type: 'slskd',
        name: 'Test slskd',
        isActive: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'testkey',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      },
    });
    connectionId = connection.id;
  });

  afterEach(async () => {
    await prisma.slskdDownload.deleteMany({});
    await prisma.connection.deleteMany({ where: { id: connectionId } });
  });

  it('should reject webhook with path traversal in username', async () => {
    // Create download that would match
    await prisma.slskdDownload.create({
      data: {
        connectionId,
        username: '../../../etc',
        filename: 'shadow',
        fileSize: 1000,
        artistName: 'Test',
        albumName: 'Test',
        status: 'pending',
      },
    });

    const res = await request(app)
      .post('/api/slskd/webhook')
      .send({
        event: 'DownloadComplete',
        username: '../../../etc',
        directory: 'passwd',
        filename: 'shadow',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid.*path|path.*traversal/i);
  });

  it('should reject webhook with path traversal in directory', async () => {
    await prisma.slskdDownload.create({
      data: {
        connectionId,
        username: 'validuser',
        filename: 'data.mp3',
        fileSize: 5000000,
        artistName: 'Test',
        albumName: 'Test',
        status: 'pending',
      },
    });

    const res = await request(app)
      .post('/api/slskd/webhook')
      .send({
        event: 'DownloadComplete',
        username: 'validuser',
        directory: '../../sensitive',
        filename: 'data.mp3',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid.*path|path.*traversal/i);
  });

  it('should reject webhook with path traversal in filename', async () => {
    await prisma.slskdDownload.create({
      data: {
        connectionId,
        username: 'validuser',
        filename: 'passwd',
        fileSize: 1000,
        artistName: 'Test',
        albumName: 'Test',
        status: 'pending',
      },
    });

    const res = await request(app)
      .post('/api/slskd/webhook')
      .send({
        event: 'DownloadComplete',
        username: 'validuser',
        directory: 'album',
        filename: '../../../etc/passwd',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid.*path|path.*traversal/i);
  });

  it('should reject webhook with null byte injection', async () => {
    await prisma.slskdDownload.create({
      data: {
        connectionId,
        username: 'validuser',
        filename: 'song.mp3',
        fileSize: 5000000,
        artistName: 'Test',
        albumName: 'Test',
        status: 'pending',
      },
    });

    const res = await request(app)
      .post('/api/slskd/webhook')
      .send({
        event: 'DownloadComplete',
        username: 'validuser',
        directory: 'album',
        filename: 'song.mp3\0/etc/passwd',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid.*path|path.*traversal/i);
  });

  it('should reject webhook with absolute path in filename', async () => {
    await prisma.slskdDownload.create({
      data: {
        connectionId,
        username: 'validuser',
        filename: 'passwd',
        fileSize: 1000,
        artistName: 'Test',
        albumName: 'Test',
        status: 'pending',
      },
    });

    const res = await request(app)
      .post('/api/slskd/webhook')
      .send({
        event: 'DownloadComplete',
        username: 'validuser',
        directory: 'album',
        filename: '/etc/passwd',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid.*path|path.*traversal/i);
  });

  it('should accept webhook with valid paths', async () => {
    await prisma.slskdDownload.create({
      data: {
        connectionId,
        username: 'validuser',
        filename: 'song.mp3',
        fileSize: 5000000,
        artistName: 'Test Artist',
        albumName: 'Test Album',
        status: 'pending',
      },
    });

    const res = await request(app)
      .post('/api/slskd/webhook')
      .send({
        event: 'DownloadComplete',
        username: 'validuser',
        directory: 'Test Artist - Album',
        filename: 'song.mp3',
      });

    // Should not be 400 (path validation error)
    // May be 200 (success) or 500 (organization error), but not path validation
    expect(res.status).not.toBe(400);
  });
});
describe('slskd security - rate limiting', () => {
  it('should rate limit webhook requests (100 per minute)', async () => {
    // Make 101 requests rapidly
    const requests = [];
    for (let i = 0; i < 101; i++) {
      requests.push(
        request(app)
          .post('/api/slskd/webhook')
          .send({
            event: 'DownloadComplete',
            username: 'testuser',
            directory: 'test',
            filename: 'test.mp3',
          })
      );
    }

    const responses = await Promise.all(requests);
    
    // At least one should be rate limited (429)
    const rateLimited = responses.filter(res => res.status === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
    
    // Check rate limit response format
    const limitedResponse = rateLimited[0];
    expect(limitedResponse.body.error).toMatch(/too many.*requests/i);
  }, 10000); // Increase timeout for this test
});