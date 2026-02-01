/**
 * User DTOs
 * 
 * API response shapes for user-related endpoints.
 * Ensures passwords and sensitive data are never leaked.
 */

import type { User, UserRole } from '@prisma/client';

/**
 * User response for list/detail endpoints
 * Password is never included
 */
export interface UserResponseDto {
  id: number;
  username: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  isActive: boolean;
  lastLogin: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User response with counts for admin views
 */
export interface UserWithCountsDto extends UserResponseDto {
  _count: {
    connections: number;
    subscriptions: number;
    importSources: number;
  };
}

/**
 * Current user profile response
 */
export interface CurrentUserDto {
  id: number;
  username: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
}

/**
 * Transform a Prisma User to a safe API response DTO
 * Never includes password
 */
export function toUserDto(user: User): UserResponseDto {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Transform to current user profile DTO
 */
export function toCurrentUserDto(user: User): CurrentUserDto {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}

/**
 * Transform user with counts (from Prisma include)
 */
export function toUserWithCountsDto(
  user: User & { _count: { connections: number; subscriptions: number; importSources: number } }
): UserWithCountsDto {
  return {
    ...toUserDto(user),
    _count: user._count,
  };
}

/**
 * Transform multiple users to DTOs
 */
export function toUserDtoList(users: User[]): UserResponseDto[] {
  return users.map(toUserDto);
}
