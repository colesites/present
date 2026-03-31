"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useWorkspaceStore } from "../../../../../../packages/shared/src/store/workspace";
import { decodeJwtPayload } from "../lib/utils";

export interface DesktopUser {
  id: string;
  name: string;
  email: string;
}

export interface DesktopOrganization {
  id: string;
  name: string;
  type: "personal" | "organization";
  logo?: string;
}

export type DesktopAuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated";

interface DesktopSessionState {
  refreshToken: string | null;
  token: string | null;
  user: DesktopUser | null;
  organizations: DesktopOrganization[];
  orgId: string | null;
  authStatus: DesktopAuthStatus;
  error: string | null;
  setAuthTokens: (payload: DesktopAuthPayload | null) => void;
  clearSession: () => void;
  setSessionFromConvex: (payload: {
    user: DesktopUser;
    organizations: DesktopOrganization[];
    currentOrgId?: string | null;
  }) => void;
  setAuthStatus: (status: DesktopAuthStatus) => void;
  setError: (error: string | null) => void;
  setOrgId: (orgId: string) => void;
}

const SESSION_STORAGE_KEY = "present-desktop-session";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

let desktopAccessTokenRefreshPromise: Promise<string | null> | null = null;

const resolveDesktopWebBaseUrl = (): string => {
  const configured = process.env.WEB_APP_URL;
  if (configured) {
    return configured;
  }
  return process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : "https://present-gha.vercel.app";
};

const getTokenExpiryTimestampMs = (token: string): number | null => {
  const payload = decodeJwtPayload(token);
  const expClaim = payload?.exp;
  if (typeof expClaim !== "number") {
    return null;
  }
  return expClaim * 1000;
};

const shouldRefreshToken = (token: string): boolean => {
  const expiryMs = getTokenExpiryTimestampMs(token);
  if (!expiryMs) {
    return false;
  }
  return expiryMs <= Date.now() + TOKEN_REFRESH_BUFFER_MS;
};

const isTokenExpired = (token: string): boolean => {
  const expiryMs = getTokenExpiryTimestampMs(token);
  if (!expiryMs) {
    return false;
  }
  return expiryMs <= Date.now();
};

const persistTokenFailure = (message: string): null => {
  const state = useDesktopSessionStore.getState();
  state.clearSession();
  state.setError(message);
  return null;
};

export const getStoredDesktopAuth = async (): Promise<DesktopAuthPayload | null> => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as
      | { state?: { refreshToken?: string | null; token?: string | null } }
      | null;
    const token = parsed?.state?.token;
    const refreshToken = parsed?.state?.refreshToken;
    if (typeof token !== "string" || token.length === 0) {
      return null;
    }
    return {
      refreshToken:
        typeof refreshToken === "string" && refreshToken.length > 0
          ? refreshToken
          : null,
      token,
    };
  } catch {
    return null;
  }
};

export const getStoredDesktopToken = async (): Promise<string | null> => {
  const auth = await getStoredDesktopAuth();
  return auth?.token ?? null;
};

