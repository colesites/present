"use client";

import { memo, useEffect, useMemo, useState, type FormEvent } from "react";
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
} from "lucide-react";
import { AuthControls } from "../../renderer/shared/components/AuthControls";
import { ProjectButton } from "../../renderer/shared/components/ProjectButton";
import { cn } from "../../renderer/shared/lib/utils";
import { Dialog } from "../../renderer/shared/components/Dialog";
import { Input } from "../../renderer/shared/components/ui/input";
import type { ViewMode } from "../../shared/types";

export type HeaderSearchScope = "services" | "libraries" | "bible";

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
}

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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeSearchTab, setActiveSearchTab] = useState<HeaderSearchScope>(searchScope);

  const openSearchModal = () => {
    setActiveSearchTab(searchScope);
    setIsSearchOpen(true);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setActiveSearchTab(searchScope);
        setIsSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchScope]);

  const searchTabHint = useMemo(() => {
    if (activeSearchTab === "services") {
      return "Search services";
    }
    if (activeSearchTab === "libraries") {
      return "Search libraries";
    }
    return "Search bible";
  }, [activeSearchTab]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (activeSearchTab === "services") {
      onOpenShow();
    } else if (activeSearchTab === "libraries") {
      onOpenLibraries();
    } else {
      onOpenBible();
    }

    setIsSearchOpen(false);
  };

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={openSearchModal}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-secondary/30 transition",
              isSearchOpen
                ? "border-primary/60 bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            title="Search (⌘F)"
          >
            <Search className="h-3.5 w-3.5" />
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

      {isSearchOpen ? (
        <Dialog title="Search" onClose={() => setIsSearchOpen(false)}>
          <div className="space-y-3">
            <div className="flex items-center rounded-md border border-border bg-secondary/30 p-1">
              {(["services", "libraries", "bible"] as HeaderSearchScope[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveSearchTab(tab)}
                  className={cn(
                    "inline-flex flex-1 items-center justify-center rounded-sm px-2 py-1 text-[11px] font-medium capitalize transition",
                    activeSearchTab === tab
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>

            <form onSubmit={handleSearchSubmit} className="space-y-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchTabHint}
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">
                Active scope: <span className="capitalize text-foreground">{activeSearchTab}</span>
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsSearchOpen(false)}
                  className="rounded-md border border-input px-3 py-1.5 text-xs text-foreground hover:bg-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Open
                </button>
              </div>
            </form>
          </div>
        </Dialog>
      ) : null}
    </>
  );
});
