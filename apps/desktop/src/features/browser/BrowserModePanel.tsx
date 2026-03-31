"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
import {
  getLocalBrowserSuggestions,
  isLikelyBrowserUrlInput,
  rememberBrowserHistoryEntry,
  type BrowserOmniboxSuggestion,
} from "./browser-suggestions";

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
  const [isAddressFocused, setIsAddressFocused] = useState(false);
  const [isSuggestionMenuOpen, setIsSuggestionMenuOpen] = useState(false);
  const [remoteSuggestionsByQuery, setRemoteSuggestionsByQuery] = useState<
    Record<string, BrowserOmniboxSuggestion[]>
  >({});
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const isAddressFocusedRef = useRef(false);
  const hasDraftInputRef = useRef(false);
  const lastRecordedHistoryUrlRef = useRef<string | null>(null);
  const suggestionRequestIdRef = useRef(0);

  const interpretedInput = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return {
        verb: "Search",
        value: "Type a website or anything to search",
      };
    }

    if (isLikelyBrowserUrlInput(trimmed)) {
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

  const localSuggestions = useMemo(() => {
    return getLocalBrowserSuggestions(query);
  }, [query]);

  const remoteSuggestionQuery = useMemo(() => {
    const trimmed = query.trim();
    if (
      !isAddressFocused ||
      !isSuggestionMenuOpen ||
      !trimmed ||
      isLikelyBrowserUrlInput(trimmed)
    ) {
      return null;
    }

    return trimmed.toLowerCase();
  }, [isAddressFocused, isSuggestionMenuOpen, query]);

  const remoteSuggestions = useMemo(() => {
    if (!remoteSuggestionQuery) {
      return [];
    }

    return remoteSuggestionsByQuery[remoteSuggestionQuery] ?? [];
  }, [remoteSuggestionQuery, remoteSuggestionsByQuery]);

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const mergedSuggestions: BrowserOmniboxSuggestion[] = [];

    for (const suggestion of [...localSuggestions, ...remoteSuggestions]) {
      const normalizedValue = suggestion.value.trim().toLowerCase();
      if (!normalizedValue || seen.has(normalizedValue)) {
        continue;
      }

      seen.add(normalizedValue);
      mergedSuggestions.push(suggestion);
    }

    return mergedSuggestions.slice(0, 8);
  }, [localSuggestions, remoteSuggestions]);

  const isSuggestionDropdownVisible =
    isAddressFocused && isSuggestionMenuOpen && suggestions.length > 0;
  const activeSuggestionIndex =
    selectedSuggestionIndex >= 0 && selectedSuggestionIndex < suggestions.length
      ? selectedSuggestionIndex
      : -1;

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
    const currentUrl = browserState.url.trim();
    if (!currentUrl) {
      return;
    }

    const shouldIncrementVisitCount =
      lastRecordedHistoryUrlRef.current !== currentUrl;

    rememberBrowserHistoryEntry({
      incrementVisitCount: shouldIncrementVisitCount,
      title: browserState.title,
      url: currentUrl,
    });

    lastRecordedHistoryUrlRef.current = currentUrl;
  }, [browserState.title, browserState.url]);

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
      if (event.defaultPrevented) {
        return;
      }

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

  useEffect(() => {
    if (
      !remoteSuggestionQuery ||
      remoteSuggestionsByQuery[remoteSuggestionQuery] ||
      !window.electronAPI?.fetchBrowserSuggestions
    ) {
      return;
    }

    const requestId = suggestionRequestIdRef.current + 1;
    suggestionRequestIdRef.current = requestId;

    const timeoutId = window.setTimeout(() => {
      void window.electronAPI
        .fetchBrowserSuggestions(remoteSuggestionQuery)
        .then((response) => {
          if (suggestionRequestIdRef.current !== requestId) {
            return;
          }

          const nextSuggestions = (response?.suggestions ?? [])
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => ({
              description: "Search suggestion",
              id: `remote:${value.toLowerCase()}`,
              kind: "remote" as const,
              title: value,
              value,
            }));

          setRemoteSuggestionsByQuery((currentSuggestionsByQuery) => {
            if (currentSuggestionsByQuery[remoteSuggestionQuery]) {
              return currentSuggestionsByQuery;
            }

            return {
              ...currentSuggestionsByQuery,
              [remoteSuggestionQuery]: nextSuggestions,
            };
          });
        })
        .catch(() => {
          if (suggestionRequestIdRef.current !== requestId) {
            return;
          }
        });
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [remoteSuggestionQuery, remoteSuggestionsByQuery]);

  const navigateToInput = useCallback(
    async (rawInput: string) => {
      const input = rawInput.trim();
      if (!input || !window.electronAPI?.browserNavigate) {
        return;
      }

      hasDraftInputRef.current = false;
      setIsSuggestionMenuOpen(false);
      setSelectedSuggestionIndex(-1);
      setQuery(input);

      const state = await window.electronAPI.browserNavigate(input);
      handleIncomingState(state);
      setQuery(state.url || input);
    },
    [handleIncomingState]
  );

  const handleNavigate = useCallback(async () => {
    await navigateToInput(query);
  }, [navigateToInput, query]);

  const handleSuggestionSelect = useCallback(
    async (suggestion: BrowserOmniboxSuggestion) => {
      await navigateToInput(suggestion.value);
    },
    [navigateToInput]
  );

  const handleAddressKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown" && suggestions.length > 0) {
        event.preventDefault();
        setIsSuggestionMenuOpen(true);
        setSelectedSuggestionIndex((currentIndex) => {
          if (currentIndex >= suggestions.length - 1) {
            return 0;
          }

          return currentIndex + 1;
        });
        return;
      }

      if (event.key === "ArrowUp" && suggestions.length > 0) {
        event.preventDefault();
        setIsSuggestionMenuOpen(true);
        setSelectedSuggestionIndex((currentIndex) => {
          if (currentIndex <= 0) {
            return suggestions.length - 1;
          }

          return currentIndex - 1;
        });
        return;
      }

      if (
        event.key === "Enter" &&
        activeSuggestionIndex >= 0 &&
        suggestions[activeSuggestionIndex]
      ) {
        event.preventDefault();
        void handleSuggestionSelect(suggestions[activeSuggestionIndex]);
        return;
      }

      if (event.key === "Tab" && suggestions.length > 0) {
        event.preventDefault();
        const suggestion =
          suggestions[activeSuggestionIndex >= 0 ? activeSuggestionIndex : 0];
        hasDraftInputRef.current = true;
        setIsSuggestionMenuOpen(true);
        setSelectedSuggestionIndex(
          activeSuggestionIndex >= 0 ? activeSuggestionIndex : 0
        );
        setQuery(suggestion.value);
        return;
      }

      if (event.key === "Escape" && isSuggestionDropdownVisible) {
        event.preventDefault();
        event.stopPropagation();
        setIsSuggestionMenuOpen(false);
        setSelectedSuggestionIndex(-1);
      }
    },
    [
      activeSuggestionIndex,
      handleSuggestionSelect,
      isSuggestionDropdownVisible,
      suggestions,
    ]
  );

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
                  setSelectedSuggestionIndex(-1);
                  setIsSuggestionMenuOpen(true);
                }}
                onFocus={() => {
                  isAddressFocusedRef.current = true;
                  setIsAddressFocused(true);
                  setIsSuggestionMenuOpen(true);
                  setSelectedSuggestionIndex(-1);
                }}
                onBlur={() => {
                  isAddressFocusedRef.current = false;
                  setIsAddressFocused(false);
                  setIsSuggestionMenuOpen(false);
                  setSelectedSuggestionIndex(-1);
                }}
                onKeyDown={handleAddressKeyDown}
                autoComplete="off"
                className="h-8 rounded-lg border-border/70 bg-background/80 pl-8 pr-20 text-xs ring-offset-0 focus-visible:ring-1"
                placeholder="Search or enter URL"
                spellCheck={false}
              />
              <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                <Kbd className="h-5 px-1.5 text-[10px]">⌘L</Kbd>
              </div>
              {isSuggestionDropdownVisible ? (
                <div className="absolute inset-x-0 top-[calc(100%+0.35rem)] z-30 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-xl">
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={() => {
                        void handleSuggestionSelect(suggestion);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 border-b border-border/60 px-3 py-2 text-left transition last:border-b-0",
                        activeSuggestionIndex === index
                          ? "bg-accent text-accent-foreground"
                          : "bg-popover hover:bg-accent/60"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-foreground">
                          {suggestion.title}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {suggestion.description}
                        </div>
                      </div>
                      <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        {suggestion.kind === "history" ? "Recent" : "Search"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
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
                setSelectedSuggestionIndex(-1);
                setIsSuggestionMenuOpen(true);
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
