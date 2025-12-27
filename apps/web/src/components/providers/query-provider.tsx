'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

interface QueryProviderProps {
  children: React.ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  // Create client inside component to prevent sharing state between requests in SSR
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data considered fresh for 30 seconds - won't refetch during this time
            staleTime: 30 * 1000,
            // Cache data for 5 minutes even after it becomes stale
            gcTime: 5 * 60 * 1000,
            // Don't refetch on window focus by default (can enable per-query)
            refetchOnWindowFocus: false,
            // Retry failed requests once
            retry: 1,
            // Don't retry on 4xx errors
            retryOnMount: true,
          },
          mutations: {
            // Retry mutations once on failure
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
