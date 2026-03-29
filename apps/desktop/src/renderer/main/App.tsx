"use client";

import { useEffect, useMemo, useRef } from "react";
import { useClerk, useUser } from "@clerk/react";
import { SignInScreen } from "../../features/auth/SignInScreen";
import { Loader2 } from "lucide-react";
import { AppHeader } from "../../features/header";
import type { MediaPanelRef } from "../../features/media";
import { useMediaFolders } from "../../features/media/hooks";
import type { ScripturePanelRef } from "../../features/scripture";
import type { ShowsPanelRef } from "../../features/shows";
import {
  useOrganization,
  usePersistedUIState,
  useGlobalShortcuts,
} from "../shared/hooks";
import { useWorkspaceStore } from "../../../../../packages/shared/src";
import { useAppSettings } from "../shared/hooks/useAppSettings";
import { SettingsScreen } from "../../features/settings/components/SettingsScreen";
import { PresentContainer } from "../../features/present/PresentContainer";
import type { ContentSource } from "../../shared/types";
import type { HeaderSearchScope } from "../../features/header/AppHeader";

export default function Home() {
  const { isSignedIn, isLoaded } = useUser();
  const clerk = useClerk();

  const isSettingsWindow = useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return (
      new URLSearchParams(window.location.search).get("window") === "settings"
    );
  }, []);

  useEffect(() => {
    if (!isLoaded || !window.electronAPI?.consumePendingAuthToken) {
      return;
    }

    let disposed = false;

    const applyToken = async (token: string | null) => {
      if (!token || disposed) {
        return;
      }

      try {
        await clerk.setActive({ session: token });
      } catch (error) {
        console.error("Failed to activate desktop session", error);
      }
    };

    void window.electronAPI.consumePendingAuthToken().then(applyToken);
    window.electronAPI.onAuthCallback((token) => {
      void applyToken(token);
    });

    return () => {
      disposed = true;
    };
  }, [clerk, isLoaded]);

  // Show loading while Clerk is initializing
  if (!isLoaded) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background p-6 text-center">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
        <p className="mt-3 text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // Show sign in screen if not signed in
  if (!isSignedIn) {
    return <SignInScreen />;
  }

  // User is signed in
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

  // Shared Data hooks (lifted for Settings vs Present toggling)
  const mediaState = useMediaFolders();
  const { folders, allMediaItems, selectMediaForOutput } = mediaState;
  const settings = useAppSettings({ folders, allMediaItems });

  const showsPanelRef = useRef<ShowsPanelRef>(null);
  const mediaPanelRef = useRef<MediaPanelRef>(null);
  const scripturePanelRef = useRef<ScripturePanelRef>(null);

  useGlobalShortcuts({
    enabled: !isSettingsWindow,
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
      />

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
      />
    </div>
  );
}
