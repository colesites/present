/**
 * The operator's notice that an update is waiting.
 *
 * The core downloads a newer version in the background and relabels the menu
 * item "Restart to Update to 0.4.4" (`services/updates.rs`). This says so in
 * the window too, where it is seen, and restarts only when asked: a restart
 * takes the audience screen off for a few seconds.
 */

import { useEffect } from "react";
import { toast } from "sonner";

import { safelyUnlisten } from "./electron-bridge";

const READY_EVENT = "update:ready";

export function useUpdateNotice() {
  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>(READY_EVENT, (event) => {
          toast(`Present ${event.payload} is ready`, {
            // One notice however often the core checks.
            id: "present-update-ready",
            description: "Restart to update when the screens can be off for a moment.",
            duration: 15_000,
            action: {
              label: "Restart",
              onClick: () => {
                void import("@tauri-apps/api/core").then(({ invoke }) =>
                  invoke("restart_to_update_command"),
                );
              },
            },
          });
        }),
      )
      .then((unlisten) => {
        if (cancelled) {
          safelyUnlisten(unlisten);
          return;
        }
        detach = () => safelyUnlisten(unlisten);
      })
      .catch((error: unknown) => {
        console.error("[updates] could not listen for a waiting update", error);
      });

    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);
}
