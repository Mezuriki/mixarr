/**
 * Service URL Validation
 *
 * Validates and sanitizes URLs used for connecting to external services
 * (Lidarr, slskd, etc.). These URLs are configured by administrators,
 * not end users, but validation prevents misconfiguration and SSRF via
 * compromised database values.
 */

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * Validate that a service URL is a well-formed HTTP(S) URL.
 * Rejects non-HTTP protocols (file://, ftp://, etc.) and malformed URLs.
 *
 * @throws Error if the URL is invalid or uses a disallowed protocol
 */
export function validateServiceUrl(url: string, serviceName: string): string {
  if (!url || typeof url !== 'string') {
    throw new Error(`${serviceName}: URL is required`);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${serviceName}: Invalid URL format: ${url}`);
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(
      `${serviceName}: URL must use http or https protocol, got ${parsed.protocol}`
    );
  }

  // Return normalized URL (without trailing slash)
  return parsed.origin + parsed.pathname.replace(/\/$/, '');
}
