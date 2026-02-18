import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout } from '../../src/lib/fetch-with-timeout.js';

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should pass timeout signal to fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    await fetchWithTimeout('http://example.com', { timeout: 5000 });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs[0]).toBe('http://example.com');
    expect(callArgs[1]?.signal).toBeDefined();
  });

  it('should use default timeout when not specified', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    await fetchWithTimeout('http://example.com');

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][1]?.signal).toBeDefined();
  });

  it('should pass through other options', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    await fetchWithTimeout('http://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      timeout: 5000,
    });

    const callArgs = fetchSpy.mock.calls[0][1];
    expect(callArgs?.method).toBe('POST');
    expect(callArgs?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(callArgs?.body).toBe('{}');
  });

  it('should NOT pass timeout property through to fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    await fetchWithTimeout('http://example.com', { timeout: 5000 });

    const callArgs = fetchSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('timeout');
  });

  it('should combine caller signal with timeout signal', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const callerController = new AbortController();

    await fetchWithTimeout('http://example.com', {
      signal: callerController.signal,
      timeout: 5000,
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const signal = fetchSpy.mock.calls[0][1]?.signal;
    expect(signal).toBeDefined();
    // The signal should be a combined signal (not the original caller signal)
    expect(signal).not.toBe(callerController.signal);
  });

  it('should accept URL object', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const url = new URL('http://example.com/api');

    await fetchWithTimeout(url, { timeout: 5000 });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe(url);
  });
});