const refreshDesktopAccessToken = async (
  refreshToken: string
): Promise<DesktopAuthPayload | null> => {
  const response = await fetch(
    `${resolveDesktopWebBaseUrl()}/api/auth/desktop/refresh`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refreshToken,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Desktop refresh failed with status ${response.status}`);
  }

  const payload = (await response.json()) as Partial<DesktopAuthPayload> | null;
  if (
    !payload ||
    typeof payload.token !== "string" ||
    payload.token.length === 0
  ) {
    throw new Error("Desktop refresh response did not include a token");
  }

  return {
    refreshToken:
      typeof payload.refreshToken === "string" && payload.refreshToken.length > 0
        ? payload.refreshToken
        : refreshToken,
    token: payload.token,
  };
};

export const ensureFreshDesktopAccessToken = async (): Promise<string | null> => {
  const currentState = useDesktopSessionStore.getState();
  const stateToken = currentState.token;
  const stateRefreshToken = currentState.refreshToken;

  if (stateToken && !shouldRefreshToken(stateToken)) {
    return stateToken;
  }

  const storedAuth = await getStoredDesktopAuth();
  const token = stateToken ?? storedAuth?.token ?? null;
  const refreshToken = stateRefreshToken ?? storedAuth?.refreshToken ?? null;

  if (token && !shouldRefreshToken(token)) {
    return token;
  }

  if (!refreshToken) {
    return token && token.length > 0
      ? persistTokenFailure("Session expired. Please sign in again.")
      : null;
  }

  if (!desktopAccessTokenRefreshPromise) {
    const fallbackToken = token;
    desktopAccessTokenRefreshPromise = refreshDesktopAccessToken(refreshToken)
      .then((payload) => {
        if (!payload) {
          return persistTokenFailure("Session expired. Please sign in again.");
        }
        useDesktopSessionStore.getState().setAuthTokens(payload);
        return payload.token;
      })
      .catch((error) => {
        console.error("[Desktop Auth] token refresh failed", error);
        if (fallbackToken && !isTokenExpired(fallbackToken)) {
          return fallbackToken;
        }
        return persistTokenFailure("Session expired. Please sign in again.");
      })
      .finally(() => {
        desktopAccessTokenRefreshPromise = null;
      });
  }

  return desktopAccessTokenRefreshPromise;
};

export const useDesktopSessionStore = create<DesktopSessionState>()(
  persist(
    (set, get): DesktopSessionState => ({
      refreshToken: null,
      token: null,
      user: null,
      organizations: [],
      orgId: null,
      authStatus: "unauthenticated",
      error: null,
      setAuthTokens: (payload: DesktopAuthPayload | null) => {
        const nextToken = payload?.token ?? null;
        const nextRefreshToken = payload?.refreshToken ?? null;
        console.info("[Desktop Auth] token stored", {
          hasRefreshToken: Boolean(nextRefreshToken),
          hasToken: Boolean(nextToken),
          tokenLength: nextToken?.length ?? 0,
        });
        useWorkspaceStore.getState().setWorkspace("personal", null);
        set(() => ({
          refreshToken: nextRefreshToken,
          token: nextToken,
          user: null,
          organizations: [],
          orgId: null,
          authStatus: nextToken ? "loading" : "unauthenticated",
          error: null,
        }));
      },
      clearSession: () => {
        desktopAccessTokenRefreshPromise = null;
        useWorkspaceStore.getState().setWorkspace("personal", null);
        set({
          refreshToken: null,
          token: null,
          user: null,
          organizations: [],
          orgId: null,
          authStatus: "unauthenticated",
          error: null,
        });
      },
      setSessionFromConvex: ({
        user,
        organizations,
        currentOrgId,
      }: {
        user: DesktopUser;
        organizations: DesktopOrganization[];
        currentOrgId?: string | null;
      }) => {
        const selectedOrg =
          (currentOrgId
            ? organizations.find((org) => org.id === currentOrgId)
            : null) ??
          organizations[0] ??
          null;
        if (selectedOrg) {
          useWorkspaceStore
            .getState()
            .setWorkspace(
              selectedOrg.type === "personal" ? "personal" : "organization",
              selectedOrg.type === "personal" ? null : selectedOrg.id
            );
        }
        set({
          user,
          organizations,
          orgId: selectedOrg?.id ?? null,
          authStatus: "authenticated",
          error: null,
        });
      },
      setAuthStatus: (status: DesktopAuthStatus) => set({ authStatus: status }),
      setError: (error: string | null) => set({ error }),
      setOrgId: (orgId: string) => {
        const target = get().organizations.find((org) => org.id === orgId);
        if (!target) {
          return;
        }
        useWorkspaceStore
          .getState()
          .setWorkspace(
            target.type === "personal" ? "personal" : "organization",
            target.type === "personal" ? null : target.id
          );
        set({ orgId, error: null });
      },
    }),
    {
      name: SESSION_STORAGE_KEY,
      storage: createJSONStorage(() => window.localStorage),
      partialize: (state) => ({
        refreshToken: state.refreshToken,
        token: state.token,
        orgId: state.orgId,
      }),
    }
  )
);
