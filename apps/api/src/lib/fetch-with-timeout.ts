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
// AI generation calls (decode / translate) can take much longer than a simple
// HTTP read — a reasoning model producing a full Markdown analysis routinely
// needs 60-120s. The previous 30s default aborted the very first decode.
const AI_TIMEOUT_MS = 180_000; // 3 minutes for AI generation calls

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

