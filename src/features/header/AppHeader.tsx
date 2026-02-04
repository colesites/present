"use client";

import { Settings } from "lucide-react";
import { memo } from "react";
import { AuthControls } from "@/components/AuthControls";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/types";

interface AppHeaderProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  isAutopilotEnabled: boolean;
  onToggleAutopilot: () => void;
}

export const AppHeader = memo(function AppHeader({
  viewMode,
  onViewModeChange,
  isAutopilotEnabled,
  onToggleAutopilot,
}: AppHeaderProps) {
  const openOutput = () => {
    window.open("/output", "present-output", "width=1280,height=720");
  };

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border bg-card px-4">
      {/* Left - Present title */}
      <div className="flex w-48 items-center">
        <h1 className="text-sm font-semibold text-foreground">Present</h1>
      </div>

      {/* Center - View mode tabs */}
      <div className="flex flex-1 items-center justify-center gap-1">
        {/* Autopilot toggle */}
        <button
          type="button"
          onClick={onToggleAutopilot}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition",
            isAutopilotEnabled
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
          title="Automatically follow the active service"
        >
          <span
            className={cn(
              "h-3 w-3 rounded-full border border-current",
              isAutopilotEnabled && "bg-primary",
            )}
          />
          Auto Pilot
        </button>

        {/* Show mode */}
        <button
          type="button"
          onClick={() => onViewModeChange("show")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-1.5 text-xs font-medium transition",
            viewMode === "show"
              ? "bg-primary/20 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <GridIcon />
          Show
        </button>

        {/* Edit mode */}
        <button
          type="button"
          onClick={() => onViewModeChange("edit")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-1.5 text-xs font-medium transition",
            viewMode === "edit"
              ? "bg-primary/20 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <EditIcon />
          Edit
        </button>

        {/* Settings */}
        <button
          type="button"
          onClick={() => onViewModeChange("settings")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-1.5 text-xs font-medium transition",
            viewMode === "settings"
              ? "bg-primary/20 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </button>
      </div>

      {/* Right - Project button + auth */}
      <div className="flex w-48 items-center justify-end gap-3">
        {/* Project button */}
        <button
          type="button"
          onClick={openOutput}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          <MonitorIcon />
          Project
        </button>
        <AuthControls />
      </div>
    </header>
  );
});

// Icons
function GridIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
