"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  useLooksConfig,
} from "../shared/hooks";
import { useWorkspaceStore } from "../../../../../packages/shared/src";
import { useAppSettings } from "../shared/hooks/useAppSettings";
import { SettingsScreen } from "../../features/settings/components/SettingsScreen";
import { PresentContainer } from "../../features/present/PresentContainer";
import { BrowserModePanel } from "../../features/browser/BrowserModePanel";
import { BrowserPreviewSidebar } from "../../features/browser/BrowserPreviewSidebar";
import type { ContentSource, ViewMode } from "../../shared/types";
import type { OutputTextPosition } from "../../shared/types/output-window";
import type { HeaderSearchScope } from "../../features/header/AppHeader";
import {
  ensureFreshDesktopAccessToken,
  useDesktopSessionStore,
} from "../shared/store/desktopSession";
import { api } from "@present/backend/convex/_generated/api";
import { useDesktopConvexAuthReady } from "../shared/providers/ConvexClientProvider";
import { ensureFontCatalogLoaded } from "../shared/hooks/useFontCatalog";
import { useOfflineSyncEngine } from "../shared/hooks/useOfflineSyncEngine";
import { StageDisplayWindow } from "../../features/stage/StageDisplayWindow";
import { LooksWindow } from "../../features/looks/LooksWindow";
import { ScreenComposerWindow } from "../../features/screen-composer";

export default function Home() {
  const sessionToken = useDesktopSessionStore((state) => state.sessionToken);
  const sessionExpiresAtMs = useDesktopSessionStore(
    (state) => state.sessionExpiresAtMs
  );
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

  const windowType = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return new URLSearchParams(window.location.search).get("window");
  }, []);

  useEffect(() => {
    void ensureFontCatalogLoaded(document);
  }, []);

  useEffect(() => {
    if (!windowType) return;
    const titleMap: Record<string, string> = {
      looks: "Looks",
      "media-stage": "Media Stage",
      "screen-composer": "Screen Composer",
      settings: "Settings",
    };
    const title = titleMap[windowType];
    if (title) {
      document.title = title;
    }
  }, [windowType]);

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
    if (!hasHydratedSession || !sessionToken || !isOnline) {
      return;
    }

    void ensureFreshDesktopAccessToken();
  }, [hasHydratedSession, isOnline, sessionToken]);

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

  useOfflineSyncEngine({
    enabled: hasHydratedSession && Boolean(sessionToken) && isOnline && isConvexAuthReady,
  });

  return <AuthenticatedApp windowType={windowType} />;
}

