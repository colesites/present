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
  getStoredDesktopToken,
  useDesktopSessionStore,
} from "../store/desktopSession";

const convexUrl = process.env.CONVEX_URL;
if (!convexUrl) {
  throw new Error("CONVEX_URL is not set");
}

const convex = new ConvexReactClient(convexUrl);
const DesktopConvexAuthReadyContext = createContext(false);

function useDesktopConvexAuth() {
  const token = useDesktopSessionStore((state) => state.token);

  const fetchAccessToken = useCallback(async () => {
    console.info("[Desktop Auth] token attached to Convex", {
      hasToken: Boolean(token),
      tokenLength: token?.length ?? 0,
    });
    return token;
  }, [token]);

  return useMemo(
    () => ({
      isLoading: false,
      isAuthenticated: Boolean(token),
      fetchAccessToken,
    }),
    [fetchAccessToken, token]
  );
}

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  const token = useDesktopSessionStore((state) => state.token);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    setIsAuthReady(false);
    convex.setAuth(async () => {
      const storedToken = await getStoredDesktopToken();
      const resolvedToken = storedToken ?? token ?? null;
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
  }, [token]);

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
