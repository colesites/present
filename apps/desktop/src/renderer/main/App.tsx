"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
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
  desktopWebBaseUrl,
  ensureFreshDesktopAccessToken,
  useDesktopSessionStore,
} from "../shared/store/desktopSession";
import { markStartup } from "../shared/lib/startup-timeline";
import {
  runMenuCommand,
  useMenuChecks,
  useMenuCommand,
  useMenuCommandListener,
} from "../tauri/menu-commands";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { resolveVerifiedOrganizationId } from "../shared/lib/organization-scope-policy.mjs";
import { useDesktopConvexAuthReady } from "../shared/providers/ConvexClientProvider";
import { ThemesPanel } from "../../features/themes";
import { useThemesModalStore } from "../shared/store/themesModal";
import { useMediaLibraryStore } from "../shared/store/mediaLibrary";
import { useUpdateNotice } from "../tauri/updates";
import { ensureFontCatalogLoaded } from "../shared/hooks/useFontCatalog";
import { useOfflineSyncEngine } from "../shared/hooks/useOfflineSyncEngine";
import { StageLayoutWindow } from "../../features/stage/StageLayoutWindow";
import { StageLayoutEditor } from "../../features/stage/StageLayoutEditor";
import { MultiviewWindow } from "../../features/stage/MultiviewWindow";
import { LooksWindow } from "../../features/looks/LooksWindow";
import { ScreenComposerWindow } from "../../features/screen-composer";
import { AiOperatorRoot } from "../ai-operator/AiOperatorRoot";
import { MiniLyricsWindow } from "../../features/editor";
import { areDisplayListsEqual } from "../shared/lib/display-list";
import { ScreenCanvas } from "../shared/components/ScreenCanvas";
import { ScreenIdentify } from "../shared/components/ScreenIdentify";

const ROOT_DISPLAY_REFRESH_INTERVAL_MS = 15_000;

const getWindowType = () => {
  if (typeof window === "undefined") {
    return null;
  }
  return new URLSearchParams(window.location.search).get("window");
};

export default function Home() {
  const windowType = getWindowType();
  if (windowType === "mini-lyrics") {
    return <MiniLyricsWindow />;
  }
  // A stage screen, built in or added in Screen Configuration: the layout
  // its screen names, at the screen's size and in its colour. The two older
  // page names still lead here.
  if (windowType === "stage" || windowType === "media-stage" || windowType === "worship-stage") {
    return (
      <>
        <ScreenCanvas>
          <StageLayoutWindow />
        </ScreenCanvas>
        <ScreenIdentify />
      </>
    );
  }
  if (windowType === "stage-editor") {
    return <StageLayoutEditor />;
  }
  if (windowType === "multiview") {
    return <MultiviewWindow />;
  }
  if (windowType === "looks") {
    return <LooksWindow />;
  }
  if (windowType === "screen-composer") {
    return <ScreenComposerWindow />;
  }
  return <AuthenticatedHome windowType={windowType} />;
}

