/**
 * Fetch with Timeout Wrapper
 *
 * Wraps the global fetch() with an automatic timeout using AbortSignal.timeout().
 * If the caller already provides a signal, both are combined with AbortSignal.any()
 * so that either the caller's abort or the timeout will cancel the request.
 *
 * Requires Node.js 20.3+ for AbortSignal.any() support.
 */
import { Agent, fetch as undiciFetch } from 'undici';

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds (library reads, login, etc.)
// MUST be > navidrome OpenAI timeout (500s). Z.ai glm-5-turbo with reasoning can
// take 200+ seconds per song. BATCH_SIZE=2 → up to 400-500s total.
const AI_TIMEOUT_MS = 520_000;

// AI calls go through a dedicated undici agent. Node's global fetch silently
// kills any request whose response HEADERS don't arrive within 300s (default
// headersTimeout) — navidrome's batch endpoints respond only AFTER every song's
// Z.ai generation finishes (2 × up to ~220s), so batches were dying at exactly
// 5:00 with "fetch failed". Header/body timeouts here must exceed AI_TIMEOUT_MS
// so our own AbortSignal fires first.
const aiAgent = new Agent({
  headersTimeout: 600_000, // 10 min
  bodyTimeout: 600_000,
});

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
 *
 * Uses undici's own fetch + agent (not the global fetch) so the raised
 * headersTimeout actually applies — Node's global fetch ignores dispatchers
 * from a separate undici copy.
 */
export function fetchAI(
  url: string | URL,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = AI_TIMEOUT_MS, ...fetchOptions } = options as RequestInit & { timeout?: number };

  const timeoutSignal = AbortSignal.timeout(timeout);
  const callerSignal = (fetchOptions as { signal?: AbortSignal | null }).signal;
  const signal = callerSignal
    ? AbortSignal.any([timeoutSignal, callerSignal])
    : timeoutSignal;

  return undiciFetch(url as unknown as Parameters<typeof undiciFetch>[0], {
    ...(fetchOptions as Record<string, unknown>),
    dispatcher: aiAgent,
    signal,
  }) as unknown as Promise<Response>;
}
