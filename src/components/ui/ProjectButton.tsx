"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Monitor, MonitorOff, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// TypeScript interfaces for the experimental Window Management API
// ============================================================================

interface ScreenDetailed {
  availHeight: number;
  availLeft: number;
  availTop: number;
  availWidth: number;
  colorDepth: number;
  devicePixelRatio: number;
  height: number;
  isExtended: boolean;
  isInternal: boolean;
  isPrimary: boolean;
  label: string;
  left: number;
  orientation: ScreenOrientation;
  pixelDepth: number;
  top: number;
  width: number;
}

interface ScreenDetails {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
  addEventListener(
    type: "screenschange" | "currentscreenchange",
    listener: EventListener
  ): void;
  removeEventListener(
    type: "screenschange" | "currentscreenchange",
    listener: EventListener
  ): void;
}

// Extend the Window interface to include the experimental API
declare global {
  interface Window {
    getScreenDetails?: () => Promise<ScreenDetails>;
  }
}

// ============================================================================
// ProjectButton Component
// ============================================================================

interface ProjectButtonProps {
  className?: string;
}

export function ProjectButton({ className }: ProjectButtonProps) {
  const [isLive, setIsLive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSecondaryScreen, setHasSecondaryScreen] = useState<boolean | null>(
    null
  );
  const windowRef = useRef<Window | null>(null);

  // Check if the output window is still open
  const checkWindowStatus = useCallback(() => {
    if (windowRef.current && !windowRef.current.closed) {
      setIsLive(true);
    } else {
      setIsLive(false);
      windowRef.current = null;
    }
  }, []);

  // Poll to check if window was closed externally
  useEffect(() => {
    const interval = setInterval(checkWindowStatus, 1000);
    return () => clearInterval(interval);
  }, [checkWindowStatus]);

  // Check for secondary screen availability on mount
  useEffect(() => {
    async function checkScreens() {
      if (!window.getScreenDetails) {
        setHasSecondaryScreen(false);
        return;
      }

      try {
        // This will prompt for permission if not already granted
        const screenDetails = await window.getScreenDetails();
        const secondaryScreen = screenDetails.screens.find(
          (screen) => screen !== screenDetails.currentScreen
        );
        setHasSecondaryScreen(!!secondaryScreen);
      } catch {
        // Permission denied or API not supported
        setHasSecondaryScreen(false);
      }
    }

    // Only check if the API exists
    if (window.getScreenDetails) {
      // Don't auto-request permission, just check if API exists
      setHasSecondaryScreen(null); // Unknown until clicked
    } else {
      setHasSecondaryScreen(false);
    }
  }, []);

  const openOnSecondaryScreen = useCallback(async () => {
    // If window already exists and is open, focus it
    if (windowRef.current && !windowRef.current.closed) {
      windowRef.current.focus();
      return;
    }

    setIsLoading(true);

    try {
      // Check if Window Management API is supported
      if (!window.getScreenDetails) {
        throw new Error("Window Management API not supported");
      }

      // Request screen details (this will prompt for permission)
      const screenDetails = await window.getScreenDetails();

      // Find a secondary screen (not the current screen)
      const secondaryScreen = screenDetails.screens.find(
        (screen) => screen !== screenDetails.currentScreen
      );

      if (!secondaryScreen) {
        throw new Error("No secondary screen found");
      }

      setHasSecondaryScreen(true);

      // Open window on the secondary screen, filling it completely
      const { left, top, width, height } = secondaryScreen;

      // Build the window features string
      const features = [
        `left=${left}`,
        `top=${top}`,
        `width=${width}`,
        `height=${height}`,
        "popup=yes",
        "menubar=no",
        "toolbar=no",
        "location=no",
        "status=no",
        "resizable=yes",
        "scrollbars=no",
      ].join(",");

      const newWindow = window.open("/output", "present-output", features);

      if (newWindow) {
        windowRef.current = newWindow;
        setIsLive(true);

        // Try to make it fullscreen after a short delay
        setTimeout(() => {
          try {
            newWindow.moveTo(left, top);
            newWindow.resizeTo(width, height);
          } catch {
            // Cross-origin restrictions may prevent this
          }
        }, 100);
      }
    } catch (error) {
      const err = error as Error;

      // Fallback: Open in a new tab
      if (
        err.message === "No secondary screen found" ||
        err.message === "Window Management API not supported"
      ) {
        const message =
          err.message === "No secondary screen found"
            ? "No external display detected. Opening in a new tab instead.\n\nTip: Connect a projector or external monitor, then try again."
            : "Your browser doesn't support the Window Management API. Opening in a new tab instead.\n\nTip: Use Chrome or Edge for the best experience.";

        alert(message);

        // Open in a new tab as fallback
        const newWindow = window.open("/output", "present-output");
        if (newWindow) {
          windowRef.current = newWindow;
          setIsLive(true);
        }
      } else if (err.name === "NotAllowedError") {
        alert(
          "Permission denied. Please allow screen access to use the projector feature.\n\nYou can reset this in your browser's site settings."
        );
      } else {
        console.error("Failed to open on secondary screen:", err);
        alert(`Failed to open output window: ${err.message}`);
      }

      setHasSecondaryScreen(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const closeOutput = useCallback(() => {
    if (windowRef.current && !windowRef.current.closed) {
      windowRef.current.close();
    }
    windowRef.current = null;
    setIsLive(false);
  }, []);

  const handleClick = useCallback(() => {
    if (isLive) {
      // If already live, focus the window (or close if shift-click)
      if (windowRef.current && !windowRef.current.closed) {
        windowRef.current.focus();
      }
    } else {
      openOnSecondaryScreen();
    }
  }, [isLive, openOnSecondaryScreen]);

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
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        onContextMenu={handleRightClick}
        disabled={isLoading}
        className={cn(
          "group relative flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200",
          isLive
            ? "bg-green-600 text-white shadow-lg shadow-green-500/25 hover:bg-green-500"
            : "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25 hover:from-indigo-500 hover:to-purple-500",
          isLoading && "cursor-wait opacity-70",
          className
        )}
        title={
          isLive
            ? "Click to focus output window • Right-click to close"
            : "Open output on external display"
        }
      >
        {isLoading ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <span>Detecting...</span>
          </>
        ) : isLive ? (
          <>
            <Monitor className="h-4 w-4" />
            <span>Live</span>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
          </>
        ) : (
          <>
            <ExternalLink className="h-4 w-4" />
            <span>Go Live</span>
          </>
        )}
      </button>

      {/* Status indicator */}
      {hasSecondaryScreen === false && !isLive && (
        <div
          className="flex items-center gap-1 text-xs text-muted-foreground"
          title="No external display detected"
        >
          <MonitorOff className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}
