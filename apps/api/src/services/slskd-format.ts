/**
 * slskd File Format Classification
 *
 * Classifies audio files by format and lossless status.
 */

export interface FileInput {
  filename?: string;
  extension?: string;
  bitRate?: number;
}

export interface FileFormatResult {
  format: string;
  isLossless: boolean;
}

const LOSSLESS_EXTENSIONS = ['flac', 'ape', 'wav', 'alac', 'aiff'];

export function classifyFileFormat(file: FileInput): FileFormatResult {
  const ext = getExtension(file);

  // Lossless formats
  if (LOSSLESS_EXTENSIONS.includes(ext)) {
    return { format: 'FLAC', isLossless: true };
  }

  // MP3 with bitrate variants
  if (ext === 'mp3') {
    if (file.bitRate && file.bitRate >= 320) {
      return { format: 'MP3-320', isLossless: false };
    }
    if (file.bitRate && file.bitRate >= 256) {
      return { format: 'MP3-256', isLossless: false };
    }
    return { format: 'MP3', isLossless: false };
  }

  // OGG/Opus
  if (['ogg', 'opus'].includes(ext)) {
    return { format: 'OGG', isLossless: false };
  }

  // AAC
  if (ext === 'm4a') {
    return { format: 'AAC', isLossless: false };
  }

  // Unknown format
  return { format: ext.toUpperCase(), isLossless: false };
}

function getExtension(file: FileInput): string {
  if (file.extension) {
    return file.extension.toLowerCase();
  }
  if (file.filename) {
    const parts = file.filename.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  }
  return '';
}
