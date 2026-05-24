"use client";

import { create } from "zustand";
import { useWorkspaceStore } from "../../../../../../packages/shared/src/store/workspace";
import { decodeJwtPayload } from "../lib/utils";

export interface DesktopUser {
  id: string;
  name: string;
  email: string;
  billing?: {
    planKey: string;
    planLabel: string;
    planSlug?: string | null;
    status: string;
    isPaid: boolean;
    quotaSeconds: number;
    usedSeconds: number;
    remainingSeconds: number;
    periodStartMs: number;
    periodEndMs: number;
  };
}

export type DesktopBillingSnapshot = NonNullable<DesktopUser["billing"]>;

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
  sessionToken: string | null;
  sessionExpiresAtMs: number | null;
  token: string | null;
  tokenExpiresAtMs: number | null;
  user: DesktopUser | null;
  organizations: DesktopOrganization[];
  orgId: string | null;
  authStatus: DesktopAuthStatus;
  error: string | null;
  hasHydratedSession: boolean;
  hydrateAuthSession: () => Promise<void>;
  setAuthTokens: (payload: DesktopAuthPayload | null) => void;
  clearSession: () => void;
  setSessionFromConvex: (payload: {
    user: DesktopUser;
    organizations: DesktopOrganization[];
    currentOrgId?: string | null;
    currentWorkspace?: {
      type: "personal" | "organization";
      orgId: string | null;
    } | null;
  }) => void;
  setAuthStatus: (status: DesktopAuthStatus) => void;
  setError: (error: string | null) => void;
  setOrgId: (orgId: string) => void;
}

type DesktopRefreshResponse = {
  accessToken?: string;
  accessTokenExpiresAt?: number;
  refreshToken?: string;
  sessionExpiresAt?: number;
  sessionToken?: string;
  token?: string;
};

class DesktopRefreshError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

let desktopAccessTokenRefreshPromise: Promise<string | null> | null = null;

const resolveDesktopWebBaseUrl = (): string => {
  const configured = process.env.WEB_APP_URL;
  if (configured) {
    return configured;
  }
  return process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : "https://present.c-technology-inc.com";
};

const decodeBase64UrlSegment = (value: string): string | null => {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padding);
    return atob(padded);
  } catch {
    return null;
  }
};

