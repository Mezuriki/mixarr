import { describe, it, expect } from 'vitest';
import { sanitizeConnectionError } from '../../src/utils/sanitize-error.js';

describe('sanitizeConnectionError', () => {
  // ECONNREFUSED
  it('maps ECONNREFUSED to a user-friendly message without leaking the host', () => {
    const err = new Error('connect ECONNREFUSED http://lidarr:8686');
    const msg = sanitizeConnectionError(err);
    expect(msg).toBe('Connection refused — check the URL and ensure the service is running');
    expect(msg).not.toContain('lidarr');
    expect(msg).not.toContain('8686');
  });

  // ENOTFOUND
  it('maps ENOTFOUND to a user-friendly message without leaking the hostname', () => {
    const err = new Error('getaddrinfo ENOTFOUND my-internal-host.local');
    const msg = sanitizeConnectionError(err);
    expect(msg).toBe('Host not found — check the URL');
    expect(msg).not.toContain('my-internal-host');
  });

  // ETIMEDOUT
  it('maps ETIMEDOUT to a user-friendly message', () => {
    const err = new Error('connect ETIMEDOUT 192.168.1.100:8686');
    const msg = sanitizeConnectionError(err);
    expect(msg).toBe('Connection timed out — check the URL and network');
    expect(msg).not.toContain('192.168');
  });

  // TimeoutError
  it('maps TimeoutError to a user-friendly message', () => {
    const err = new Error('TimeoutError: request timed out after 30000ms');
    const msg = sanitizeConnectionError(err);
    expect(msg).toBe('Connection timed out — check the URL and network');
  });

  // ECONNRESET
  it('maps ECONNRESET to a user-friendly message', () => {
    const err = new Error('read ECONNRESET');
    const msg = sanitizeConnectionError(err);
    expect(msg).toBe('Connection reset — the service may be restarting');
  });

  // ECONNABORTED
  it('maps ECONNABORTED to a user-friendly message', () => {
    const err = new Error('ECONNABORTED: socket hang up');
    const msg = sanitizeConnectionError(err);
    expect(msg).toBe('Connection aborted — the service may be unreachable');
  });

  // SSL / certificate errors
  it('maps CERT_ errors to a user-friendly SSL message', () => {
    const err = new Error('CERT_HAS_EXPIRED');
    const msg = sanitizeConnectionError(err);
    expect(msg).toBe('SSL certificate error — check the URL scheme (http vs https)');
  });

  it('maps certificate keyword errors to a user-friendly SSL message', () => {
    const err = new Error('self-signed certificate in certificate chain');
    const msg = sanitizeConnectionError(err);
    expect(msg).toBe('SSL certificate error — check the URL scheme (http vs https)');
  });

  // 401 / Unauthorized
  it('maps 401 to an authentication failure message', () => {
    const err = new Error('Request failed with status code 401');
    const msg = sanitizeConnectionError(err);
    expect(msg).toBe('Authentication failed — check your API key or credentials');
  });

  it('maps Unauthorized keyword to an authentication failure message', () => {
    const err = new Error('Unauthorized');
    const msg = sanitizeConnectionError(err);
    expect(msg).toBe('Authentication failed — check your API key or credentials');
  });

  // 403 / Forbidden
  it('maps 403 to an access denied message', () => {
    const err = new Error('Request failed with status code 403');
    const msg = sanitizeConnectionError(err);
    expect(msg).toBe('Access denied — check your permissions');
  });

  it('maps Forbidden keyword to an access denied message', () => {
    const err = new Error('Forbidden');
    const msg = sanitizeConnectionError(err);
    expect(msg).toBe('Access denied — check your permissions');
  });

  // 404
  it('maps 404 to an endpoint not found message', () => {
    const err = new Error('Request failed with status code 404');
    const msg = sanitizeConnectionError(err);
    expect(msg).toBe('API endpoint not found — check the URL');
  });

  // Default / unknown
  it('returns generic message for unknown errors', () => {
    const err = new Error('some obscure internal error with secret data');
    const msg = sanitizeConnectionError(err);
    expect(msg).toBe('Connection test failed — check your configuration');
    expect(msg).not.toContain('obscure');
    expect(msg).not.toContain('secret');
  });

  // Non-Error inputs
  it('handles a plain string input', () => {
    const msg = sanitizeConnectionError('ECONNREFUSED 10.0.0.5:443');
    expect(msg).toBe('Connection refused — check the URL and ensure the service is running');
    expect(msg).not.toContain('10.0.0.5');
  });

  it('handles null/undefined gracefully', () => {
    expect(sanitizeConnectionError(null)).toBe('Connection test failed — check your configuration');
    expect(sanitizeConnectionError(undefined)).toBe('Connection test failed — check your configuration');
  });

  it('handles a number input', () => {
    expect(sanitizeConnectionError(42)).toBe('Connection test failed — check your configuration');
  });

  // Ensure no internal details leak for any mapped error
  it('never returns the original error message verbatim for known patterns', () => {
    const sensitiveErrors = [
      new Error('connect ECONNREFUSED http://lidarr:8686/api/v1/system/status'),
      new Error('getaddrinfo ENOTFOUND internal-sonarr.docker.local'),
      new Error('connect ETIMEDOUT 172.18.0.5:7878'),
      new Error('read ECONNRESET at TLSWrap.onStreamRead'),
    ];

    for (const err of sensitiveErrors) {
      const msg = sanitizeConnectionError(err);
      expect(msg).not.toEqual(err.message);
      // Should not contain IPs or Docker hostnames
      expect(msg).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
      expect(msg).not.toMatch(/:\d{4,5}/);
    }
  });
});