function AuthenticatedApp({ windowType }: { windowType: string | null }) {
  // Organization & auth
  const { userId } = useOrganization();
  const { type: activeWorkspaceType, id: activeWorkspaceId } =
    useWorkspaceStore();
  const isSettingsWindow = windowType === "settings";
  const isMediaStageWindow = windowType === "media-stage";
  const isLooksWindow = windowType === "looks";
  const isScreenComposerWindow = windowType === "screen-composer";

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
  const [availableDisplays, setAvailableDisplays] = useState<Display[]>([]);
  const [hasLoadedDisplays, setHasLoadedDisplays] = useState(false);

  // Shared Data hooks (lifted for Settings vs Present toggling)
  const mediaState = useMediaFolders();
  const { folders, allMediaItems, selectMediaForOutput } = mediaState;
  const settings = useAppSettings({ folders, allMediaItems });
  const { settingsOutputDisplayId, setSettingsOutputDisplayId } = settings;
  const { looksConfig, liveLook, setLayerEnabledForLook } = useLooksConfig();
  const programLooks = liveLook.targets.program;
  const showTextInOutput =
    programLooks.layers.slide || programLooks.layers.presentation;
  const showMediaInOutput =
    programLooks.layers.media || programLooks.layers.videoInput;
  const hideBackgroundInOutput = programLooks.layers.mask;
  const isTimerLayerEnabled = programLooks.layers.props;
  const isMessageLayerEnabled =
    programLooks.layers.messages || programLooks.layers.announcements;
  const outputTextPosition: OutputTextPosition = {
    ...programLooks.textPosition,
  };

  const setShowTextInOutput = useCallback(
    (show: boolean) => {
      setLayerEnabledForLook(looksConfig.liveLookId, "program", "slide", show);
      setLayerEnabledForLook(
        looksConfig.liveLookId,
        "program",
        "presentation",
        show
      );
    },
    [looksConfig.liveLookId, setLayerEnabledForLook]
  );

  const setShowMediaInOutput = useCallback(
    (show: boolean) => {
      setLayerEnabledForLook(looksConfig.liveLookId, "program", "media", show);
      setLayerEnabledForLook(
        looksConfig.liveLookId,
        "program",
        "videoInput",
        show
      );
    },
    [looksConfig.liveLookId, setLayerEnabledForLook]
  );

  const setHideBackgroundInOutput = useCallback(
    (hide: boolean) => {
      setLayerEnabledForLook(looksConfig.liveLookId, "program", "mask", hide);
    },
    [looksConfig.liveLookId, setLayerEnabledForLook]
  );

  const setIsTimerLayerEnabled = useCallback(
    (show: boolean) => {
      setLayerEnabledForLook(looksConfig.liveLookId, "program", "props", show);
    },
    [looksConfig.liveLookId, setLayerEnabledForLook]
  );

  const setIsMessageLayerEnabled = useCallback(
    (show: boolean) => {
      setLayerEnabledForLook(
        looksConfig.liveLookId,
        "program",
        "messages",
        show
      );
      setLayerEnabledForLook(
        looksConfig.liveLookId,
        "program",
        "announcements",
        show
      );
    },
    [looksConfig.liveLookId, setLayerEnabledForLook]
  );
  const showsPanelRef = useRef<LibrariesPanelRef>(null);
  const mediaPanelRef = useRef<MediaPanelRef>(null);
  const scripturePanelRef = useRef<ScripturePanelRef>(null);

  const refreshDisplays = useCallback(async () => {
    if (!window.electronAPI?.getDisplays) {
      return;
    }
    try {
      const displays = await window.electronAPI.getDisplays();
      setAvailableDisplays(displays);
      setHasLoadedDisplays(true);
    } catch {
      setAvailableDisplays([]);
      setHasLoadedDisplays(true);
    }
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.setPreferredOutputDisplay) {
      return;
    }
    void window.electronAPI.setPreferredOutputDisplay(
      settingsOutputDisplayId ?? null
    );
  }, [settingsOutputDisplayId]);

  useEffect(() => {
    if (!hasLoadedDisplays) {
      return;
    }
    if (
      settingsOutputDisplayId !== null &&
      !availableDisplays.some(
        (display) => display.id === settingsOutputDisplayId
      )
    ) {
      setSettingsOutputDisplayId(null);
    }
  }, [
    availableDisplays,
    hasLoadedDisplays,
    setSettingsOutputDisplayId,
    settingsOutputDisplayId,
  ]);

  useEffect(() => {
    const initialTimeoutId = window.setTimeout(() => {
      void refreshDisplays();
    }, 0);
    const intervalId = window.setInterval(() => {
      void refreshDisplays();
    }, 4000);
    return () => {
      window.clearTimeout(initialTimeoutId);
      window.clearInterval(intervalId);
    };
  }, [refreshDisplays]);

  const openMediaStageWindow = useCallback(async () => {
    if (!window.electronAPI?.openMediaStageWindow) {
      return;
    }
    try {
      await window.electronAPI.openMediaStageWindow();
    } catch (error) {
      console.error("Failed to open media stage window:", error);
    }
  }, []);

  const openLooksWindow = useCallback(async () => {
    if (!window.electronAPI?.openLooksWindow) {
      return;
    }
    try {
      await window.electronAPI.openLooksWindow();
    } catch (error) {
      console.error("Failed to open looks window:", error);
    }
  }, []);

  const openScreenComposerWindow = useCallback(async () => {
    if (!window.electronAPI?.openScreenComposerWindow) {
      return;
    }
    try {
      await window.electronAPI.openScreenComposerWindow();
    } catch (error) {
      console.error("Failed to open screen composer window:", error);
    }
  }, []);

  useGlobalShortcuts({
    enabled: !isSettingsWindow && effectiveViewMode !== "browser",
    setBottomTab,
    showsPanelRef,
    mediaPanelRef,
    scripturePanelRef,
  });

  const renderPresentContainer = (mode: ViewMode) => (
    <PresentContainer
      orgId={effectiveOrgId}
      userId={userId as any}
      viewMode={mode}
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
      hideBackgroundInOutput={hideBackgroundInOutput}
      setHideBackgroundInOutput={setHideBackgroundInOutput}
      outputTextPosition={outputTextPosition}
      isTimerLayerEnabled={isTimerLayerEnabled}
      setIsTimerLayerEnabled={setIsTimerLayerEnabled}
      isMessageLayerEnabled={isMessageLayerEnabled}
      setIsMessageLayerEnabled={setIsMessageLayerEnabled}
    />
  );

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

  if (isMediaStageWindow) {
    return <StageDisplayWindow />;
  }

  if (isLooksWindow) {
    return <LooksWindow />;
  }

  if (isScreenComposerWindow) {
    return <ScreenComposerWindow />;
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
        onOpenComposer={() => {
          void openScreenComposerWindow();
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
        onOpenStage={() => {
          void openMediaStageWindow();
        }}
        onOpenLooks={() => {
          void openLooksWindow();
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
        renderPresentContainer(effectiveViewMode)
      )}
    </div>
  );
}
