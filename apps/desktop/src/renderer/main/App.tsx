"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useQuery } from "convex/react";
import { AppHeader } from "../../features/header";
import type { MediaPanelRef } from "../../features/media";
import { useMediaFolders } from "../../features/media/hooks";
import type { ScripturePanelRef } from "../../features/scripture";
import type { LibrariesPanelRef } from "../../features/shows";
import {
  useOrganization,
  usePersistedUIState,
  useGlobalShortcuts,
} from "../shared/hooks";
import { useWorkspaceStore } from "../../../../../packages/shared/src";
import { useAppSettings } from "../shared/hooks/useAppSettings";
import { SettingsScreen } from "../../features/settings/components/SettingsScreen";
import { PresentContainer } from "../../features/present/PresentContainer";
import { BrowserModePanel } from "../../features/browser/BrowserModePanel";
import { BrowserPreviewSidebar } from "../../features/browser/BrowserPreviewSidebar";
import type { ContentSource } from "../../shared/types";
import type { HeaderSearchScope } from "../../features/header/AppHeader";
import {
  ensureFreshDesktopAccessToken,
  useDesktopSessionStore,
} from "../shared/store/desktopSession";
import { api } from "@present/backend/convex/_generated/api";
import { useDesktopConvexAuthReady } from "../shared/providers/ConvexClientProvider";
import { ensureFontCatalogLoaded } from "../shared/hooks/useFontCatalog";

