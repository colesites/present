"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PortalContainerContext } from "../../renderer/shared/components/portal-container";
import {
  Search,
  Layers3,
  Presentation,
  PencilLine,
  BookOpenText,
  LibraryBig,
  Globe,
  Check,
  Monitor,
  FileText,
  Music,
  LayoutList,
  Palette,
  Mic2,
  X,
} from "lucide-react";
import { useThemesModalStore } from "../../renderer/shared/store/themesModal";
import { AuthControls } from "../../renderer/shared/components/AuthControls";
import { ProjectButton } from "../../renderer/shared/components/ProjectButton";
import { cn } from "../../renderer/shared/lib/utils";
import type { ViewMode } from "../../shared/types";
import { useGlobalSearchStore } from "../../renderer/shared/store/globalSearchStore";

export type HeaderSearchScope = "services" | "libraries" | "bible";

type SearchResultCategory = "service" | "library" | "scripture";

interface SearchResult {
  id: string;
  label: string;
  sublabel?: string;
  category: SearchResultCategory;
  /** Raw data reference for navigation */
  data: { serviceId?: string; libraryId?: string; reference?: string };
}

interface AppHeaderProps {
  viewMode: ViewMode;
  isBibleActive: boolean;
  isLibrariesActive: boolean;
  searchScope: HeaderSearchScope;
  onViewModeChange: (mode: ViewMode) => void;
  onOpenShow: () => void;
  onOpenComposer: () => void;
  onOpenLibraries: () => void;
  onOpenBible: () => void;
  onOpenBrowser: () => void;
  onOpenStage: () => void;
  onCloseStage: () => void;
  isMediaStageLive: boolean;
  onOpenWorshipStage: () => void;
  onCloseWorshipStage: () => void;
  isWorshipStageLive: boolean;
  onOpenLooks: () => void;
  /** Navigation callbacks from global search */
  onSelectService?: (serviceId: string) => void;
  onSelectLibraryItem?: (libraryId: string) => void;
  onSelectScripture?: (reference: string) => void;
}

const CATEGORY_ORDER: SearchResultCategory[] = [
  "service",
  "library",
  "scripture",
];
const CATEGORY_LABELS: Record<SearchResultCategory, string> = {
  service: "Services",
  library: "Library",
  scripture: "Scripture",
};
const CATEGORY_ICONS: Record<
  SearchResultCategory,
  React.ComponentType<{ className?: string }>
> = {
  service: LayoutList,
  library: Music,
  scripture: BookOpenText,
};

const MAX_RESULTS_PER_CATEGORY = 5;

