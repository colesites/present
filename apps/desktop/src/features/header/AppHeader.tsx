"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
} from "lucide-react";
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
  searchScope,
  onViewModeChange,
  onOpenShow,
  onOpenComposer,
  onOpenLibraries,
  onOpenBible,
  onOpenBrowser,
  onOpenStage,
  onOpenLooks,
}: AppHeaderProps) {
  // Read search data from the global store (populated by PresentContainer)
  const services = useGlobalSearchStore((s) => s.services);
  const libraryItems = useGlobalSearchStore((s) => s.libraryItems);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={openSearchModal}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-secondary/30 px-2 transition",
              isSearchOpen
                ? "border-primary/60 bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={`Search (${isMac ? "⌘" : "Ctrl+"}K)`}
          >
            <Search className="h-3.5 w-3.5" />
            <span className="text-[10px] font-medium opacity-60">
              {isMac ? "⌘K" : "Ctrl+K"}
            </span>
          </button>
          <div className="flex items-center rounded-md border border-border bg-secondary/40 p-1">
            <button
              type="button"
              onClick={onOpenShow}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-medium transition",
                viewMode === "show" &&
                  !isBibleActive &&
                  !isLibrariesActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Presentation className="h-3.5 w-3.5" />
              Show
            </button>
            <button
              type="button"
              onClick={onOpenLibraries}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-medium transition",
                isLibrariesActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LibraryBig className="h-3.5 w-3.5" />
              Libraries
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("edit")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-medium transition",
                viewMode === "edit"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <PencilLine className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              type="button"
              onClick={onOpenBible}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-medium transition",
                isBibleActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <BookOpenText className="h-3.5 w-3.5" />
              Bible
            </button>
            <button
              type="button"
              onClick={onOpenBrowser}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-medium transition",
                viewMode === "browser"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Globe className="h-3.5 w-3.5" />
              Browser
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ProjectButton className="h-8 px-2.5 py-0 text-[11px] font-medium" />
          <button
            type="button"
            onClick={onOpenStage}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition",
              viewMode === "stage"
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-border bg-secondary/30 text-foreground hover:bg-secondary"
            )}
          >
            <Layers3 className="h-3.5 w-3.5" />
            Media Stage
          </button>
          <button
            type="button"
            onClick={onOpenLooks}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-secondary/30 px-2.5 text-[11px] font-medium text-foreground transition hover:bg-secondary"
          >
            <Check className="h-3.5 w-3.5" />
            Looks
          </button>
          <button
            type="button"
            onClick={onOpenComposer}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-secondary/30 px-2.5 text-[11px] font-medium text-foreground transition hover:bg-secondary"
          >
            <Monitor className="h-3.5 w-3.5" />
            Screen Composer
          </button>
          <AuthControls />
        </div>
      </header>

      {/* ── Global Search Command Palette ── */}
      {isSearchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsSearchOpen(false);
          }}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
          >
            {/* Search input */}
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
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
      )}
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
