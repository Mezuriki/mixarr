/**
 * Peer quality scoring for slskd downloads
 * 
 * Assigns points based on:
 * - Upload speed (0-30 points)
 * - Queue length (0-20 points, shorter = better)
 * - File quality/bitrate (0-30 points)
 * - FLAC format bonus (10 points)
 */

export interface SlskdFile {
  filename: string;
  bitRate?: number;
  size?: number;
}

export interface SlskdPeer {
  username: string;
  uploadSpeed: number;
  queueLength: number;
  files: SlskdFile[];
}

/**
 * Calculate a quality score for a peer based on their connection and file quality
 * 
 * @param peer - The peer to score
 * @returns A numeric score (higher is better)
 */
export function scorePeer(peer: SlskdPeer): number {
  let score = 0;
  
  // Speed score (0-30 points)
  // 500KB/s+ = 30, 100KB/s = 20, 50KB/s = 10
  if (peer.uploadSpeed >= 500000) score += 30;
  else if (peer.uploadSpeed >= 100000) score += 20;
  else if (peer.uploadSpeed >= 50000) score += 10;
  
  // Queue score (0-20 points)
  // Shorter queue = better
  if (peer.queueLength <= 5) score += 20;
  else if (peer.queueLength <= 20) score += 10;
  else if (peer.queueLength <= 50) score += 5;
  
  // Quality score (0-30 points)
  // Based on best file bitrate
  const bitrates = peer.files.map(f => f.bitRate || 0);
  const maxBitrate = bitrates.length > 0 ? Math.max(...bitrates) : 0;
  if (maxBitrate >= 320) score += 30;
  else if (maxBitrate >= 256) score += 20;
  else if (maxBitrate >= 192) score += 10;
  
  // FLAC bonus (10 points)
  if (peer.files.some(f => f.filename.toLowerCase().endsWith('.flac'))) {
    score += 10;
  }
  
  return score;
}

/**
 * Select the best peer from a list based on quality scoring
 * 
 * @param peers - Array of peers to choose from
 * @returns The highest scoring peer, or null if the list is empty
 */
export function selectBestPeer(peers: SlskdPeer[]): SlskdPeer | null {
  if (peers.length === 0) return null;
  
  // Use reduce to find the best peer while preserving order for ties
  return peers.reduce((best, current) => 
    scorePeer(current) > scorePeer(best) ? current : best
  );
}
