"use client";

import { useEffect, useState } from "react";
import { useQuery as useConvexQuery } from "convex/react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  FunctionReference,
  FunctionArgs,
  FunctionReturnType,
} from "convex/server";

/**
 * A hook that wraps Convex queries with TanStack Query caching for offline support.
 *
 * - Uses Convex for real-time data when online
 * - Caches data in TanStack Query (persisted to localStorage)
 * - Returns cached data when offline or Convex hasn't loaded yet
 */
export function useCachedConvexQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
  cacheKey: string,
): FunctionReturnType<Query> | undefined {
  const queryClient = useQueryClient();
  const queryKeyString = JSON.stringify(args);
  const fullQueryKey = ["convex-cache", cacheKey, queryKeyString];

  // Use Convex query for real-time data
  const convexData = useConvexQuery(query, args);

  // Get cached data from TanStack Query on initial render
  const [cachedData, setCachedData] = useState<
    FunctionReturnType<Query> | undefined
  >(() => {
    return queryClient.getQueryData(fullQueryKey) as
      | FunctionReturnType<Query>
      | undefined;
  });

  // Update TanStack Query cache when Convex data changes
  useEffect(() => {
    if (convexData !== undefined) {
      queryClient.setQueryData(fullQueryKey, convexData);
      setCachedData(convexData);
    }
  }, [convexData, queryClient, cacheKey, queryKeyString, fullQueryKey]);

  // Listen for cache updates (from persistence restore)
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === "updated" &&
        JSON.stringify(event.query.queryKey) === JSON.stringify(fullQueryKey)
      ) {
        const data = queryClient.getQueryData(fullQueryKey) as
          | FunctionReturnType<Query>
          | undefined;
        if (data !== undefined) {
          setCachedData(data);
        }
      }
    });
    return unsubscribe;
  }, [queryClient, fullQueryKey]);

  // Return Convex data if available, otherwise return cached data
  return convexData ?? cachedData;
}

/**
 * Check if we're currently online
 */
export function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    setIsOnline(navigator.onLine);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
