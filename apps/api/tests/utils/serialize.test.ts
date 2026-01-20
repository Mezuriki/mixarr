import { describe, it, expect } from 'vitest';
import { serializeForJson } from '../../src/utils/serialize.js';

describe('serializeForJson', () => {
  it('should convert BigInt to string', () => {
    const obj = { id: BigInt(12345678901234567890n) };
    const result = serializeForJson(obj);
    expect(result).toEqual({ id: '12345678901234567890' });
  });

  it('should handle nested BigInt values', () => {
    const obj = {
      download: {
        id: BigInt(123n),
        metadata: {
          fileSize: BigInt(9876543210n)
        }
      }
    };
    const result = serializeForJson(obj);
    expect(result).toEqual({
      download: {
        id: '123',
        metadata: {
          fileSize: '9876543210'
        }
      }
    });
  });

  it('should handle arrays with BigInt', () => {
    const arr = [{ id: BigInt(1n) }, { id: BigInt(2n) }];
    const result = serializeForJson(arr);
    expect(result).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('should preserve non-BigInt values', () => {
    const obj = { 
      name: 'test', 
      count: 42, 
      active: true, 
      items: ['a', 'b'],
      nullable: null
    };
    const result = serializeForJson(obj);
    expect(result).toEqual(obj);
  });

  it('should handle Prisma-like response structure', () => {
    const prismaResponse = {
      id: 1,
      trackId: BigInt(987654321098765n),
      status: 'completed',
      files: [
        { 
          id: BigInt(111n), 
          size: BigInt(52428800n), 
          filename: 'song.flac' 
        },
        { 
          id: BigInt(222n), 
          size: BigInt(41943040n), 
          filename: 'song2.flac' 
        }
      ],
      metadata: {
        downloadedAt: new Date('2026-01-17'),
        bytesTotal: BigInt(94371840n)
      }
    };
    const result = serializeForJson(prismaResponse);
    expect(result).toEqual({
      id: 1,
      trackId: '987654321098765',
      status: 'completed',
      files: [
        { id: '111', size: '52428800', filename: 'song.flac' },
        { id: '222', size: '41943040', filename: 'song2.flac' }
      ],
      metadata: {
        downloadedAt: '2026-01-17T00:00:00.000Z',
        bytesTotal: '94371840'
      }
    });
  });
});
