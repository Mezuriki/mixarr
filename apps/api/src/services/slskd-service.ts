/**
 * SlskdService - Minimal stub for slskd API integration
 * This is a placeholder implementation to support TDD workflow
 * Full implementation will be added in subsequent tasks
 */

export interface SlskdSearchRequest {
  searchText: string;
  searchTimeout?: number;
}

export interface SlskdSearchResponse {
  id: number;
}

export interface SlskdFile {
  filename: string;
  size: number;
  extension: string;
  bitRate?: number;
  sampleRate?: number;
  bitDepth?: number;
}

export interface SlskdSearchResult {
  id: number;
  state: 'InProgress' | 'Completed' | 'Errored';
  responses: Array<{
    username: string;
    files: SlskdFile[];
    uploadSpeed: number;
    queueLength: number;
    hasFreeUploadSlot: boolean;
  }>;
}

export interface SlskdQueueRequest {
  username: string;
  filename: string;
}

export class SlskdService {
  constructor(
    private baseUrl: string,
    private apiKey: string
  ) {}

  async createSearch(request: SlskdSearchRequest): Promise<SlskdSearchResponse> {
    throw new Error('Not implemented - stub for TDD');
  }

  async getSearch(searchId: number): Promise<SlskdSearchResult> {
    throw new Error('Not implemented - stub for TDD');
  }

  async queueDownload(request: SlskdQueueRequest): Promise<void> {
    throw new Error('Not implemented - stub for TDD');
  }
}
