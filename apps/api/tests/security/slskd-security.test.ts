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
        searchId: 1,
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
        searchId: 1,
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
        searchId: 1,
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
        searchId: 1,
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
        searchId: 1,
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
        searchId: 1,
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
