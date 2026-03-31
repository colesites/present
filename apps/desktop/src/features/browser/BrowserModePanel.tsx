"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Globe,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  MonitorUp,
  X,
} from "lucide-react";
import { Input } from "../../renderer/shared/components/ui/input";
import { Kbd } from "../../renderer/shared/components/ui/kbd";
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

export function BrowserModePanel() {
  const [browserState, setBrowserState] =
    useState<BrowserModeState>(initialState);
  const [query, setQuery] = useState("https://www.google.com");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const isAddressFocusedRef = useRef(false);
  const hasDraftInputRef = useRef(false);

  const interpretedInput = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return {
        verb: "Search",
        value: "Type a website or anything to search",
      };
    }

    const lower = trimmed.toLowerCase();
    const hasProtocol =
      lower.startsWith("http://") || lower.startsWith("https://");
    const hasSpace = /\s/.test(trimmed);
    const likelyDomain =
      !hasSpace &&
      (trimmed.includes(".") ||
        lower.startsWith("localhost:") ||
        lower.startsWith("127.0.0.1:"));

    if (hasProtocol || likelyDomain) {
      return {
        verb: "Open",
        value: trimmed,
      };
    }

    return {
      verb: "Search",
      value: trimmed,
    };
  }, [query]);

  const syncBounds = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !window.electronAPI?.setBrowserModeBounds) {
      return;
    }
    const rect = viewport.getBoundingClientRect();
    void window.electronAPI.setBrowserModeBounds({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  const handleIncomingState = useCallback(
    (state: BrowserModeState) => {
      setBrowserState(state);
      if (!isAddressFocusedRef.current && !hasDraftInputRef.current) {
        setQuery(state.url);
      }
    },
    []
  );

  useEffect(() => {
    if (!window.electronAPI?.setBrowserModeEnabled) {
      return;
    }

    let disposed = false;
    void window.electronAPI.setBrowserModeEnabled(true).then((state) => {
      if (disposed) {
        return;
      }
      handleIncomingState(state);
      syncBounds();
    });

    const removeBrowserStateListener =
      window.electronAPI.onBrowserModeStateChanged((state) => {
        if (disposed) {
          return;
        }
        handleIncomingState(state);
      });

    const removeBrowserFocusListener = window.electronAPI.onBrowserFocusAddress(
      () => {
        if (disposed) {
          return;
        }
        addressInputRef.current?.focus();
        addressInputRef.current?.select();
      }
    );

    return () => {
      disposed = true;
      removeBrowserStateListener?.();
      removeBrowserFocusListener?.();
      void window.electronAPI.setBrowserModeEnabled(false);
    };
  }, [handleIncomingState, syncBounds]);

  useEffect(() => {
    syncBounds();
    const observer = new ResizeObserver(() => {
      syncBounds();
    });

    const viewport = viewportRef.current;
    if (viewport) {
      observer.observe(viewport);
    }

    window.addEventListener("resize", syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [syncBounds]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        addressInputRef.current?.focus();
        addressInputRef.current?.select();
        return;
      }

      if (
        event.key === "Escape" &&
        document.activeElement === addressInputRef.current
      ) {
        addressInputRef.current?.blur();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleNavigate = useCallback(async () => {
    const input = query.trim();
    if (!input || !window.electronAPI?.browserNavigate) {
      return;
    }
    hasDraftInputRef.current = false;
    const state = await window.electronAPI.browserNavigate(input);
    handleIncomingState(state);
    setQuery(state.url || input);
  }, [handleIncomingState, query]);

  const handleSetProjection = useCallback(
    async (target: "preview" | "main-output") => {
      if (!window.electronAPI?.setBrowserProjectionTarget) {
        return;
      }
      const state = await window.electronAPI.setBrowserProjectionTarget(target);
      setBrowserState(state);
    },
    []
  );

  const title = useMemo(() => {
    if (browserState.title.trim()) {
      return browserState.title;
    }
    return browserState.url || "Browser";
  }, [browserState.title, browserState.url]);

  const hostname = useMemo(() => {
    try {
      return new URL(browserState.url).hostname;
    } catch {
      return "Ready";
    }
  }, [browserState.url]);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border/70 bg-card px-3 py-2">
        <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/80 px-2 py-1.5 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={() =>
              void window.electronAPI?.browserBack?.().then(handleIncomingState)
            }
            disabled={!browserState.canGoBack}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-secondary/30 text-foreground transition hover:bg-secondary/60 disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              void window.electronAPI?.browserForward?.().then(
                handleIncomingState
              )
            }
            disabled={!browserState.canGoForward}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-secondary/30 text-foreground transition hover:bg-secondary/60 disabled:opacity-40"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              void window.electronAPI?.browserReload?.().then(
                handleIncomingState
              )
            }
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-secondary/30 text-foreground transition hover:bg-secondary/60"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                browserState.isLoading ? "animate-spin" : undefined
              )}
            />
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleNavigate();
            }}
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            <div className="relative min-w-0 flex-1">
              <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-primary/80" />
              <Input
                ref={addressInputRef}
                value={query}
                onChange={(event) => {
                  hasDraftInputRef.current = true;
                  setQuery(event.target.value);
                }}
                onFocus={() => {
                  isAddressFocusedRef.current = true;
                }}
                onBlur={() => {
                  isAddressFocusedRef.current = false;
                }}
                className="h-8 rounded-lg border-border/70 bg-background/80 pl-8 pr-20 text-xs ring-offset-0 focus-visible:ring-1"
                placeholder="Search or enter URL"
              />
              <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                <Kbd className="h-5 px-1.5 text-[10px]">⌘L</Kbd>
              </div>
            </div>
            <button
              type="submit"
              onClick={() => {
                hasDraftInputRef.current = false;
              }}
              className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              Go
            </button>
            <button
              type="button"
              onClick={() => {
                hasDraftInputRef.current = true;
                setQuery("");
                addressInputRef.current?.focus();
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-secondary/30 text-foreground transition hover:bg-secondary/60"
              title="Clear input"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </form>
          <button
            type="button"
            onClick={() => void handleSetProjection("preview")}
            className={cn(
              "inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium transition",
              browserState.projectionTarget === "preview"
                ? "border-primary/70 bg-primary/15 text-primary shadow-sm"
                : "border-border/70 bg-secondary/30 text-foreground hover:bg-secondary/50"
            )}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => void handleSetProjection("main-output")}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition",
              browserState.projectionTarget === "main-output"
                ? "border-primary/70 bg-primary/15 text-primary shadow-sm"
                : "border-border/70 bg-secondary/30 text-foreground hover:bg-secondary/50"
            )}
          >
            <MonitorUp className="h-3.5 w-3.5" />
            Main Output
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate">
            {interpretedInput.verb}:{" "}
            <span className="text-foreground/90">{interpretedInput.value}</span>
          </span>
          <span className="shrink-0 rounded-md border border-border/70 bg-secondary/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-foreground/80">
            {hostname}
          </span>
        </div>
        <div className="truncate px-1 text-[11px] text-muted-foreground">
          {title}
        </div>
      </div>

      <div ref={viewportRef} className="min-h-0 flex-1 bg-black/5" />
    </div>
  );
}
