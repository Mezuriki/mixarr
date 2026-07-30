/**
 * Fetch with Timeout Wrapper
 *
 * Wraps the global fetch() with an automatic timeout using AbortSignal.timeout().
 * If the caller already provides a signal, both are combined with AbortSignal.any()
 * so that either the caller's abort or the timeout will cancel the request.
 *
 * Requires Node.js 20.3+ for AbortSignal.any() support.
 */

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds (library reads, login, etc.)
// MUST be > navidrome OpenAI timeout (90s). If Mixarr times out before navidrome,
// the navidrome goroutine keeps running (holding resources). 100s gives navidrome
// 10s of headroom to return (including its 90s Z.ai timeout + response time).
const AI_TIMEOUT_MS = 100_000;

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

/**
 * fetchAI is fetchWithTimeout with the extended timeout for AI generation
 * calls (decode/translate). Use it for any endpoint that triggers LLM
 * generation; use fetchWithTimeout for fast reads (login, missing lists).
 */
export function fetchAI(
  url: string | URL,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  return fetchWithTimeout(url, { timeout: AI_TIMEOUT_MS, ...options });
}