function AuthenticatedHome({ windowType }: { windowType: string | null }) {
  const sessionToken = useDesktopSessionStore((state) => state.sessionToken);
  const sessionExpiresAtMs = useDesktopSessionStore(
    (state) => state.sessionExpiresAtMs
  );
  const tokenExpiresAtMs = useDesktopSessionStore(
    (state) => state.tokenExpiresAtMs
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
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth();
  useEffect(() => {
    if (isConvexAuthenticated) markStartup("convex-authenticated");
  }, [isConvexAuthenticated]);
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
    sessionToken && isOnline && isConvexAuthReady && isConvexAuthenticated
      ? {}
      : "skip"
  ) as
    | {
        user: {
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
        };
        organizations: Array<{
          id: string;
          name: string;
          type: "personal" | "organization";
          logo?: string;
        }>;
        currentOrgId: string | null;
        currentWorkspace?: {
          type: "personal" | "organization";
          orgId: string | null;
        };
      }
    | null
    | undefined;
  const organizationsFallback = useQuery(
    api.users.listMyOrganizations,
    sessionToken && isOnline && isConvexAuthReady && isConvexAuthenticated
      ? {}
      : "skip"
  ) as
    | Array<{
        id: string;
        name: string;
        logo?: string;
      }>
    | undefined;

  useEffect(() => {
    void ensureFontCatalogLoaded(document);
  }, []);

  useEffect(() => {
    if (!windowType) return;
    const titleMap: Record<string, string> = {
      looks: "Looks",
      "media-stage": "Media Stage",
      "worship-stage": "Worship Stage",
      "mini-lyrics": "Mini Lyrics Editor",
      "screen-composer": "Screen Composer",
      stage: "Stage",
      "stage-editor": "Stage Layouts",
      multiview: "Multiview",
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
    if (
      !hasHydratedSession ||
      !sessionToken ||
      !isOnline ||
      !tokenExpiresAtMs
    ) {
      return;
    }

    const refreshAtMs = tokenExpiresAtMs - 5 * 60 * 1000;
    const delayMs = Math.max(0, Math.min(refreshAtMs - Date.now(), 2_147_483_647));
    const timeoutId = window.setTimeout(() => {
      void ensureFreshDesktopAccessToken();
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [hasHydratedSession, isOnline, sessionToken, tokenExpiresAtMs]);

  useEffect(() => {
    if (!hasHydratedSession || !sessionToken || user) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const state = useDesktopSessionStore.getState();
      if (
        state.sessionToken &&
        !state.user &&
        state.authStatus === "loading"
      ) {
        state.setError("Still reconnecting to Present services…");
        void ensureFreshDesktopAccessToken({ forceRefresh: true });
      }
    }, 15_000);

    return () => window.clearTimeout(timeoutId);
  }, [hasHydratedSession, sessionToken, user]);

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
      if (isOnline) {
        // This computer's clock is not the judge (`expiredSessionAction`):
        // the server renews the session, or answers 401 and signs it out.
        setAuthStatus(user ? "authenticated" : "loading");
        void ensureFreshDesktopAccessToken();
      } else if (user) {
        setAuthStatus("authenticated");
        setError("Session expired. Reconnect to verify your account.");
      } else {
        setAuthStatus("loading");
      }
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

    if (!isConvexAuthReady || !isConvexAuthenticated) {
      if (user) {
        setAuthStatus("authenticated");
        return;
      }
      setAuthStatus("loading");
      return;
    }

    if (typeof currentUser === "undefined") {
      if (user) {
        setAuthStatus("authenticated");
        return;
      }
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
            billing: undefined,
          },
          organizations: normalizedOrganizations,
          currentOrgId: normalizedOrganizations[0]?.id ?? "personal",
        });
        setAuthStatus("authenticated");
        setError(null);
        return;
      }

      // Convex returned a null user. This can happen either because the
      // session is genuinely invalid OR because the query is mid-flight after a
      // reconnect. Only force a sign-out when we have a cached user already
      // (proving the session was once valid) AND Convex actively rejected.
      // For first-load null responses we keep waiting instead of bouncing the
      // user to sign-in.
      if (user) {
        console.warn(
          "[Desktop Auth] Convex returned null user despite cached identity; keeping cached session while sync retries.",
        );
        setAuthStatus("authenticated");
        return;
      }
      console.error("[Desktop Auth] Convex rejected token");
      setAuthStatus("loading");
      setError("Reconnecting to Present services…");
      void ensureFreshDesktopAccessToken({ forceRefresh: true });
      return;
    }

    setSessionFromConvex({
      user: currentUser.user,
      organizations: currentUser.organizations,
      currentOrgId: currentUser.currentOrgId,
      currentWorkspace: currentUser.currentWorkspace,
    });
    setAuthStatus("authenticated");
    setError(null);
  }, [
    clearSession,
    currentUser,
    hasHydratedSession,
    isOnline,
    isConvexAuthReady,
    isConvexAuthenticated,
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
  const authStatus = useDesktopSessionStore((state) => state.authStatus);
  const sessionToken = useDesktopSessionStore((state) => state.sessionToken);
  const desktopUser = useDesktopSessionStore((state) => state.user);
  const desktopOrgId = useDesktopSessionStore((state) => state.orgId);
  const desktopOrganizations = useDesktopSessionStore(
    (state) => state.organizations,
  );
  const hasVerifiedOrganizationScope = useDesktopSessionStore(
    (state) => state.hasVerifiedOrganizationScope,
  );
  const { type: activeWorkspaceType, id: activeWorkspaceId } =
    useWorkspaceStore();
  const isSettingsWindow = windowType === "settings";
  const hasAuthenticatedDesktopSession =
    authStatus === "authenticated" && Boolean(sessionToken && desktopUser);

  // Cached session data is useful offline, but it is not authoritative enough
  // to cross a Convex v.id("organizations") boundary. Wait for the signed-in
  // organization query to verify it before enabling organization-scoped data.
  const effectiveOrgId = (hasAuthenticatedDesktopSession
    ? resolveVerifiedOrganizationId({
        desktopOrganizationId: desktopOrgId,
        hasVerifiedOrganizationScope,
        organizations: desktopOrganizations,
        workspaceOrganizationId: activeWorkspaceId,
        workspaceType: activeWorkspaceType,
      })
    : undefined) as Id<"organizations"> | undefined;
  const cachedLocalOrgId = useMemo(() => {
    const validOrgIds = new Set(
      desktopOrganizations
        .filter((organization) => organization.type === "organization")
        .map((organization) => organization.id),
    );
    const workspaceOrgId =
      activeWorkspaceType === "organization" ? activeWorkspaceId : null;

    if (workspaceOrgId && validOrgIds.has(workspaceOrgId)) {
      return workspaceOrgId;
    }

    if (desktopOrgId && desktopOrgId !== "personal" && validOrgIds.has(desktopOrgId)) {
      return desktopOrgId;
    }

    return null;
  }, [
    activeWorkspaceId,
    activeWorkspaceType,
    desktopOrgId,
    desktopOrganizations,
  ]);
  const localOrgId = (hasAuthenticatedDesktopSession
    ? effectiveOrgId ?? cachedLocalOrgId ?? null
    : null) as
    | Id<"organizations">
    | null;
  const localUserId = hasAuthenticatedDesktopSession
    ? userId ?? desktopUser?.id ?? null
    : null;

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
  // The media library, for what draws slides' image and video backgrounds.
  useEffect(() => {
    useMediaLibraryStore.getState().setItems(allMediaItems);
  }, [allMediaItems]);
  useEffect(() => {
    useMediaLibraryStore.getState().setFolders(folders);
  }, [folders]);
  // "Present 0.4.4 is ready", with a Restart button, once one is downloaded.
  useUpdateNotice();
  const settings = useAppSettings({ folders, allMediaItems });
  const {
    settingsOutputDisplayId,
    setSettingsOutputDisplayId,
    settingsScreenDisplayIds,
    setSettingsScreenDisplayIds,
    settingsScreenResolutions,
  } = settings;
  const { looksConfig, liveLook, setLayerEnabledForLook, setLayersEnabledForLook } =
    useLooksConfig();
  const programLooks = liveLook.targets.program;
  // The words, and a presentation's slides (PDF, PowerPoint): one switch
  // each, as ProPresenter has a Slide layer apart from the media. The look's
  // keys are older than the names (`looks-config.mjs`).
  const showTextInOutput = programLooks.layers.slide;
  const showSlideInOutput = programLooks.layers.presentation;
  const showMediaInOutput =
    programLooks.layers.media || programLooks.layers.videoInput;
  const hideBackgroundInOutput = programLooks.layers.mask;
  const isTimerLayerEnabled = programLooks.layers.timer;
  const isMessageLayerEnabled =
    programLooks.layers.messages || programLooks.layers.announcements;
  const outputTextPosition: OutputTextPosition = {
    ...programLooks.textPosition,
  };

  // Each of these is one toggle over more than one layer, so they are sent as
  // one change: two commands were two events, and two events racing could
  // leave one of a pair on, which read as a toggle that would not respond.
  const setShowTextInOutput = useCallback(
    (show: boolean) => {
      setLayerEnabledForLook(looksConfig.liveLookId, "program", "slide", show);
    },
    [looksConfig.liveLookId, setLayerEnabledForLook]
  );

  const setShowSlideInOutput = useCallback(
    (show: boolean) => {
      setLayerEnabledForLook(looksConfig.liveLookId, "program", "presentation", show);
    },
    [looksConfig.liveLookId, setLayerEnabledForLook]
  );

  const setShowMediaInOutput = useCallback(
    (show: boolean) => {
      setLayersEnabledForLook(
        looksConfig.liveLookId,
        "program",
        ["media", "videoInput"],
        show
      );
    },
    [looksConfig.liveLookId, setLayersEnabledForLook]
  );

  const setHideBackgroundInOutput = useCallback(
    (hide: boolean) => {
      setLayerEnabledForLook(looksConfig.liveLookId, "program", "mask", hide);
    },
    [looksConfig.liveLookId, setLayerEnabledForLook]
  );

  const setIsTimerLayerEnabled = useCallback(
    (show: boolean) => {
      setLayerEnabledForLook(looksConfig.liveLookId, "program", "timer", show);
    },
    [looksConfig.liveLookId, setLayerEnabledForLook]
  );

  const setIsMessageLayerEnabled = useCallback(
    (show: boolean) => {
      setLayersEnabledForLook(
        looksConfig.liveLookId,
        "program",
        ["messages", "announcements"],
        show
      );
    },
    [looksConfig.liveLookId, setLayersEnabledForLook]
  );
  const showsPanelRef = useRef<LibrariesPanelRef>(null);
  const mediaPanelRef = useRef<MediaPanelRef>(null);
  const scripturePanelRef = useRef<ScripturePanelRef>(null);
  const [isMediaStageLive, setIsMediaStageLive] = useState(false);
  const [isWorshipStageLive, setIsWorshipStageLive] = useState(false);

  const refreshDisplays = useCallback(async () => {
    if (!window.electronAPI?.getDisplays) {
      return;
    }
    try {
      const displays = await window.electronAPI.getDisplays();
      setAvailableDisplays((previous) =>
        areDisplayListsEqual(previous, displays) ? previous : displays,
      );
      setHasLoadedDisplays(true);
    } catch {
      setAvailableDisplays((previous) => (previous.length === 0 ? previous : []));
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
    if (!window.electronAPI?.setPreferredDisplay) {
      return;
    }
    void window.electronAPI.setPreferredDisplay(
      "audience",
      settingsScreenDisplayIds.audience,
    );
    void window.electronAPI.setPreferredDisplay(
      "media",
      settingsScreenDisplayIds.media,
    );
    void window.electronAPI.setPreferredDisplay(
      "worship",
      settingsScreenDisplayIds.worship,
    );
  }, [settingsScreenDisplayIds]);

  useEffect(() => {
    if (!window.electronAPI?.setPreferredResolution) {
      return;
    }
    void window.electronAPI.setPreferredResolution(
      "audience",
      settingsScreenResolutions.audience,
    );
    void window.electronAPI.setPreferredResolution(
      "media",
      settingsScreenResolutions.media,
    );
    void window.electronAPI.setPreferredResolution(
      "worship",
      settingsScreenResolutions.worship,
    );
  }, [settingsScreenResolutions]);

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
    const missingScreenRoles = (["audience", "media", "worship"] as const).filter(
      (role) =>
        settingsScreenDisplayIds[role] !== null &&
        !availableDisplays.some(
          (display) => display.id === settingsScreenDisplayIds[role],
        ),
    );
    if (missingScreenRoles.length > 0) {
      setSettingsScreenDisplayIds((previous) => {
        const next = { ...previous };
        for (const role of missingScreenRoles) {
          next[role] = null;
        }
        return next;
      });
    }
  }, [
    availableDisplays,
    hasLoadedDisplays,
    setSettingsOutputDisplayId,
    setSettingsScreenDisplayIds,
    settingsScreenDisplayIds,
    settingsOutputDisplayId,
  ]);

  useEffect(() => {
    const initialTimeoutId = window.setTimeout(() => {
      void refreshDisplays();
    }, 0);
    const intervalId = window.setInterval(() => {
      void refreshDisplays();
    }, ROOT_DISPLAY_REFRESH_INTERVAL_MS);
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
      const didOpen = await window.electronAPI.openMediaStageWindow(
        settingsScreenDisplayIds.media,
        settingsScreenResolutions.media,
      );
      if (didOpen) {
        setIsMediaStageLive(true);
      }
    } catch (error) {
      console.error("Failed to open media stage window:", error);
    }
  }, [settingsScreenDisplayIds.media, settingsScreenResolutions.media]);

  const closeMediaStageWindow = useCallback(async () => {
    if (!window.electronAPI?.closeMediaStageWindow) {
      return;
    }
    try {
      await window.electronAPI.closeMediaStageWindow();
    } catch (error) {
      console.error("Failed to close media stage window:", error);
    }
    setIsMediaStageLive(false);
  }, []);

  const openWorshipStageWindow = useCallback(async () => {
    if (!window.electronAPI?.openWorshipStageWindow) {
      return;
    }
    try {
      const didOpen = await window.electronAPI.openWorshipStageWindow(
        settingsScreenDisplayIds.worship,
        settingsScreenResolutions.worship,
      );
      if (didOpen) {
        setIsWorshipStageLive(true);
      }
    } catch (error) {
      console.error("Failed to open worship stage window:", error);
    }
  }, [settingsScreenDisplayIds.worship, settingsScreenResolutions.worship]);

  const closeWorshipStageWindow = useCallback(async () => {
    if (!window.electronAPI?.closeWorshipStageWindow) {
      return;
    }
    try {
      await window.electronAPI.closeWorshipStageWindow();
    } catch (error) {
      console.error("Failed to close worship stage window:", error);
    }
    setIsWorshipStageLive(false);
  }, []);

  useEffect(() => {
    const mediaCleanup = window.electronAPI?.onMediaStageWindowClosed?.(() => {
      setIsMediaStageLive(false);
    });
    const worshipCleanup = window.electronAPI?.onWorshipStageWindowClosed?.(
      () => {
        setIsWorshipStageLive(false);
      },
    );

    return () => {
      mediaCleanup?.();
      worshipCleanup?.();
    };
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

  // The application menu (`services/app_menu.rs`). Each item does what the
  // header's own button does; the ones that belong to a panel bring the panel
  // on screen and hand over to it.
  useMenuCommandListener(!isSettingsWindow);
  // Screens ▸ Configure Screens…: Settings, open at Screens & sound.
  useMenuCommand("screens.configure", () => {
    try {
      window.localStorage.setItem("present-settings-section", "screens");
    } catch {
      // Settings opens where it was left instead.
    }
    void import("@tauri-apps/api/event")
      .then(({ emitTo }) => emitTo("settings", "settings:section", "screens"))
      .catch((): void => undefined);
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("open_window", { role: "settings", options: null }))
      .catch((error: unknown) => console.error("[Menu] could not open the screen settings", error));
  });
  useMenuCommand("view.show", () => {
    setBottomTab("media");
    setViewMode("show");
  });
  useMenuCommand("view.libraries", () => {
    setBottomTab("shows");
    setViewMode("show");
  });
  useMenuCommand("view.edit", () => setViewMode("edit"));
  useMenuCommand("view.bible", () => {
    setBottomTab("scripture");
    setViewMode("show");
  });
  useMenuCommand("view.browser", () => setViewMode("browser"));
  useMenuCommand("view.themes", () => useThemesModalStore.getState().open());
  useMenuCommand("file.new-library-item", () => {
    setBottomTab("shows");
    setViewMode("show");
    runMenuCommand("library.new-item");
  });
  useMenuCommand("file.new-library", () => {
    setBottomTab("shows");
    setViewMode("show");
    runMenuCommand("library.create");
  });
  useMenuCommand("file.new-service", () => {
    setViewMode("show");
    runMenuCommand("services.create");
  });
  // File ▸ Import's songs and libraries: the Libraries tab's own Import
  // button, so it comes on screen first.
  useMenuCommand("file.import-library-export", () => {
    setBottomTab("shows");
    setViewMode("show");
    runMenuCommand("library.import-export");
  });
  useMenuCommand("file.import-openlyrics", () => {
    setBottomTab("shows");
    setViewMode("show");
    runMenuCommand("library.import-openlyrics");
  });
  useMenuCommand("file.import-videopsalm", () => {
    setBottomTab("shows");
    setViewMode("show");
    runMenuCommand("library.import-videopsalm");
  });
  useMenuCommand("file.add-media-folder", () => {
    setBottomTab("media");
    setViewMode("show");
    runMenuCommand("media.add-folder");
  });
  useMenuCommand("screens.media-stage", () => {
    void (isMediaStageLive ? closeMediaStageWindow() : openMediaStageWindow());
  });
  useMenuCommand("screens.worship-stage", () => {
    void (isWorshipStageLive ? closeWorshipStageWindow() : openWorshipStageWindow());
  });
  useMenuCommand("screens.looks", () => void openLooksWindow());
  useMenuCommand("screens.composer", () => void openScreenComposerWindow());
  useMenuCommand("screens.stage-layouts", () => {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("open_window", { role: "stage-editor", options: null }))
      .catch((error: unknown) => console.error("[Menu] could not open the stage layouts", error));
  });
  // Multiview goes over the media stage's display, and the same item takes it
  // away again.
  useMenuCommand("screens.multiview", () => {
    void import("@tauri-apps/api/core")
      .then(async ({ invoke }) => {
        const closed = await invoke<boolean>("close_window", { role: "multiview" });
        if (!closed) await invoke("open_window", { role: "multiview", options: null });
      })
      .catch((error: unknown) => console.error("[Menu] could not open Multiview", error));
  });
  useMenuCommand("help.website", () => {
    void window.electronAPI?.openExternalBrowser?.(desktopWebBaseUrl());
  });
  // The Settings window is this component too, with no stage screens of its
  // own: reporting from there would clear the ticks while they are open.
  useMenuChecks({ mediaStage: isMediaStageLive, worshipStage: isWorshipStageLive }, !isSettingsWindow);

  useGlobalShortcuts({
    enabled: !isSettingsWindow && effectiveViewMode !== "browser",
    setBottomTab,
    showsPanelRef,
    mediaPanelRef,
    scripturePanelRef,
    showTextInOutput,
    setShowTextInOutput,
  });

  const renderPresentContainer = (mode: ViewMode) => (
    <PresentContainer
      orgId={effectiveOrgId}
      localOrgId={localOrgId}
      userId={localUserId}
      viewMode={mode}
      setViewMode={setViewMode}
      bottomTab={bottomTab}
      setBottomTab={setBottomTab}
      contentSource={contentSource}
      mediaState={mediaState}
      settings={settings}
      showsPanelRef={showsPanelRef}
      mediaPanelRef={mediaPanelRef}
      scripturePanelRef={scripturePanelRef}
      showTextInOutput={showTextInOutput}
      setShowTextInOutput={setShowTextInOutput}
      showSlideInOutput={showSlideInOutput}
      setShowSlideInOutput={setShowSlideInOutput}
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
        onCloseStage={() => {
          void closeMediaStageWindow();
        }}
        isMediaStageLive={isMediaStageLive}
        onOpenWorshipStage={() => {
          void openWorshipStageWindow();
        }}
        onCloseWorshipStage={() => {
          void closeWorshipStageWindow();
        }}
        isWorshipStageLive={isWorshipStageLive}
        onOpenLooks={() => {
          void openLooksWindow();
        }}
      />

      <div
        className={
          effectiveViewMode === "browser"
            ? "hidden"
            : "contents"
        }
      >
        {renderPresentContainer(
          effectiveViewMode === "browser" ? "show" : effectiveViewMode,
        )}
      </div>

      {effectiveViewMode === "browser" ? (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <BrowserModePanel />
          </div>
          <BrowserPreviewSidebar />
        </div>
      ) : null}

      {/* The Themes panel lives at the top of the tree so any view can open
          it. It applies to the song the view in front publishes, through
          the themes store; see `store/themesModal.ts`. */}
      <ThemesPanel workspaceId={localOrgId} />
      <AiOperatorRoot
        sessionToken={sessionToken}
        speechInputDeviceId={settings.settingsSpeechInputDeviceId}
        speechLang={settings.settingsLang}
      />
    </div>
  );
}
