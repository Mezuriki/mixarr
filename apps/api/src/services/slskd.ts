/**
 * slskd Service
 * 
 * Handles all interactions with the slskd API for Soulseek network access.
 * API Documentation: https://github.com/slskd/slskd (see API controllers)
 */

import { rateLimit } from './rate-limiter.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('slskd');

export interface SlskdConfig {
  url: string;
  apiKey: string;
}

export interface SlskdConnectionResult {
  success: boolean;
  error?: string;
  version?: string;
}

export interface SlskdSearchRequest {
  searchText: string;
  filterResponses?: boolean;
  maximumPeerQueueLength?: number;
  minimumPeerUploadSpeed?: number;
  minimumResponseFileCount?: number;
  responseLimit?: number;
  fileLimit?: number;
}

export interface SlskdFile {
  filename: string;
  size: number;
  code?: number;
  extension?: string;
  bitRate?: number;
  bitDepth?: number;
  sampleRate?: number;
  length?: number;
  isLocked?: boolean;
}

export interface SlskdSearchResponse {
  username: string;
  endpoint?: string;
  token?: number;
  hasFreeUploadSlot?: boolean;
  uploadSpeed?: number;
  queueLength?: number;
  fileCount?: number;
  lockedFileCount?: number;
  files: SlskdFile[];
  lockedFiles?: SlskdFile[];
}

export interface SlskdSearch {
  id: string;
  searchText: string;
  state: 'None' | 'Requested' | 'InProgress' | 'Completed' | 'Cancelled' | 'TimedOut' | 'Errored';
  startedAt?: string;
  endedAt?: string;
  responseCount?: number;
  fileCount?: number;
  responses?: SlskdSearchResponse[];
}

export class SlskdService {
  private url: string;
  private apiKey: string;

  constructor(config: SlskdConfig) {
    // Normalize URL (remove trailing slash)
    this.url = config.url.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  async testConnection(): Promise<SlskdConnectionResult> {
    try {
      const response = await this.callApi<{ version: string; versionCurrent: boolean }>(
        '/api/v0/application'
      );
      return { 
        success: true, 
        version: response.version,
      };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  async search(query: string, options?: Partial<SlskdSearchRequest>): Promise<SlskdSearch> {
    const request: SlskdSearchRequest = {
      searchText: query,
      filterResponses: true,
      ...options,
    };

    log.info('Starting slskd search', { query });
    
    return this.callApi<SlskdSearch>('/api/v0/searches', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getSearchResults(searchId: string, includeResponses = true): Promise<SlskdSearch> {
    const endpoint = includeResponses 
      ? `/api/v0/searches/${searchId}?includeResponses=true`
      : `/api/v0/searches/${searchId}`;
    
    return this.callApi<SlskdSearch>(endpoint);
  }

  async cancelSearch(searchId: string): Promise<void> {
    await this.callApi<void>(`/api/v0/searches/${searchId}`, {
      method: 'PUT',
    });
  }

  async deleteSearch(searchId: string): Promise<void> {
    await this.callApi<void>(`/api/v0/searches/${searchId}`, {
      method: 'DELETE',
    });
  }

  private async callApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    await rateLimit('slskd');

    const url = `${this.url}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`slskd API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }
}
