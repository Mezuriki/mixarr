import type { SlskdFile, SlskdSearchResponse } from '../services/slskd.js';

export interface ParsedFilename {
  trackNumber?: number;
  title: string;
  extension: string;
}

export interface ParsedDirectory {
  artist?: string;
  album?: string;
  year?: number;
}

export type AudioQuality = 'lossless' | 'lossy' | 'unknown';

const LOSSLESS_EXTENSIONS = ['flac', 'wav', 'alac', 'aiff', 'ape', 'wv', 'dsd', 'dsf'];
const LOSSY_EXTENSIONS = ['mp3', 'aac', 'ogg', 'opus', 'm4a', 'wma'];

/**
 * Parse a filename to extract track number, title, and extension
 */
export function parseFilename(filename: string): ParsedFilename {
  // Get just the filename without path
  const name = filename.split('/').pop() || filename;
  
  // Get extension
  const dotIndex = name.lastIndexOf('.');
  const extension = dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : '';
  const baseName = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  
  // Try to extract track number (common formats: "01 - Title", "01. Title", "01_Title", "01 Title")
  const trackMatch = baseName.match(/^(\d{1,3})[\s.\-_]+(.+)$/);
  
  if (trackMatch) {
    return {
      trackNumber: parseInt(trackMatch[1], 10),
      title: trackMatch[2].trim(),
      extension,
    };
  }
  
  return {
    title: baseName,
    extension,
  };
}

/**
 * Parse a directory path to extract artist, album, and year
 */
export function parseDirectoryPath(path: string): ParsedDirectory {
  const parts = path.split('/').filter(Boolean);
  
  if (parts.length < 2) {
    return {};
  }
  
  // Typically: /something/Artist/Album (Year) or /Artist/Album
  const albumPart = parts[parts.length - 1];
  const artistPart = parts[parts.length - 2];
  
  // Try to extract year from album (formats: "Album (1973)", "Album [1973]", "1973 - Album")
  const yearMatch = albumPart.match(/[\(\[](\d{4})[\)\]]/) || 
                   albumPart.match(/^(\d{4})\s*[-–]\s*/);
  
  let album = albumPart;
  let year: number | undefined;
  
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
    // Remove year from album name
    album = albumPart
      .replace(/\s*[\(\[]?\d{4}[\)\]]?\s*[-–]?\s*/, '')
      .replace(/\s*[-–]\s*$/, '')
      .trim();
  }
  
  return {
    artist: artistPart,
    album: album || undefined,
    year,
  };
}

/**
 * Get quality category from file extension
 */
export function getQualityFromExtension(extension: string): AudioQuality {
  const ext = extension.toLowerCase();
  
  if (LOSSLESS_EXTENSIONS.includes(ext)) {
    return 'lossless';
  }
  
  if (LOSSY_EXTENSIONS.includes(ext)) {
    return 'lossy';
  }
  
  return 'unknown';
}

/**
 * Filter files by minimum quality
 */
export function filterResultsByQuality(
  files: Pick<SlskdFile, 'filename' | 'size'>[],
  minQuality: AudioQuality
): Pick<SlskdFile, 'filename' | 'size'>[] {
  if (minQuality === 'unknown') {
    return files;
  }
  
  return files.filter(file => {
    const parsed = parseFilename(file.filename);
    const quality = getQualityFromExtension(parsed.extension);
    
    if (minQuality === 'lossless') {
      return quality === 'lossless';
    }
    
    // lossy accepts both lossy and lossless
    return quality !== 'unknown';
  });
}

/**
 * Group files by their parent directory (album folder)
 */
export function groupFilesByAlbum(
  files: Pick<SlskdFile, 'filename' | 'size'>[]
): Record<string, Pick<SlskdFile, 'filename' | 'size'>[]> {
  const groups: Record<string, Pick<SlskdFile, 'filename' | 'size'>[]> = {};
  
  for (const file of files) {
    const parts = file.filename.split('/');
    const directory = parts.slice(0, -1).join('/');
    
    if (!groups[directory]) {
      groups[directory] = [];
    }
    
    groups[directory].push(file);
  }
  
  return groups;
}

/**
 * Score a search result for quality ranking
 * Higher score = better result
 */
export function scoreResult(response: Partial<SlskdSearchResponse>): number {
  let score = 0;
  
  const files = response.files || [];
  
  // More files = likely more complete album
  score += files.length * 10;
  
  // Lossless files are worth more
  for (const file of files) {
    const parsed = parseFilename(file.filename);
    const quality = getQualityFromExtension(parsed.extension);
    
    if (quality === 'lossless') {
      score += 50;
    } else if (quality === 'lossy') {
      score += 20;
    }
  }
  
  // Upload speed matters
  if (response.uploadSpeed) {
    score += Math.min(response.uploadSpeed / 1000, 100); // Cap at 100 points
  }
  
  // Free upload slot is a bonus
  if (response.hasFreeUploadSlot) {
    score += 50;
  }
  
  return score;
}

/**
 * Build the target path for a file in the music library
 * Format: Artist/Album (Year)/filename
 */
export function buildTargetPath(
  baseDir: string,
  artistName: string,
  albumName: string | undefined,
  year: number | undefined,
  filename: string
): string {
  // Sanitize names for filesystem
  const sanitize = (name: string) => name.replace(/[<>:"/\\|?*]/g, '_');
  
  const artistDir = sanitize(artistName);
  let albumDir = albumName ? sanitize(albumName) : 'Unknown Album';
  
  if (year) {
    albumDir = `${albumDir} (${year})`;
  }
  
  const parsed = parseFilename(filename);
  const targetFilename = parsed.trackNumber
    ? `${String(parsed.trackNumber).padStart(2, '0')} - ${sanitize(parsed.title)}.${parsed.extension}`
    : `${sanitize(parsed.title)}.${parsed.extension}`;
  
  return `${baseDir}/${artistDir}/${albumDir}/${targetFilename}`;
}
