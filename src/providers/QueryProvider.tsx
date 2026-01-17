"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { useState, type ReactNode, useEffect } from "react";

interface QueryProviderProps {
  children: ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Longer cache times for offline support
            staleTime: 1000 * 60 * 5, // 5 minutes - data is considered fresh
            gcTime: 1000 * 60 * 60 * 24, // 24 hours - keep in cache for a day
            retry: 2,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            // Use stale data while refetching
            networkMode: "offlineFirst",
          },
          mutations: {
            retry: 2,
            networkMode: "offlineFirst",
          },
        },
      })
  );

  // Create persister only on client
  const [persister, setPersister] = useState<ReturnType<typeof createSyncStoragePersister> | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPersister(
        createSyncStoragePersister({
          storage: window.localStorage,
          key: "present-query-cache",
        })
      );
    }
  }, []);

  // Always provide QueryClient, use PersistQueryClientProvider only when persister is ready
  if (!isClient || !persister) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        buster: "v1", // Change this to invalidate all caches
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
