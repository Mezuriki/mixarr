'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Sidebar } from './sidebar';
import { LoadingPage } from '@/components/ui/loading';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';

interface ProtectedLayoutProps {
  children: React.ReactNode;
}

// Routes that don't require authentication and have their own layout
const publicRoutes = ['/login', '/setup'];

export function ProtectedLayout({ children }: ProtectedLayoutProps) {
  const { isLoading, isAuthenticated, setupRequired, apiError } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { addToast } = useToast();
  const [updateToastShown, setUpdateToastShown] = useState(false);

  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

  // Fetch version/update status when authenticated
  const { data: healthData } = useQuery<{
    version?: string;
    update?: { latest: string; url: string } | null;
  }>({
    queryKey: ['health-live'],
    queryFn: async () => {
      const res = await fetch('/api/health/live');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled: isAuthenticated,
  });

  // Show update toast once per session
  useEffect(() => {
    if (healthData?.update && !updateToastShown) {
      setUpdateToastShown(true);
      addToast({
        type: 'info',
        title: `Mixarr v${healthData.update.latest} available`,
        message: 'Visit GitHub to download the latest release.',
      });
    }
  }, [healthData, updateToastShown, addToast]);

  useEffect(() => {
    if (isLoading) return;
    
    // Don't redirect while API is unreachable - keep showing loading
    if (apiError) return;

    if (!isAuthenticated && !isPublicRoute) {
      // Use cached setupRequired from auth context - no additional API call needed
      if (setupRequired) {
        router.push('/setup');
      } else {
        // Include returnTo so user is redirected back after login
        const returnTo = encodeURIComponent(pathname);
        router.push(`/login?returnTo=${returnTo}`);
      }
    }

    // Only redirect from login page, NOT from setup (user needs to complete wizard)
    if (isAuthenticated && pathname === '/login') {
      router.push('/');
    }
  }, [isLoading, isAuthenticated, pathname, router, isPublicRoute, setupRequired, apiError]);

  // Show loading state while checking auth or waiting for API
  if (isLoading || apiError) {
    return <LoadingPage text={apiError ? "Connecting to server..." : "Checking authentication..."} />;
  }

  // For public routes (login, setup), render just the children with no sidebar
  if (isPublicRoute) {
    return <>{children}</>;
  }

  // Not authenticated and not a public route - show loading while redirect happens
  if (!isAuthenticated) {
    return <LoadingPage text="Redirecting to login..." />;
  }

  // Authenticated - show full layout with sidebar
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto lg:pl-0 pl-0 pt-16 lg:pt-0">
        <div className="container mx-auto px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
