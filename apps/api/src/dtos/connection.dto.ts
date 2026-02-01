/**
 * Connection DTOs
 * 
 * API response shapes for connection-related endpoints.
 * Ensures sensitive data (API keys, secrets) are masked in responses.
 */

import type { Connection, ConnectionType } from '@prisma/client';

/**
 * Connection response for list/detail endpoints
 * Sensitive config values are masked
 */
export interface ConnectionResponseDto {
  id: number;
  type: ConnectionType;
  name: string;
  isActive: boolean;
  userId: number | null;
  createdAt: Date;
  updatedAt: Date;
  /** Masked config - secrets replaced with placeholder */
  config: ConnectionConfigDto;
  /** Connection status for display */
  status?: 'connected' | 'needs_auth' | 'error' | 'pending';
}

/**
 * Connection config with secrets masked
 */
export interface ConnectionConfigDto {
  // Common fields
  url?: string;
  username?: string;
  
  // Masked secrets - always show placeholder if present
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  
  // Type-specific non-sensitive fields
  countryCode?: string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * List of sensitive fields that should be masked in API responses
 */
const SENSITIVE_FIELDS = [
  'apiKey',
  'apiSecret', 
  'accessToken',
  'refreshToken',
  'clientSecret',
  'token',
  'secret',
  'password',
];

/**
 * Placeholder text for masked values
 */
const MASKED_VALUE = '••••••••';

/**
 * Mask sensitive values in a config object
 */
function maskSensitiveConfig(config: Record<string, unknown>): ConnectionConfigDto {
  const masked: ConnectionConfigDto = {};
  
  for (const [key, value] of Object.entries(config)) {
    if (SENSITIVE_FIELDS.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
      // If value exists, show masked placeholder
      if (value && typeof value === 'string' && value.length > 0) {
        masked[key] = MASKED_VALUE;
      }
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      masked[key] = value;
    }
  }
  
  return masked;
}

/**
 * Transform a Prisma Connection to a safe API response DTO
 */
export function toConnectionDto(connection: Connection): ConnectionResponseDto {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  
  return {
    id: connection.id,
    type: connection.type,
    name: connection.name,
    isActive: connection.isActive,
    userId: connection.userId,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    config: maskSensitiveConfig(config),
    status: determineConnectionStatus(connection),
  };
}

/**
 * Determine connection status for UI display
 */
function determineConnectionStatus(connection: Connection): ConnectionResponseDto['status'] {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  
  // OAuth connections need tokens
  if (['spotify', 'deezer', 'tidal'].includes(connection.type)) {
    if (config.accessToken) {
      return 'connected';
    }
    return 'needs_auth';
  }
  
  // API key connections - check if key is present
  if (connection.isActive) {
    return 'connected';
  }
  
  return 'pending';
}

/**
 * Transform multiple connections to DTOs
 */
export function toConnectionDtoList(connections: Connection[]): ConnectionResponseDto[] {
  return connections.map(toConnectionDto);
}
