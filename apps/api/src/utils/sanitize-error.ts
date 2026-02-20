/**
 * Sanitize connection error messages to prevent leaking internal
 * hostnames, Docker service names, IPs, and network topology.
 *
 * The full error is still logged server-side for debugging;
 * only the user-facing message is sanitized.
 */
export function sanitizeConnectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  // Map known error codes to user-friendly messages
  if (message.includes('ECONNREFUSED')) return 'Connection refused — check the URL and ensure the service is running';
  if (message.includes('ENOTFOUND')) return 'Host not found — check the URL';
  if (message.includes('ETIMEDOUT') || message.includes('TimeoutError')) return 'Connection timed out — check the URL and network';
  if (message.includes('ECONNRESET')) return 'Connection reset — the service may be restarting';
  if (message.includes('CERT_') || message.includes('certificate')) return 'SSL certificate error — check the URL scheme (http vs https)';
  if (message.includes('401') || message.includes('Unauthorized')) return 'Authentication failed — check your API key or credentials';
  if (message.includes('403') || message.includes('Forbidden')) return 'Access denied — check your permissions';
  if (message.includes('404')) return 'API endpoint not found — check the URL';
  if (message.includes('ECONNABORTED')) return 'Connection aborted — the service may be unreachable';

  // Default: generic message (the full error is already logged server-side)
  return 'Connection test failed — check your configuration';
}
