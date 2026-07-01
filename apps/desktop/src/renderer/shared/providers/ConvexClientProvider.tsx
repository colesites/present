"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import {
  ensureFreshDesktopAccessToken,
  useDesktopSessionStore,
} from "../store/desktopSession";

const DEFAULT_DESKTOP_CONVEX_URL = "https://wary-iguana-735.convex.cloud";
const convexUrl = process.env.CONVEX_URL ?? DEFAULT_DESKTOP_CONVEX_URL;

if (!process.env.CONVEX_URL) {
  console.warn(
    `[Desktop Auth] CONVEX_URL missing from build env. Using fallback ${DEFAULT_DESKTOP_CONVEX_URL}.`,
  );
}

const convex = new ConvexReactClient(convexUrl);
const DesktopConvexAuthReadyContext = createContext(false);

/**
 * The auth hook handed to ConvexProviderWithAuth. Convex owns the entire auth
 * lifecycle once this is wired up — DO NOT also call `convex.setAuth()`
 * manually anywhere else. Doing both races the WebSocket and produces the
 * "[CONVEX FATAL ERROR] Base version N passed up doesn't match the current
 * version 0" crash, because the manual setAuth resets the server-side state
 * version while the in-flight subscription still references the old one.
 *
 * Convex calls `fetchAccessToken` on its own schedule (initial connect, after
 * token expiry, after reconnect). We must:
 *   - report `isLoading: true` until the session store has hydrated from
 *     persistent storage, otherwise Convex commits to "unauthenticated" with a
 *     stale snapshot and the app gets stuck on the loading screen on first
 *     launch even though the user is signed in;
 *   - report `isAuthenticated` based on whether we have a session token (not
 *     the short-lived access token), because the access token will be
 *     refreshed transparently via `fetchAccessToken` and shouldn't toggle the
 *     auth state.
 */
function useDesktopConvexAuth() {
  const sessionToken = useDesktopSessionStore((state) => state.sessionToken);
  const hasHydratedSession = useDesktopSessionStore(
    (state) => state.hasHydratedSession,
  );

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      // A forced refresh means Convex rejected the token it already has. Never
      // hand that same cached token back or the client can remain stuck in an
      // unauthenticated reconnect loop until its local expiry timestamp.
      const nextToken = await ensureFreshDesktopAccessToken({
        forceRefresh: forceRefreshToken,
      });
      return nextToken;
    },
    [],
  );

  return useMemo(
    () => ({
      isLoading: !hasHydratedSession,
      isAuthenticated: hasHydratedSession && Boolean(sessionToken),
      fetchAccessToken,
    }),
    [fetchAccessToken, hasHydratedSession, sessionToken],
  );
}

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  const hasHydratedSession = useDesktopSessionStore(
    (state) => state.hasHydratedSession,
  );

  return (
    <DesktopConvexAuthReadyContext.Provider value={hasHydratedSession}>
      <ConvexProviderWithAuth client={convex} useAuth={useDesktopConvexAuth}>
        {children}
      </ConvexProviderWithAuth>
    </DesktopConvexAuthReadyContext.Provider>
  );
}

export const useDesktopConvexAuthReady = () =>
  useContext(DesktopConvexAuthReadyContext);
