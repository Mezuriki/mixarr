import { describe, it, expect } from 'vitest';
import { SlskdApiError, parseErrorResponse } from '../../src/services/slskd-api-error.js';

describe('SlskdApiError', () => {
  it('should parse JSON error body', async () => {
    const response = new Response(
      JSON.stringify({ message: 'Not found', code: 'SEARCH_NOT_FOUND' }),
      { status: 404 }
    );
    
    const error = await parseErrorResponse(response, '/api/searches/123');
    
    expect(error).toBeInstanceOf(SlskdApiError);
    expect(error.status).toBe(404);
    expect(error.message).toContain('Not found');
    expect(error.url).toBe('/api/searches/123');
  });

  it('should handle plain text error body', async () => {
    const response = new Response('Internal Server Error', { status: 500 });
    
    const error = await parseErrorResponse(response, '/api/test');
    
    expect(error.status).toBe(500);
    expect(error.body).toBe('Internal Server Error');
  });

  it('should handle empty error body', async () => {
    const response = new Response('', { status: 401 });
    
    const error = await parseErrorResponse(response, '/api/test');
    
    expect(error.status).toBe(401);
    expect(error.body).toBe('');
  });
});