export const AppHeader = memo(function AppHeader({
  viewMode,
  isBibleActive,
  isLibrariesActive,
  onViewModeChange,
  onOpenShow,
  onOpenComposer,
  onOpenLibraries,
  onOpenBible,
  onOpenBrowser,
  onOpenStage,
  onCloseStage,
  isMediaStageLive,
  onOpenWorshipStage,
  onCloseWorshipStage,
  isWorshipStageLive,
  onOpenLooks,
}: AppHeaderProps) {
  // Read search data from the global store (populated by PresentContainer)
  const services = useGlobalSearchStore((s) => s.services);
  const libraryItems = useGlobalSearchStore((s) => s.libraryItems);
  const searchRequestId = useGlobalSearchStore((s) => s.searchRequestId);
  const closeSearchRequestId = useGlobalSearchStore(
    (s) => s.closeSearchRequestId,
  );
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Held as state, not a ref, so the palette can publish itself as the portal
  // container once attached — `showModal()` puts it in the browser's top layer,
  // where menus portalled to document.body would be painted underneath it.
  const [searchDialogNode, setSearchDialogNode] =
    useState<HTMLDialogElement | null>(null);

  // ── Keyboard shortcut: Cmd/Ctrl + K ──
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setIsSearchOpen(true);
        setQuery("");
        setActiveIndex(0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Auto-focus input when opened ──
  useEffect(() => {
    if (isSearchOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isSearchOpen]);

  useEffect(() => {
    const dialog = searchDialogNode;
    if (!dialog) {
      return;
    }

    if (isSearchOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
      return;
    }

    if (dialog.open) {
      dialog.close();
    }
  }, [isSearchOpen, searchDialogNode]);

  useEffect(() => {
    if (searchRequestId <= 0) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      setIsSearchOpen(true);
      setQuery("");
      setActiveIndex(0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchRequestId]);

  useEffect(() => {
    if (closeSearchRequestId <= 0) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      setIsSearchOpen(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [closeSearchRequestId]);

  // ── Build search results ──
  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const out: SearchResult[] = [];

    // Services
    for (const svc of services) {
      if (out.filter((r) => r.category === "service").length >= MAX_RESULTS_PER_CATEGORY) break;
      if (svc.deleted) continue;
      if (svc.name.toLowerCase().includes(q)) {
        out.push({
          id: `service:${svc._id}`,
          label: svc.name,
          sublabel: svc.date ?? undefined,
          category: "service",
          data: { serviceId: String(svc._id) },
        });
      }
    }

    // Library items
    for (const item of libraryItems) {
      if (out.filter((r) => r.category === "library").length >= MAX_RESULTS_PER_CATEGORY) break;
      if (item.deleted) continue;
      const titleMatch = item.title.toLowerCase().includes(q);
      const bodyMatch = !titleMatch && item.body?.toLowerCase().includes(q);
      if (titleMatch || bodyMatch) {
        out.push({
          id: `library:${item._id}`,
          label: item.title,
          sublabel: item.type
            ? item.type.charAt(0).toUpperCase() + item.type.slice(1)
            : undefined,
          category: "library",
          data: { libraryId: String(item._id) },
        });
      }
    }

    // Scripture hint — if input looks like a Bible reference, offer it
    const scripturePattern =
      /^[1-3]?\s*[a-z]+\s+\d+/i;
    if (scripturePattern.test(query.trim())) {
      out.push({
        id: `scripture:${query.trim()}`,
        label: query.trim(),
        sublabel: "Look up scripture",
        category: "scripture",
        data: { reference: query.trim() },
      });
    }

    return out;
  }, [query, services, libraryItems]);

  // ── Grouped results ──
  const groupedResults = useMemo(() => {
    const groups: { category: SearchResultCategory; items: SearchResult[] }[] =
      [];
    for (const cat of CATEGORY_ORDER) {
      const items = results.filter((r) => r.category === cat);
      if (items.length > 0) {
        groups.push({ category: cat, items });
      }
    }
    return groups;
  }, [results]);

  const flatResults = useMemo(
    () => groupedResults.flatMap((g) => g.items),
    [groupedResults],
  );

  // ── Selection ──
  const handleSelect = useCallback(
    (result: SearchResult) => {
      setIsSearchOpen(false);
      setQuery("");

      const { onSelectService, onSelectLibraryItem, onSelectScripture } = useGlobalSearchStore.getState();

      if (result.category === "service" && result.data.serviceId) {
        onSelectService?.(result.data.serviceId);
      } else if (result.category === "library" && result.data.libraryId) {
        onSelectLibraryItem?.(result.data.libraryId);
      } else if (result.category === "scripture" && result.data.reference) {
        onSelectScripture?.(result.data.reference);
      }
    },
    [],
  );

  // ── Keyboard navigation inside the palette ──
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = flatResults[activeIndex];
        if (selected) {
          handleSelect(selected);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsSearchOpen(false);
      }
    },
    [activeIndex, flatResults, handleSelect],
  );

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector(
      `[data-index="${activeIndex}"]`,
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const openSearchModal = () => {
    setQuery("");
    setActiveIndex(0);
    setIsSearchOpen(true);
  };

  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toLowerCase().includes("mac");

  // Primary navigation — data-driven so the markup stays short and the active
  // rules live in one place.
  const navItems: {
    key: string;
    label: string;
    Icon: typeof Presentation;
    isActive: boolean;
    onClick: () => void;
  }[] = [
    {
      key: "show",
      label: "Show",
      Icon: Presentation,
      isActive: viewMode === "show" && !isBibleActive && !isLibrariesActive,
      onClick: onOpenShow,
    },
    {
      key: "libraries",
      label: "Libraries",
      Icon: LibraryBig,
      isActive: isLibrariesActive,
      onClick: onOpenLibraries,
    },
    {
      key: "edit",
      label: "Edit",
      Icon: PencilLine,
      isActive: viewMode === "edit",
      onClick: () => onViewModeChange("edit"),
    },
    {
      key: "bible",
      label: "Bible",
      Icon: BookOpenText,
      isActive: isBibleActive,
      onClick: onOpenBible,
    },
    {
      key: "browser",
      label: "Browser",
      Icon: Globe,
      isActive: viewMode === "browser",
      onClick: onOpenBrowser,
    },
  ];

  // Secondary tools (right cluster) — icon-only with tooltips to keep the
  // header light. Stage reflects its active view state.
  const toolItems: {
    key: string;
    label: string;
    Icon: typeof Monitor;
    isActive?: boolean;
    isLive?: boolean;
    onClick: () => void;
  }[] = [
    {
      key: "stage",
      label: isMediaStageLive ? "Close Media Stage" : "Media Stage",
      Icon: isMediaStageLive ? X : Layers3,
      isActive: viewMode === "stage",
      isLive: isMediaStageLive,
      onClick: isMediaStageLive ? onCloseStage : onOpenStage,
    },
    {
      key: "worship-stage",
      label: isWorshipStageLive ? "Close Worship Stage" : "Worship Stage",
      Icon: isWorshipStageLive ? X : Mic2,
      isLive: isWorshipStageLive,
      onClick: isWorshipStageLive ? onCloseWorshipStage : onOpenWorshipStage,
    },
    { key: "looks", label: "Looks", Icon: Check, onClick: onOpenLooks },
    {
      key: "composer",
      label: "Screen Composer",
      Icon: Monitor,
      onClick: onOpenComposer,
    },
  ];

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/80 px-3 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={openSearchModal}
            className={cn(
              "group inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[11px] transition",
              isSearchOpen
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border/70 bg-secondary/30 text-muted-foreground hover:border-border hover:text-foreground",
            )}
            title={`Search (${isMac ? "⌘" : "Ctrl+"}K)`}
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="ml-1 hidden rounded border border-border/70 bg-background/60 px-1 py-px font-sans text-[9px] font-medium text-muted-foreground sm:inline-block">
              {isMac ? "⌘K" : "Ctrl K"}
            </kbd>
          </button>

          <span className="h-5 w-px bg-border/70" aria-hidden />

          <button
            type="button"
            onClick={() => useThemesModalStore.getState().toggle()}
            title="Themes"
            aria-label="Themes"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-secondary/30 px-2.5 text-[11px] font-medium text-muted-foreground transition hover:border-border hover:text-foreground"
          >
            <Palette className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Themes</span>
          </button>

          <span className="h-5 w-px bg-border/70" aria-hidden />

          <nav className="flex items-center gap-0.5 rounded-lg bg-secondary/40 p-0.5">
            {navItems.map(({ key, label, Icon, isActive, onClick }) => (
              <button
                key={key}
                type="button"
                onClick={onClick}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition",
                  isActive
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                    : "text-muted-foreground hover:bg-background/40 hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5">
            {toolItems.map(({ key, label, Icon, isActive, isLive, onClick }) => (
              <button
                key={key}
                type="button"
                onClick={onClick}
                aria-pressed={isActive ?? undefined}
                title={label}
                aria-label={label}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-lg transition",
                  isLive
                    ? "bg-destructive/15 text-destructive ring-1 ring-destructive/35 hover:bg-destructive/25"
                    : isActive
                    ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>

          <span className="h-5 w-px bg-border/70" aria-hidden />

          <ProjectButton className="h-8 px-2.5 py-0 text-[11px] font-medium" />
          <AuthControls />
        </div>
      </header>

      {/* ── Global Search Command Palette ── */}
      <dialog
        ref={setSearchDialogNode}
        aria-label="Global search"
        onClose={() => setIsSearchOpen(false)}
        className="m-0 h-screen max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-foreground backdrop:bg-black/60"
      >
        <PortalContainerContext.Provider value={searchDialogNode}>
          <div className="relative flex h-full items-start justify-center pt-[15vh]">
            <button
              type="button"
              aria-label="Close global search"
              className="absolute inset-0 cursor-default"
              onClick={() => setIsSearchOpen(false)}
            />
            <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
              {/* Search input */}
              <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  ref={inputRef}
                  aria-label="Search services, libraries, or scripture"
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Search services, libraries, or scripture…"
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                  autoComplete="off"
                  spellCheck={false}
                />
                <kbd className="hidden sm:inline-flex items-center rounded border border-border bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <div
                ref={listRef}
                className="max-h-[360px] overflow-y-auto overscroll-contain p-1.5"
              >
                {query.trim() && flatResults.length === 0 && (
                  <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                    No results for &ldquo;{query}&rdquo;
                  </div>
                )}

                {!query.trim() && (
                  <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                    Type to search across services, libraries, and scripture
                  </div>
                )}

                {groupedResults.map((group) => {
                  const Icon = CATEGORY_ICONS[group.category];
                  return (
                    <div key={group.category} className="mb-1 last:mb-0">
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <Icon className="h-3 w-3" />
                        {CATEGORY_LABELS[group.category]}
                      </div>
                      {group.items.map((result) => {
                        const flatIdx = flatResults.indexOf(result);
                        const isActive = flatIdx === activeIndex;
                        return (
                          <button
                            key={result.id}
                            type="button"
                            data-index={flatIdx}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                              isActive
                                ? "bg-primary/10 text-foreground"
                                : "text-foreground/80 hover:bg-secondary/60",
                            )}
                            onMouseEnter={() => setActiveIndex(flatIdx)}
                            onClick={() => handleSelect(result)}
                          >
                            <ResultIcon category={result.category} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium text-[13px]">
                                {result.label}
                              </div>
                              {result.sublabel && (
                                <div className="truncate text-[11px] text-muted-foreground">
                                  {result.sublabel}
                                </div>
                              )}
                            </div>
                            {isActive && (
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                ↵
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <kbd className="rounded border border-border bg-secondary/60 px-1 py-0.5 font-mono text-[10px]">↑↓</kbd>
                    navigate
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <kbd className="rounded border border-border bg-secondary/60 px-1 py-0.5 font-mono text-[10px]">↵</kbd>
                    open
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <kbd className="rounded border border-border bg-secondary/60 px-1 py-0.5 font-mono text-[10px]">esc</kbd>
                    close
                  </span>
                </div>
              </div>
            </div>
          </div>
        </PortalContainerContext.Provider>
      </dialog>
    </>
  );
});

/** Per-result icon based on category */
function ResultIcon({ category }: { category: SearchResultCategory }) {
  switch (category) {
    case "service":
      return (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-500/15 text-blue-400">
          <LayoutList className="h-3.5 w-3.5" />
        </div>
      );
    case "library":
      return (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-500/15 text-violet-400">
          <FileText className="h-3.5 w-3.5" />
        </div>
      );
    case "scripture":
      return (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-400">
          <BookOpenText className="h-3.5 w-3.5" />
        </div>
      );
  }
}
