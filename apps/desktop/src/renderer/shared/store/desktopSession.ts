"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useWorkspaceStore } from "../../../../../../packages/shared/src/store/workspace";

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
  token: string | null;
  user: DesktopUser | null;
  organizations: DesktopOrganization[];
  orgId: string | null;
  authStatus: DesktopAuthStatus;
  error: string | null;
  setToken: (token: string | null) => void;
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

export const getStoredDesktopToken = async (): Promise<string | null> => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as
      | { state?: { token?: string | null } }
      | null;
    const token = parsed?.state?.token;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
};

export const useDesktopSessionStore = create<DesktopSessionState>()(
  persist(
    (set, get): DesktopSessionState => ({
      token: null,
      user: null,
      organizations: [],
      orgId: null,
      authStatus: "unauthenticated",
      error: null,
      setToken: (token: string | null) => {
        console.info("[Desktop Auth] token stored", {
          hasToken: Boolean(token),
          tokenLength: token?.length ?? 0,
        });
        useWorkspaceStore.getState().setWorkspace("personal", null);
        set(() => ({
          token,
          user: null,
          organizations: [],
          orgId: null,
          authStatus: token ? "loading" : "unauthenticated",
          error: null,
        }));
      },
      clearSession: () => {
        useWorkspaceStore.getState().setWorkspace("personal", null);
        set({
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
        token: state.token,
        orgId: state.orgId,
      }),
    }
  )
);
