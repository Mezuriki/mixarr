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
// MUST be > navidrome OpenAI timeout (500s). Z.ai glm-5-turbo with reasoning can
// take 200+ seconds per song. BATCH_SIZE=2 → up to 400-500s total.
const AI_TIMEOUT_MS = 520_000;

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

