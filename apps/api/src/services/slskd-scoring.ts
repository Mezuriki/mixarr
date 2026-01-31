/**
 * slskd Search Result Scoring
 *
 * Scores search results based on quality factors:
 * - Lossless format: +50 points
 * - Upload speed: up to +30 points
 * - Free upload slot: +10 points
 * - Queue length: up to -10 points
 */

interface SlskdFile {
  filename: string;
  size: number;
  extension?: string;
}

interface SlskdSearchResponse {
  username: string;
  files: SlskdFile[];
  uploadSpeed?: number;
  hasFreeUploadSlot?: boolean;
  queueLength?: number;
}

const LOSSLESS_FORMATS = ['flac', 'ape', 'wav', 'alac', 'aiff'];

export function isLosslessFormat(extension: string): boolean {
  if (!extension) return false;
  return LOSSLESS_FORMATS.includes(extension.toLowerCase());
}

export function scoreSearchResult(response: SlskdSearchResponse): number {
  let score = 0;

  // Prefer lossless (+50 points)
  const hasLossless = response.files.some((f) => isLosslessFormat(f.extension || ''));
  if (hasLossless) score += 50;

  // Upload speed - up to +30 points (max at 3MB/s)
  const uploadSpeed = response.uploadSpeed || 0;
  score += Math.min(uploadSpeed / 100000, 30);

  // Free upload slot (+10 points)
  if (response.hasFreeUploadSlot) score += 10;

  // Queue length penalty - up to -10 points
  const queueLength = response.queueLength || 0;
  score -= Math.min(queueLength / 10, 10);

  return Math.round(score);
}
