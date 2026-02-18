/**
 * Fetch with Timeout Wrapper
 *
 * Wraps the global fetch() with an automatic timeout using AbortSignal.timeout().
 * If the caller already provides a signal, both are combined with AbortSignal.any()
 * so that either the caller's abort or the timeout will cancel the request.
 *
 * Requires Node.js 20.3+ for AbortSignal.any() support.
 */

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds

export function fetchWithTimeout(
  url: string | URL,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

  const timeoutSignal = AbortSignal.timeout(timeout);

  // Combine with any existing signal from the caller
  const signal = fetchOptions.signal
    ? AbortSignal.any([timeoutSignal, fetchOptions.signal])
    : timeoutSignal;

  return fetch(url, {
    ...fetchOptions,
    signal,
  });
}