const decodeDesktopSessionTokenPayload = (
  sessionToken: string
): Record<string, unknown> | null => {
  const [payloadSegment] = sessionToken.split(".");
  if (!payloadSegment) {
    return null;
  }

  const decoded = decodeBase64UrlSegment(payloadSegment);
  if (!decoded) {
    return null;
  }

  try {
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const getSessionExpiryTimestampMs = (sessionToken: string): number | null => {
  const payload = decodeDesktopSessionTokenPayload(sessionToken);
  const expClaim = payload?.exp;
  if (typeof expClaim !== "number") {
    return null;
  }
  return expClaim * 1000;
};

const getTokenExpiryTimestampMs = (token: string): number | null => {
  const payload = decodeJwtPayload(token);
  const expClaim = payload?.exp;
  if (typeof expClaim !== "number") {
    return null;
  }
  return expClaim * 1000;
};

const isTimestampExpired = (timestampMs: number | null): boolean => {
  if (!timestampMs) {
    return false;
  }
  return timestampMs <= Date.now();
};

const shouldRefreshAccessToken = (tokenExpiryTimestampMs: number | null): boolean => {
  if (!tokenExpiryTimestampMs) {
    return true;
  }
  return tokenExpiryTimestampMs <= Date.now() + TOKEN_REFRESH_BUFFER_MS;
};

const isOnline = (): boolean => {
  if (typeof navigator === "undefined") {
    return true;
  }
  return navigator.onLine;
};

const normalizeStoredSession = (
  payload: DesktopStoredAuthSession | null
): DesktopStoredAuthSession | null => {
  if (!payload) {
    return null;
  }

  if (typeof payload.sessionToken !== "string" || payload.sessionToken.length === 0) {
    return null;
  }

  return {
    orgId: typeof payload.orgId === "string" ? payload.orgId : null,
    organizations: Array.isArray(payload.organizations) ? payload.organizations : [],
    savedAtMs:
      typeof payload.savedAtMs === "number" && Number.isFinite(payload.savedAtMs)
        ? payload.savedAtMs
        : Date.now(),
    sessionExpiresAtMs:
      typeof payload.sessionExpiresAtMs === "number" &&
      Number.isFinite(payload.sessionExpiresAtMs)
        ? payload.sessionExpiresAtMs
        : null,
    sessionToken: payload.sessionToken,
    token: typeof payload.token === "string" ? payload.token : null,
    tokenExpiresAtMs:
      typeof payload.tokenExpiresAtMs === "number" &&
      Number.isFinite(payload.tokenExpiresAtMs)
        ? payload.tokenExpiresAtMs
        : null,
    user: payload.user,
  };
};

const buildStoredSessionPayload = (
  state: Pick<
    DesktopSessionState,
    | "orgId"
    | "organizations"
    | "sessionExpiresAtMs"
    | "sessionToken"
    | "token"
    | "tokenExpiresAtMs"
    | "user"
  >
): DesktopStoredAuthSession | null => {
  if (!state.sessionToken) {
    return null;
  }

  return {
    orgId: state.orgId,
    organizations: state.organizations,
    savedAtMs: Date.now(),
    sessionExpiresAtMs: state.sessionExpiresAtMs,
    sessionToken: state.sessionToken,
    token: state.token,
    tokenExpiresAtMs: state.tokenExpiresAtMs,
    user: state.user,
  };
};

const persistSessionSnapshot = async (
  state: Pick<
    DesktopSessionState,
    | "orgId"
    | "organizations"
    | "sessionExpiresAtMs"
    | "sessionToken"
    | "token"
    | "tokenExpiresAtMs"
    | "user"
  >
): Promise<void> => {
  if (typeof window === "undefined" || !window.electronAPI) {
    return;
  }

  const payload = buildStoredSessionPayload(state);
  try {
    if (!payload) {
      await window.electronAPI.clearStoredAuthSession();
      return;
    }
    await window.electronAPI.setStoredAuthSession(payload);
  } catch (error) {
    console.error("[Desktop Auth] failed to persist auth session", error);
  }
};

export const getStoredDesktopAuth = async (): Promise<DesktopStoredAuthSession | null> => {
  if (typeof window === "undefined" || !window.electronAPI?.getStoredAuthSession) {
    return null;
  }

  try {
    const payload = await window.electronAPI.getStoredAuthSession();
    return normalizeStoredSession(payload);
  } catch (error) {
    console.error("[Desktop Auth] failed to load stored auth session", error);
    return null;
  }
};

export const getStoredDesktopToken = async (): Promise<string | null> => {
  const auth = await getStoredDesktopAuth();
  return auth?.token ?? null;
};

type DesktopRefreshIpcOutcome =
  | { ok: true; data: DesktopRefreshResponse | null }
  | { ok: false; status: number; error: string };

const isStructuredOutcome = (value: unknown): value is DesktopRefreshIpcOutcome => {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in (value as Record<string, unknown>) &&
    typeof (value as { ok: unknown }).ok === "boolean"
  );
};

const fetchDesktopRefreshPayload = async (
  sessionToken: string
): Promise<DesktopRefreshResponse | null> => {
  if (window.electronAPI?.refreshDesktopSession) {
    const result: unknown = await window.electronAPI.refreshDesktopSession(sessionToken);
    if (isStructuredOutcome(result)) {
      if (result.ok === true) {
        return result.data;
      }
      const failure = result as { ok: false; status: number; error: string };
      throw new DesktopRefreshError(failure.error, failure.status || 0);
    }
    // Backwards-compat: old IPC returned the raw payload or null.
    return (result ?? null) as DesktopRefreshResponse | null;
  }

  const response = await fetch(
    `${resolveDesktopWebBaseUrl()}/api/auth/desktop/refresh-session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionToken,
      }),
    }
  );

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new DesktopRefreshError(
      message || `Desktop refresh failed with status ${response.status}`,
      response.status
    );
  }

  return (await response.json()) as DesktopRefreshResponse | null;
};

const isAuthFailureStatus = (status: number): boolean => {
  return status === 401 || status === 403;
};

const isTransientNetworkStatus = (status: number): boolean => {
  // 0 = network/fetch failure surfaced by IPC; 5xx = upstream blip; 408/429 = retryable.
  if (status === 0 || status === 408 || status === 429) return true;
  return status >= 500 && status < 600;
};

const refreshDesktopAccessToken = async (
  sessionToken: string
): Promise<{
  accessToken: string;
  accessTokenExpiresAtMs: number | null;
  sessionExpiresAtMs: number | null;
  sessionToken: string;
}> => {
  const payload = await fetchDesktopRefreshPayload(sessionToken);
  const nextAccessToken = payload?.accessToken ?? payload?.token;
  const nextSessionToken = payload?.sessionToken ?? payload?.refreshToken;

  if (
    !payload ||
    typeof nextAccessToken !== "string" ||
    nextAccessToken.length === 0 ||
    typeof nextSessionToken !== "string" ||
    nextSessionToken.length === 0
  ) {
    throw new DesktopRefreshError(
      "Desktop refresh response did not include credentials",
      500
    );
  }

  const accessTokenExpiresAtMs =
    typeof payload.accessTokenExpiresAt === "number" &&
    Number.isFinite(payload.accessTokenExpiresAt)
      ? payload.accessTokenExpiresAt * 1000
      : getTokenExpiryTimestampMs(nextAccessToken);

  const sessionExpiresAtMs =
    typeof payload.sessionExpiresAt === "number" &&
    Number.isFinite(payload.sessionExpiresAt)
      ? payload.sessionExpiresAt * 1000
      : getSessionExpiryTimestampMs(nextSessionToken);

  return {
    accessToken: nextAccessToken,
    accessTokenExpiresAtMs,
    sessionExpiresAtMs,
    sessionToken: nextSessionToken,
  };
};

const persistTokenFailure = (message: string, clearSession: boolean): null => {
  const state = useDesktopSessionStore.getState();
  if (clearSession) {
    state.clearSession();
  }
  state.setAuthStatus("unauthenticated");
  state.setError(message);
  return null;
};

export const ensureFreshDesktopAccessToken = async (): Promise<string | null> => {
  const currentState = useDesktopSessionStore.getState();
  const stateToken = currentState.token;
  const stateTokenExpiresAtMs =
    currentState.tokenExpiresAtMs ??
    (stateToken ? getTokenExpiryTimestampMs(stateToken) : null);
  const stateSessionToken = currentState.sessionToken;
  const stateSessionExpiresAtMs =
    currentState.sessionExpiresAtMs ??
    (stateSessionToken ? getSessionExpiryTimestampMs(stateSessionToken) : null);

  if (!stateSessionToken) {
    return null;
  }

  if (isTimestampExpired(stateSessionExpiresAtMs)) {
    return isOnline()
      ? persistTokenFailure("Session expired. Please sign in again.", true)
      : persistTokenFailure("Session expired. Reconnect to continue.", false);
  }

  if (stateToken && !shouldRefreshAccessToken(stateTokenExpiresAtMs)) {
    return stateToken;
  }

  if (!isOnline()) {
    if (stateToken && !isTimestampExpired(stateTokenExpiresAtMs)) {
      return stateToken;
    }
    return null;
  }

  if (!desktopAccessTokenRefreshPromise) {
    const fallbackToken = stateToken;
    const fallbackTokenExpiryMs = stateTokenExpiresAtMs;

    desktopAccessTokenRefreshPromise = refreshDesktopAccessToken(stateSessionToken)
      .then((payload) => {
        useDesktopSessionStore.setState((previous) => {
          const nextState: Partial<DesktopSessionState> = {
            error: null,
            sessionExpiresAtMs: payload.sessionExpiresAtMs,
            sessionToken: payload.sessionToken,
            token: payload.accessToken,
            tokenExpiresAtMs: payload.accessTokenExpiresAtMs,
          };

          if (previous.user && previous.organizations.length > 0) {
            nextState.authStatus = "authenticated";
          }

          return nextState;
        });

        const snapshot = useDesktopSessionStore.getState();
        void persistSessionSnapshot(snapshot);

        return payload.accessToken;
      })
      .catch((error) => {
        console.warn("[Desktop Auth] token refresh failed", error);

        // Only a definitive 401/403 from the auth server means the session is
        // truly invalid — that is the only case where we sign the user out.
        if (
          error instanceof DesktopRefreshError &&
          isAuthFailureStatus(error.status)
        ) {
          return persistTokenFailure("Session expired. Please sign in again.", true);
        }

        // Transient: network blip, 5xx, timeout. Keep the existing session and
        // let the next refresh attempt succeed. Surface a soft error message
        // but DO NOT flip authStatus — that's what was logging users out.
        const status =
          error instanceof DesktopRefreshError ? error.status : 0;
        const transient =
          !isOnline() ||
          isTransientNetworkStatus(status) ||
          !(error instanceof DesktopRefreshError);

        if (transient) {
          const currentState = useDesktopSessionStore.getState();
          currentState.setError(
            isOnline()
              ? "Reconnecting to Present services…"
              : "You're offline. Reconnect to sync your account."
          );
          if (fallbackToken && !isTimestampExpired(fallbackTokenExpiryMs)) {
            return fallbackToken;
          }
          return null;
        }

        // Definitive non-auth failure (e.g. 4xx other than 401/403): keep the
        // session but flag an error. Still don't auto sign out — the user can
        // decide to re-auth manually if it persists.
        const currentState = useDesktopSessionStore.getState();
        currentState.setError(
          error instanceof Error
            ? error.message
            : "Session refresh failed."
        );
        if (fallbackToken && !isTimestampExpired(fallbackTokenExpiryMs)) {
          return fallbackToken;
        }
        return null;
      })
      .finally(() => {
        desktopAccessTokenRefreshPromise = null;
      });
  }

  return desktopAccessTokenRefreshPromise;
};

export const updateDesktopBillingSnapshot = (
  billing: DesktopBillingSnapshot | null | undefined,
): void => {
  useDesktopSessionStore.setState((previous) => {
    if (!previous.user) {
      return {};
    }

    return {
      user: {
        ...previous.user,
        billing: billing ?? undefined,
      },
    };
  });

  const snapshot = useDesktopSessionStore.getState();
  void persistSessionSnapshot(snapshot);
};

export const useDesktopSessionStore = create<DesktopSessionState>()((set, get) => ({
  sessionToken: null,
  sessionExpiresAtMs: null,
  token: null,
  tokenExpiresAtMs: null,
  user: null,
  organizations: [],
  orgId: null,
  authStatus: "loading",
  error: null,
  hasHydratedSession: false,

  hydrateAuthSession: async () => {
    if (get().hasHydratedSession) {
      return;
    }

    if (get().sessionToken) {
      set({ hasHydratedSession: true });
      return;
    }

    const stored = await getStoredDesktopAuth();
    if (!stored) {
      if (get().sessionToken) {
        set({ hasHydratedSession: true });
        return;
      }
      set({
        authStatus: "unauthenticated",
        hasHydratedSession: true,
      });
      return;
    }

    const sessionExpiresAtMs =
      stored.sessionExpiresAtMs ?? getSessionExpiryTimestampMs(stored.sessionToken);

    if (isTimestampExpired(sessionExpiresAtMs)) {
      await window.electronAPI?.clearStoredAuthSession?.();
      set({
        authStatus: "unauthenticated",
        error: "Session expired. Please sign in again.",
        hasHydratedSession: true,
      });
      return;
    }

    const tokenExpiresAtMs =
      stored.tokenExpiresAtMs ??
      (stored.token ? getTokenExpiryTimestampMs(stored.token) : null);

    const hasCachedIdentity =
      Boolean(stored.user) && Array.isArray(stored.organizations) && stored.organizations.length > 0;

    set({
      authStatus: hasCachedIdentity ? "authenticated" : "loading",
      hasHydratedSession: true,
      orgId: stored.orgId,
      organizations: stored.organizations,
      sessionExpiresAtMs,
      sessionToken: stored.sessionToken,
      token: stored.token,
      tokenExpiresAtMs,
      user: stored.user,
    });
  },

  setAuthTokens: (payload: DesktopAuthPayload | null) => {
    desktopAccessTokenRefreshPromise = null;

    if (!payload?.sessionToken) {
      useWorkspaceStore.getState().setWorkspace("personal", null);
      set({
        authStatus: "unauthenticated",
        error: null,
        orgId: null,
        organizations: [],
        sessionExpiresAtMs: null,
        sessionToken: null,
        token: null,
        tokenExpiresAtMs: null,
        user: null,
      });
      void persistSessionSnapshot(get());
      return;
    }

    const nextSessionExpiresAtMs = getSessionExpiryTimestampMs(payload.sessionToken);
    const nextToken =
      typeof payload.accessToken === "string" && payload.accessToken.length > 0
        ? payload.accessToken
        : null;
    const nextTokenExpiresAtMs =
      nextToken ? getTokenExpiryTimestampMs(nextToken) : null;

    useWorkspaceStore.getState().setWorkspace("personal", null);
    set(() => ({
      authStatus: "loading",
      error: null,
      orgId: null,
      organizations: [],
      sessionExpiresAtMs: nextSessionExpiresAtMs,
      sessionToken: payload.sessionToken,
      token: nextToken,
      tokenExpiresAtMs: nextTokenExpiresAtMs,
      user: null,
    }));

    console.info("[Desktop Auth] session stored", {
      hasAccessToken: Boolean(nextToken),
      hasSessionToken: true,
      sessionTokenLength: payload.sessionToken.length,
    });

    void persistSessionSnapshot(get());
  },

  clearSession: () => {
    desktopAccessTokenRefreshPromise = null;
    useWorkspaceStore.getState().setWorkspace("personal", null);
    set({
      authStatus: "unauthenticated",
      error: null,
      orgId: null,
      organizations: [],
      sessionExpiresAtMs: null,
      sessionToken: null,
      token: null,
      tokenExpiresAtMs: null,
      user: null,
    });
    void persistSessionSnapshot(get());
  },

  setSessionFromConvex: ({
    user,
    organizations,
    currentOrgId,
    currentWorkspace,
  }: {
    user: DesktopUser;
    organizations: DesktopOrganization[];
    currentOrgId?: string | null;
    currentWorkspace?: {
      type: "personal" | "organization";
      orgId: string | null;
    } | null;
  }) => {
    // Prefer the server-persisted workspace selection (which follows the user
    // across devices). If absent, fall back to currentOrgId, then the first
    // organization, then personal.
    let workspaceType: "personal" | "organization" = "personal";
    let workspaceOrgId: string | null = null;
    let resolvedOrgId: string | null = null;

    if (currentWorkspace) {
      if (
        currentWorkspace.type === "organization" &&
        currentWorkspace.orgId &&
        organizations.some((org) => org.id === currentWorkspace.orgId)
      ) {
        workspaceType = "organization";
        workspaceOrgId = currentWorkspace.orgId;
        resolvedOrgId = currentWorkspace.orgId;
      } else if (currentWorkspace.type === "personal") {
        workspaceType = "personal";
        workspaceOrgId = null;
        resolvedOrgId = null;
      }
    }

    if (workspaceType === "personal" && !currentWorkspace) {
      const fallbackOrg =
        (currentOrgId
          ? organizations.find((org) => org.id === currentOrgId)
          : null) ??
        organizations.find((org) => org.type === "organization") ??
        null;
      if (fallbackOrg) {
        workspaceType = "organization";
        workspaceOrgId = fallbackOrg.id;
        resolvedOrgId = fallbackOrg.id;
      }
    }

    useWorkspaceStore.getState().setWorkspace(workspaceType, workspaceOrgId);

    set({
      authStatus: "authenticated",
      error: null,
      orgId: resolvedOrgId,
      organizations,
      user,
    });

    void persistSessionSnapshot(get());
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

    set({ error: null, orgId });
    void persistSessionSnapshot(get());
  },
}));
