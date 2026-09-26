"use client";

import { useEffect } from "react";
import { MonitorUp } from "lucide-react";
import { useMediaFolders } from "../media/hooks";
import { useMediaLibraryStore } from "../../renderer/shared/store/mediaLibrary";
import { ScreenComposerWorkspace } from "./ScreenComposerWorkspace";
import { useScreenComposerState } from "./useScreenComposerState";

export function ScreenComposerWindow() {
  const composer = useScreenComposerState();

  // The media library, so a region's media can be chosen here. It used to be
  // chosen only from the main window's Media panel, and only while the
  // composer was on the screen, so a region being set up had no way to get
  // any.
  const { allMediaItems } = useMediaFolders();
  useEffect(() => {
    useMediaLibraryStore.getState().setItems(allMediaItems);
  }, [allMediaItems]);

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 border-b border-border bg-card/70 px-3 py-2">
        <span className="rounded-md border border-border bg-background/70 p-1.5 text-primary">
          <MonitorUp className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-semibold">Screen Composer</p>
          <p className="text-[11px] text-muted-foreground">
            Build multi-region outputs, then Apply or Go Live.
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ScreenComposerWorkspace composer={composer} />
      </div>
    </div>
  );
}
