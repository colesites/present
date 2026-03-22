"use client";

import { useState, useCallback, useEffect } from "react";
import { Monitor, X, Loader2 } from "lucide-react";
import { cn } from "../lib/utils";

// electronAPI types are now defined globally in src/types/electron.d.ts

// ============================================================================
// ProjectButton Component
// ============================================================================

interface ProjectButtonProps {
  className?: string;
}

export function ProjectButton({ className }: ProjectButtonProps) {
  const [isLive, setIsLive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Setup the listener for when the window is closed externally (e.g. by hitting 'X')
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onOutputWindowClosed(() => {
        setIsLive(false);
      });
    }
  }, []);

  // Check for secondary screen availability on mount
  useEffect(() => {
    async function checkScreens() {
      if (!window.electronAPI) {
        return;
      }
      try {
        await window.electronAPI.getDisplays();
      } catch (err) {
        console.error("Failed to check screens:", err);
      }
    }
    
    checkScreens();
  }, []);

  const openOnSecondaryScreen = useCallback(async () => {
    setIsLoading(true);

    try {
      if (!window.electronAPI) {
        throw new Error("Electron API not available");
      }

      const success = await window.electronAPI.openOutputWindow();
      
      if (success) {
        setIsLive(true);
      }
      
      // Recheck screens just in case
      await window.electronAPI.getDisplays();
      
    } catch (error) {
      const err = error as Error;
      console.error("Failed to open output window:", err);
      alert(`Failed to open output window: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const closeOutput = useCallback(async () => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.closeOutputWindow();
      }
    } catch (err) {
      console.error("Failed to close window:", err);
    }
    setIsLive(false);
  }, []);

  const handleClick = useCallback(() => {
    if (isLive) {
      closeOutput();
    } else {
      openOnSecondaryScreen();
    }
  }, [isLive, closeOutput, openOnSecondaryScreen]);

  const handleRightClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isLive) {
        closeOutput();
      }
    },
    [isLive, closeOutput]
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      onContextMenu={handleRightClick}
      disabled={isLoading}
      className={cn(
        "flex items-center gap-2 rounded-md px-4 py-1.5 text-xs font-semibold transition",
        isLive
          ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
          : "bg-primary text-primary-foreground hover:bg-primary/90",
        isLoading && "cursor-wait opacity-70",
        className
      )}
      title={isLive ? "Close output window" : "Open output window"}
    >
      {isLoading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Project
        </>
      ) : isLive ? (
        <>
          <X className="h-4 w-4" />
          Close
        </>
      ) : (
        <>
          <Monitor className="h-4 w-4" />
          Project
        </>
      )}
    </button>
  );
}
