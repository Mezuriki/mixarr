import { describe, it, expect } from 'vitest';
import { scorePeer, selectBestPeer, SlskdPeer } from '../../src/services/slskd-peer-scorer.js';

describe('Peer Scoring', () => {
  describe('scorePeer', () => {
    it('should score higher for faster upload speed', () => {
      const fastPeer: SlskdPeer = { username: 'fast', uploadSpeed: 500000, queueLength: 5, files: [] };
      const slowPeer: SlskdPeer = { username: 'slow', uploadSpeed: 10000, queueLength: 5, files: [] };
      
      expect(scorePeer(fastPeer)).toBeGreaterThan(scorePeer(slowPeer));
    });

    it('should score higher for shorter queue', () => {
      const shortQueue: SlskdPeer = { username: 'short', uploadSpeed: 100000, queueLength: 2, files: [] };
      const longQueue: SlskdPeer = { username: 'long', uploadSpeed: 100000, queueLength: 50, files: [] };
      
      expect(scorePeer(shortQueue)).toBeGreaterThan(scorePeer(longQueue));
    });

    it('should score higher for high bitrate files', () => {
      const hifi: SlskdPeer = { 
        username: 'hifi', 
        uploadSpeed: 100000, 
        queueLength: 5, 
        files: [{ bitRate: 320, filename: 'song.mp3' }] 
      };
      const lofi: SlskdPeer = { 
        username: 'lofi', 
        uploadSpeed: 100000, 
        queueLength: 5, 
        files: [{ bitRate: 128, filename: 'song.mp3' }] 
      };
      
      expect(scorePeer(hifi)).toBeGreaterThan(scorePeer(lofi));
    });

    it('should give FLAC bonus points', () => {
      const flacPeer: SlskdPeer = { 
        username: 'flac', 
        uploadSpeed: 100000, 
        queueLength: 5, 
        files: [{ bitRate: 320, filename: 'song.flac' }] 
      };
      const mp3Peer: SlskdPeer = { 
        username: 'mp3', 
        uploadSpeed: 100000, 
        queueLength: 5, 
        files: [{ bitRate: 320, filename: 'song.mp3' }] 
      };
      
      expect(scorePeer(flacPeer)).toBeGreaterThan(scorePeer(mp3Peer));
    });

    it('should handle peer with zero values', () => {
      const zeroPeer: SlskdPeer = { username: 'zero', uploadSpeed: 0, queueLength: 0, files: [] };
      
      // Should not throw, should return a valid score
      expect(scorePeer(zeroPeer)).toBeGreaterThanOrEqual(0);
    });

    it('should handle files with missing bitRate', () => {
      const peer: SlskdPeer = { 
        username: 'missing', 
        uploadSpeed: 100000, 
        queueLength: 5, 
        files: [{ filename: 'song.mp3' }] // no bitRate
      };
      
      expect(scorePeer(peer)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('selectBestPeer', () => {
    it('should return the highest scoring peer', () => {
      const peers: SlskdPeer[] = [
        { username: 'bad', uploadSpeed: 1000, queueLength: 100, files: [] },
        { username: 'best', uploadSpeed: 500000, queueLength: 1, files: [{ bitRate: 320, filename: 'song.flac' }] },
        { username: 'ok', uploadSpeed: 50000, queueLength: 10, files: [] },
      ];
      
      const result = selectBestPeer(peers);
      expect(result?.username).toBe('best');
    });

    it('should return null for empty peer list', () => {
      expect(selectBestPeer([])).toBeNull();
    });

    it('should handle peers with missing optional fields', () => {
      const peers: SlskdPeer[] = [
        { username: 'partial', uploadSpeed: 0, queueLength: 0, files: [] },
      ];
      
      const result = selectBestPeer(peers);
      expect(result?.username).toBe('partial');
    });

    it('should handle ties by returning first peer with highest score', () => {
      const peers: SlskdPeer[] = [
        { username: 'first', uploadSpeed: 100000, queueLength: 5, files: [] },
        { username: 'second', uploadSpeed: 100000, queueLength: 5, files: [] },
      ];
      
      const result = selectBestPeer(peers);
      expect(result?.username).toBe('first');
    });

    it('should handle single peer', () => {
      const peers: SlskdPeer[] = [
        { username: 'only', uploadSpeed: 1000, queueLength: 100, files: [] },
      ];
      
      const result = selectBestPeer(peers);
      expect(result?.username).toBe('only');
    });
  });
});
