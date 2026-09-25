"use client";

import { Loader2, Lock, Mic, MicOff, X } from "lucide-react";
import { toast } from "sonner";
import { getPresentPlanDefinition, resolvePresentPlanKey } from "@present/shared";
import { cn } from "../../renderer/shared/lib/utils";
import {
  desktopWebBaseUrl,
  useDesktopSessionStore,
} from "../../renderer/shared/store/desktopSession";
import { useSongAgentStore } from "./songAgentStore";

const openPlans = () => {
  void window.electronAPI?.openExternalBrowser?.(`${desktopWebBaseUrl()}/dashboard/billing`);
};

/**
 * The song agent's switch, in the Show view's footer, and what it is doing:
 * listening, following the song on screen, or asking to show the song it
 * hears.
 */
export function SongAgentControl() {
  const enabled = useSongAgentStore((state) => state.enabled);
  const status = useSongAgentStore((state) => state.status);
  const error = useSongAgentStore((state) => state.error);
  const following = useSongAgentStore((state) => state.following);
  const suggestion = useSongAgentStore((state) => state.suggestion);
  const setEnabled = useSongAgentStore((state) => state.setEnabled);
  const accept = useSongAgentStore((state) => state.accept);
  const dismiss = useSongAgentStore((state) => state.dismiss);
  const signedIn = useDesktopSessionStore((state) => Boolean(state.sessionToken));
  const planKey = useDesktopSessionStore((state) => state.user?.billing?.planKey ?? null);
  const included = getPresentPlanDefinition(resolvePresentPlanKey(planKey)).songAiProjection;

  const toggle = () => {
    if (enabled) {
      setEnabled(false);
      return;
    }
    if (!signedIn) {
      toast("Sign in to use the song agent.");
      return;
    }
    if (!included) {
      toast("The song agent comes with Pro and Power.", {
        description: "On Free, the Bible agent finds verses as they're read.",
        action: { label: "See plans", onClick: openPlans },
      });
      return;
    }
    setEnabled(true);
  };

  const title = enabled
    ? "Song agent: listening. Click to stop."
    : error
      ? `Song agent stopped: ${error}`
      : "Song agent: listens to the singing and moves the slides along";

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={enabled}
        title={title}
        className={cn(
          "inline-flex h-7 flex-none items-center gap-1.5 rounded-md px-2 text-[11px] font-medium ring-1 transition",
          enabled
            ? "bg-primary/15 text-foreground ring-primary/50"
            : "text-muted-foreground ring-border/70 hover:text-foreground hover:ring-border",
        )}
      >
        {status === "starting" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : enabled ? (
          <Mic className="h-3.5 w-3.5 text-primary" />
        ) : included || !signedIn ? (
          <MicOff className="h-3.5 w-3.5" />
        ) : (
          <Lock className="h-3.5 w-3.5" />
        )}
        Song agent
      </button>

      {suggestion ? (
        <div className="flex min-w-0 items-center gap-1.5 rounded-md bg-card px-2 py-1 text-[11px] ring-1 ring-primary/40">
          <span className="min-w-0 truncate text-muted-foreground">
            Hearing <span className="font-medium text-foreground">{suggestion.title}</span>
            {suggestion.label ? `, ${suggestion.label}` : ""}
          </span>
          <button
            type="button"
            onClick={accept}
            className="flex-none rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Show
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Not this song"
            className="flex-none rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : enabled ? (
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {status === "starting"
            ? "Starting the microphone…"
            : following
              ? (
                  <>
                    Following <span className="text-foreground">{following.title}</span>
                    {following.label ? `, ${following.label}` : ""}
                  </>
                )
              : "Listening for a song from your library…"}
        </span>
      ) : null}
    </div>
  );
}
