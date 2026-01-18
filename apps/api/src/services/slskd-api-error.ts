import { createLogger } from '../lib/logger.js';

const logger = createLogger('SlskdApiError');

export class SlskdApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    public url: string,
    public parsedBody?: Record<string, unknown>
  ) {
    const message = (parsedBody?.message as string) || body || `HTTP ${status}`;
    super(`slskd API error: ${message}`);
    this.name = 'SlskdApiError';
  }
}

export async function parseErrorResponse(response: Response, url: string): Promise<SlskdApiError> {
  const body = await response.text();
  let parsedBody: Record<string, unknown> | undefined;
  
  try {
    parsedBody = JSON.parse(body);
  } catch {
    // Not JSON, use raw text
  }
  
  const error = new SlskdApiError(response.status, body, url, parsedBody);
  
  logger.error('slskd API error', {
    status: response.status,
    url,
    body: parsedBody || body,
  });
  
  return error;
}
