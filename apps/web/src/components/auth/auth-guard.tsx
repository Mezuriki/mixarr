'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { LoadingPage } from '@/components/ui';

interface AuthGuardProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

// Public routes that don't require authentication
const publicRoutes = ['/login', '/setup'];

export function AuthGuard({ children, requireAdmin = false }: AuthGuardProps) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;

    const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

    if (!isAuthenticated && !isPublicRoute) {
      // Check if setup is required
      fetch('/api/auth/setup-required')
        .then(res => res.json())
        .then(data => {
          if (data.setupRequired) {
            router.push('/setup');
          } else {
            router.push('/login');
          }
        })
        .catch(() => router.push('/login'));
    }

    if (isAuthenticated && (pathname === '/login' || pathname === '/setup')) {
      router.push('/');
    }

    if (requireAdmin && user?.role !== 'admin') {
      router.push('/');
    }
  }, [isLoading, isAuthenticated, user, pathname, router, requireAdmin]);

  if (isLoading) {
    return <LoadingPage text="Checking authentication..." />;
  }

  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));
  if (!isAuthenticated && !isPublicRoute) {
    return <LoadingPage text="Redirecting..." />;
  }

  if (requireAdmin && user?.role !== 'admin') {
    return <LoadingPage text="Access denied" />;
  }

  return <>{children}</>;
}
