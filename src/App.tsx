"use client";

import { Activity, useRef, useState } from "react";
import { AppHeader } from "./features/header";
import type { MediaPanelRef } from "./features/media";
import { useMediaFolders } from "./features/media/hooks";
import type { ScripturePanelRef } from "./features/scripture";
import type { ShowsPanelRef } from "./features/shows";
import {
  useOrganization,
  usePersistedUIState,
} from "./hooks";
import { useAppSettings } from "./hooks/useAppSettings";
import { SettingsScreen } from "./features/settings/components/SettingsScreen";
import { PresentContainer } from "./features/present/PresentContainer";

export default function Home() {
  // Organization & auth
  const { orgId } = useOrganization();

  // Root UI state
  const { viewMode, setViewMode, bottomTab, setBottomTab } = usePersistedUIState();
  const [isAutopilotEnabled, setIsAutopilotEnabled] = useState(false);

  // Shared Data hooks (lifted for Settings vs Present toggling)
  const mediaState = useMediaFolders();
  const { folders, allMediaItems, selectMediaForOutput } = mediaState;
  const settings = useAppSettings({ folders, allMediaItems });

  // Panel Refs (shared for shortcuts/focus)
  const showsPanelRef = useRef<ShowsPanelRef>(null);
  const mediaPanelRef = useRef<MediaPanelRef>(null);
  const scripturePanelRef = useRef<ScripturePanelRef>(null);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        isAutopilotEnabled={isAutopilotEnabled}
        onToggleAutopilot={() => setIsAutopilotEnabled((prev) => !prev)}
      />

      <Activity mode={viewMode === "settings" ? "visible" : "hidden"}>
        <SettingsScreen
          {...settings}
          folders={folders}
          allMediaItems={allMediaItems}
          selectMediaForOutput={selectMediaForOutput}
        />
      </Activity>

      <Activity mode={viewMode === "settings" ? "hidden" : "visible"}>
        <PresentContainer
          orgId={orgId}
          viewMode={viewMode}
          bottomTab={bottomTab}
          setBottomTab={setBottomTab}
          mediaState={mediaState}
          settings={settings}
          showsPanelRef={showsPanelRef}
          mediaPanelRef={mediaPanelRef}
          scripturePanelRef={scripturePanelRef}
          isAutopilotEnabled={isAutopilotEnabled}
        />
      </Activity>
    </div>
  );
}
