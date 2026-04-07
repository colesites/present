"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
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

function useDesktopConvexAuth() {
  const sessionToken = useDesktopSessionStore((state) => state.sessionToken);

  const fetchAccessToken = useCallback(async () => {
    const nextToken = await ensureFreshDesktopAccessToken();
    console.info("[Desktop Auth] token attached to Convex", {
      hasSessionToken: Boolean(sessionToken),
      hasToken: Boolean(nextToken),
      tokenLength: nextToken?.length ?? 0,
    });
    return nextToken;
  }, [sessionToken]);

  return useMemo(
    () => ({
      isLoading: false,
      isAuthenticated: Boolean(sessionToken),
      fetchAccessToken,
    }),
    [fetchAccessToken, sessionToken]
  );
}

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  const sessionToken = useDesktopSessionStore((state) => state.sessionToken);
  const token = useDesktopSessionStore((state) => state.token);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    setIsAuthReady(false);
    convex.setAuth(async () => {
      const resolvedToken =
        (await ensureFreshDesktopAccessToken()) ?? token ?? null;
      console.info("[Convex Auth Debug] token being sent:", {
        exists: Boolean(resolvedToken),
        length: resolvedToken?.length ?? 0,
      });
      return resolvedToken;
    });
    setIsAuthReady(true);
    console.info("[Desktop Auth] setAuth applied", {
      hasToken: Boolean(token),
      tokenLength: token?.length ?? 0,
      convexUrl,
    });
  }, [sessionToken, token]);

  return (
    <DesktopConvexAuthReadyContext.Provider value={isAuthReady}>
      <ConvexProviderWithAuth client={convex} useAuth={useDesktopConvexAuth}>
        {children}
      </ConvexProviderWithAuth>
    </DesktopConvexAuthReadyContext.Provider>
  );
}

export const useDesktopConvexAuthReady = () =>
  useContext(DesktopConvexAuthReadyContext);