export default function Home() {
  const sessionToken = useDesktopSessionStore((state) => state.sessionToken);
  const sessionExpiresAtMs = useDesktopSessionStore(
    (state) => state.sessionExpiresAtMs
  );
  const authStatus = useDesktopSessionStore((state) => state.authStatus);
  const hasHydratedSession = useDesktopSessionStore(
    (state) => state.hasHydratedSession
  );
  const hydrateAuthSession = useDesktopSessionStore(
    (state) => state.hydrateAuthSession
  );
  const user = useDesktopSessionStore((state) => state.user);
  const organizations = useDesktopSessionStore((state) => state.organizations);
  const setAuthTokens = useDesktopSessionStore((state) => state.setAuthTokens);
  const setSessionFromConvex = useDesktopSessionStore(
    (state) => state.setSessionFromConvex
  );
  const setAuthStatus = useDesktopSessionStore((state) => state.setAuthStatus);
  const setError = useDesktopSessionStore((state) => state.setError);
  const clearSession = useDesktopSessionStore((state) => state.clearSession);
  const isConvexAuthReady = useDesktopConvexAuthReady();
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    void hydrateAuthSession();
  }, [hydrateAuthSession]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const currentUser = useQuery(
    api.users.getCurrentUser,
    sessionToken && isOnline && isConvexAuthReady ? {} : "skip"
  ) as
    | {
        user: { id: string; name: string; email: string };
        organizations: Array<{
          id: string;
          name: string;
          type: "personal" | "organization";
          logo?: string;
        }>;
        currentOrgId: string | null;
      }
    | null
    | undefined;
  const organizationsFallback = useQuery(
    api.users.listMyOrganizations,
    sessionToken && isOnline && isConvexAuthReady ? {} : "skip"
  ) as
    | Array<{
        id: string;
        name: string;
        logo?: string;
      }>
    | undefined;

  const isSettingsWindow = useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return (
      new URLSearchParams(window.location.search).get("window") === "settings"
    );
  }, []);

  useEffect(() => {
    void ensureFontCatalogLoaded(document);
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.consumePendingAuthToken) {
      return;
    }

    let disposed = false;

    const applyAuthPayload = (payload: DesktopAuthPayload | null) => {
      if (!payload?.sessionToken || disposed) {
        return;
      }
      console.info("[Desktop Auth] session token received from deep link", {
        hasAccessToken: Boolean(payload.accessToken),
        sessionTokenLength: payload.sessionToken.length,
      });
      setAuthTokens(payload);
      setAuthStatus("loading");
      setError(null);
      void ensureFreshDesktopAccessToken();
    };

    void window.electronAPI.consumePendingAuthToken().then(applyAuthPayload);
    window.electronAPI.onAuthCallback((payload) => {
      void applyAuthPayload(payload);
    });

    return () => {
      disposed = true;
    };
  }, [clearSession, setAuthStatus, setAuthTokens, setError]);

  useEffect(() => {
    console.info("[Desktop Auth] desktop runtime config", {
      convexUrl: process.env.CONVEX_URL ?? null,
    });
  }, []);

  useEffect(() => {
    if (!hasHydratedSession) {
      setAuthStatus("loading");
      return;
    }

    if (!sessionToken) {
      setAuthStatus("unauthenticated");
      return;
    }

    if (sessionExpiresAtMs && sessionExpiresAtMs <= Date.now()) {
      setAuthStatus("unauthenticated");
      setError(
        isOnline
          ? "Session expired. Please sign in again."
          : "Session expired. Reconnect to continue."
      );
      return;
    }

    if (!isOnline) {
      if (user && organizations.length > 0) {
        setAuthStatus("authenticated");
        return;
      }
      setAuthStatus("loading");
      return;
    }

    if (!isConvexAuthReady) {
      setAuthStatus("loading");
      return;
    }

    if (typeof currentUser === "undefined") {
      setAuthStatus("loading");
      return;
    }

    console.info("[Desktop Auth] Convex current user response", {
      hasPayload: Boolean(currentUser),
      organizationsCount: currentUser?.organizations?.length ?? 0,
    });

    if (!currentUser || !currentUser.user) {
      if (
        currentUser &&
        "_id" in currentUser &&
        typeof currentUser._id === "string"
      ) {
        if (typeof organizationsFallback === "undefined") {
          setAuthStatus("loading");
          return;
        }

        const normalizedOrganizations = [
          { id: "personal", name: "Personal", type: "personal" as const },
          ...organizationsFallback.map((organization) => ({
            id: organization.id,
            name: organization.name,
            type: "organization" as const,
            logo: organization.logo,
          })),
        ];
        const legacyName = (currentUser as { name?: unknown }).name;
        const legacyEmail = (currentUser as { email?: unknown }).email;

        setSessionFromConvex({
          user: {
            id: currentUser._id,
            name: typeof legacyName === "string" ? legacyName : "Account",
            email: typeof legacyEmail === "string" ? legacyEmail : "",
          },
          organizations: normalizedOrganizations,
          currentOrgId: normalizedOrganizations[0]?.id ?? "personal",
        });
        setAuthStatus("authenticated");
        setError(null);
        return;
      }

      clearSession();
      console.error("[Desktop Auth] Convex rejected token");
      setError("Session expired. Please sign in again.");
      return;
    }

    setSessionFromConvex({
      user: currentUser.user,
      organizations: currentUser.organizations,
      currentOrgId: currentUser.currentOrgId,
    });
    setAuthStatus("authenticated");
    setError(null);
  }, [
    clearSession,
    currentUser,
    hasHydratedSession,
    isOnline,
    isConvexAuthReady,
    organizations,
    organizationsFallback,
    setAuthStatus,
    setError,
    setSessionFromConvex,
    sessionExpiresAtMs,
    sessionToken,
    user,
  ]);

  if (authStatus === "loading") {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background p-6 text-center">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
        <p className="mt-3 text-sm text-muted-foreground">Syncing account...</p>
      </div>
    );
  }

  return <AuthenticatedApp isSettingsWindow={isSettingsWindow} />;
}

