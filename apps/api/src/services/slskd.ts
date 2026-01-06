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
