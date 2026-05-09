"use client";

import { useEffect, useState } from "react";
import { MonitorUp, Eye } from "lucide-react";
import { cn } from "../../renderer/shared/lib/utils";

const initialState: BrowserModeState = {
  url: "https://www.google.com",
  title: "",
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  projectionTarget: "preview",
  scrollX: 0,
  scrollY: 0,
  previewDataUrl: null,
};

export function BrowserPreviewSidebar() {
  const [browserState, setBrowserState] =
    useState<BrowserModeState>(initialState);

  useEffect(() => {
    if (!window.electronAPI?.getBrowserModeState) {
      return;
    }
    let disposed = false;

    void window.electronAPI.getBrowserModeState().then((state) => {
      if (!disposed) {
        setBrowserState(state);
      }
    });

    const removeListener = window.electronAPI.onBrowserModeStateChanged(
      (state) => {
        if (!disposed) {
          setBrowserState(state);
        }
      }
    );

    return () => {
      disposed = true;
      removeListener?.();
    };
  }, []);

  return (
    <aside className="w-[320px] shrink-0 border-l border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Preview
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              browserState.projectionTarget === "main-output"
                ? "border-primary/70 bg-primary/15 text-primary"
                : "border-border/70 bg-secondary/40 text-muted-foreground"
            )}
          >
            {browserState.projectionTarget === "main-output" ? (
              <MonitorUp className="h-3 w-3" />
            ) : (
              <Eye className="h-3 w-3" />
            )}
            {browserState.projectionTarget === "main-output"
              ? "Live Output"
              : "Local Preview"}
          </span>
        </div>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {browserState.title || browserState.url}
        </p>
      </div>

      <div className="p-3">
        <div className="overflow-hidden rounded-lg border border-border bg-black/40">
          {browserState.previewDataUrl ? (
            <img
              src={browserState.previewDataUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center text-[11px] text-muted-foreground">
              Waiting for live preview...
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Scroll X: {Math.round(browserState.scrollX)}</span>
          <span>Scroll Y: {Math.round(browserState.scrollY)}</span>
        </div>
      </div>
    </aside>
  );
}
