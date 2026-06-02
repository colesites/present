"use client";

import {
  AudioLines,
  Clock,
  Layers,
  LayoutTemplate,
  Send,
  Type as TypeIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { useSidebarTabStore } from "../../renderer/shared/store/sidebarTab";
import {
  SIDEBAR_TABS,
  type SidebarTab,
  type MessageOverlay,
} from "../../shared/types";
import type { PropsOverlayItem } from "../../shared/types/output-window";
import type { UseTimersResult } from "../../renderer/shared/hooks";
import { cn } from "../../renderer/shared/lib/utils";
import { MastersTabPanel } from "./panels/MastersTabPanel";
import { MessagesTabPanel } from "./panels/MessagesTabPanel";
import { TimerTabPanel } from "./panels/TimerTabPanel";
import { TextTabPanel } from "./panels/TextTabPanel";
import { AudioTabPanel } from "./panels/AudioTabPanel";
import { LayersTabPanel } from "./panels/LayersTabPanel";

const TAB_META: Record<
  SidebarTab,
  { label: string; Icon: typeof AudioLines }
> = {
  audio: { label: "Audio", Icon: AudioLines },
  text: { label: "Text", Icon: TypeIcon },
  timer: { label: "Timer", Icon: Clock },
  messages: { label: "Messages", Icon: Send },
  layers: { label: "Layers", Icon: Layers },
  masters: { label: "Masters", Icon: LayoutTemplate },
};

export interface SidebarRailProps {
  orgId: Id<"organizations"> | null;

  // Timer toggle (shared with the OutputPreview button)
  isTimerLayerEnabled: boolean;
  onToggleTimerLayer: () => void;

  // Text layer toggle (mirrors Cmd/Ctrl+T)
  isTextLayerEnabled: boolean;
  onToggleTextLayer: () => void;

  // Messages overlay broadcast
  isMessageLayerEnabled: boolean;
  onSetMessageLayerEnabled: (enabled: boolean) => void;
  activeMessageOverlay: MessageOverlay | null;
  onShowMessageOverlay: (overlay: MessageOverlay | null) => void;

  // Live slide push from Masters
  onPushMasterSlide: (master: {
    name: string;
    color: string;
    body: string;
  }) => void;

  // Active prop overlays
  activePropIds: string[];
  onSetActivePropIds: (ids: string[]) => void;

  // Timer state (managed by `useTimers` in PresentContainer)
  timers: UseTimersResult;
}

export function SidebarRail(props: SidebarRailProps) {
  const activeTab = useSidebarTabStore((state) => state.activeTab);
  const setActiveTab = useSidebarTabStore((state) => state.setActiveTab);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-card">
      <SidebarIconStrip activeTab={activeTab} onSelect={setActiveTab} />
      <div className="min-h-0 min-w-0 flex-1">
        <SidebarPanelContent tab={activeTab} {...props} />
      </div>
    </div>
  );
}

// Horizontal strip across the top of the rail (matches the screenshots).
function SidebarIconStrip({
  activeTab,
  onSelect,
}: {
  activeTab: SidebarTab;
  onSelect: (tab: SidebarTab) => void;
}) {
  return (
    <nav
      aria-label="Workspace panels"
      className="flex h-9 w-full shrink-0 items-stretch border-b border-border/70 bg-background/40"
    >
      {SIDEBAR_TABS.map((tab) => {
        const { Icon, label } = TAB_META[tab];
        const isActive = tab === activeTab;
        return (
          <button
            key={tab}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={isActive}
            onClick={() => onSelect(tab)}
            className={cn(
              "group relative flex flex-1 items-center justify-center transition",
              "hover:bg-foreground/5 focus-visible:outline-hidden",
              isActive
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.6} />
          </button>
        );
      })}
    </nav>
  );
}

function SidebarPanelContent({
  tab,
  ...props
}: { tab: SidebarTab } & SidebarRailProps): ReactNode {
  switch (tab) {
    case "masters":
      return (
        <MastersTabPanel
          orgId={props.orgId ?? null}
          onPushSlide={props.onPushMasterSlide}
        />
      );
    case "messages":
      return (
        <MessagesTabPanel
          orgId={props.orgId ?? null}
          isMessageLayerEnabled={props.isMessageLayerEnabled}
          activeOverlay={props.activeMessageOverlay}
          onShowOverlay={props.onShowMessageOverlay}
          onSetMessageLayerEnabled={props.onSetMessageLayerEnabled}
        />
      );
    case "timer":
      return (
        <TimerTabPanel
          isEnabled={props.isTimerLayerEnabled}
          onToggle={props.onToggleTimerLayer}
          timers={props.timers}
        />
      );
    case "text":
      return (
        <TextTabPanel
          isEnabled={props.isTextLayerEnabled}
          onToggle={props.onToggleTextLayer}
        />
      );
    case "audio":
      return <AudioTabPanel orgId={props.orgId ?? null} />;
    case "layers":
      return (
        <LayersTabPanel
          orgId={props.orgId ?? null}
          activePropIds={props.activePropIds}
          onSetActivePropIds={props.onSetActivePropIds}
        />
      );
    default:
      return null;
  }
}

// Re-export for the unused type import warning.
export type { PropsOverlayItem };