function AuthenticatedApp({ isSettingsWindow }: { isSettingsWindow: boolean }) {
  // Organization & auth
  const { userId } = useOrganization();
  const { type: activeWorkspaceType, id: activeWorkspaceId } =
    useWorkspaceStore();

  // Enforce explicit workspace data isolation
  const effectiveOrgId =
    activeWorkspaceType === "organization" && activeWorkspaceId
      ? (activeWorkspaceId as any)
      : undefined;

  // Root UI state
  const { viewMode, setViewMode, bottomTab, setBottomTab } =
    usePersistedUIState(
      {
        viewMode: isSettingsWindow ? "settings" : "show",
        bottomTab: "media",
      },
      {
        restoreStored: isSettingsWindow,
      }
    );

  useEffect(() => {
    if (isSettingsWindow) {
      return;
    }
    setViewMode("show");
    setBottomTab("media");
  }, [isSettingsWindow, setBottomTab, setViewMode]);

  const effectiveViewMode = isSettingsWindow
    ? "settings"
    : viewMode === "settings"
      ? "show"
      : viewMode;
  const contentSource: ContentSource = "my-creations";
  const isAutopilotEnabled = false;
  const isBibleActive =
    effectiveViewMode === "show" && bottomTab === "scripture";
  const isLibrariesActive =
    effectiveViewMode === "show" && bottomTab === "shows";
  const headerSearchScope: HeaderSearchScope = isLibrariesActive
    ? "libraries"
    : isBibleActive
      ? "bible"
      : "services";
  const [showTextInOutput, setShowTextInOutput] = useState(false);
  const [showMediaInOutput, setShowMediaInOutput] = useState(true);
  const [isTimerLayerEnabled, setIsTimerLayerEnabled] = useState(false);
  const [isMessageLayerEnabled, setIsMessageLayerEnabled] = useState(false);

  // Shared Data hooks (lifted for Settings vs Present toggling)
  const mediaState = useMediaFolders();
  const { folders, allMediaItems, selectMediaForOutput } = mediaState;
  const settings = useAppSettings({ folders, allMediaItems });

  const showsPanelRef = useRef<LibrariesPanelRef>(null);
  const mediaPanelRef = useRef<MediaPanelRef>(null);
  const scripturePanelRef = useRef<ScripturePanelRef>(null);

  useGlobalShortcuts({
    enabled: !isSettingsWindow && effectiveViewMode !== "browser",
    setBottomTab,
    showsPanelRef,
    mediaPanelRef,
    scripturePanelRef,
  });

  if (isSettingsWindow) {
    return (
      <div className="h-screen bg-background text-foreground">
        <SettingsScreen
          {...settings}
          folders={folders}
          allMediaItems={allMediaItems}
          selectMediaForOutput={selectMediaForOutput}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader
        viewMode={effectiveViewMode}
        isBibleActive={isBibleActive}
        isLibrariesActive={isLibrariesActive}
        searchScope={headerSearchScope}
        onViewModeChange={setViewMode}
        onOpenShow={() => {
          setBottomTab("media");
          setViewMode("show");
        }}
        onOpenLibraries={() => {
          setBottomTab("shows");
          setViewMode("show");
        }}
        onOpenBible={() => {
          setBottomTab("scripture");
          setViewMode("show");
        }}
        onOpenBrowser={() => {
          setViewMode("browser");
        }}
      />

      {effectiveViewMode === "browser" ? (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <BrowserModePanel />
          </div>
          <BrowserPreviewSidebar />
        </div>
      ) : (
        <PresentContainer
          orgId={effectiveOrgId}
          userId={userId as any}
          viewMode={effectiveViewMode}
          bottomTab={bottomTab}
          contentSource={contentSource}
          mediaState={mediaState}
          settings={settings}
          showsPanelRef={showsPanelRef}
          mediaPanelRef={mediaPanelRef}
          scripturePanelRef={scripturePanelRef}
          isAutopilotEnabled={isAutopilotEnabled}
          showTextInOutput={showTextInOutput}
          setShowTextInOutput={setShowTextInOutput}
          showMediaInOutput={showMediaInOutput}
          setShowMediaInOutput={setShowMediaInOutput}
          isTimerLayerEnabled={isTimerLayerEnabled}
          setIsTimerLayerEnabled={setIsTimerLayerEnabled}
          isMessageLayerEnabled={isMessageLayerEnabled}
          setIsMessageLayerEnabled={setIsMessageLayerEnabled}
        />
      )}
    </div>
  );
}
