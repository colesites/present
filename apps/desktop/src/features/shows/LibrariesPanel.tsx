"use client";

import {
  memo,
  useState,
  forwardRef,
  useImperativeHandle,
  useRef,
  useMemo,
  useCallback,
  useId,
} from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { LibraryItem, Category, ContentSource, LibraryItemDraft } from "../../shared/types";
import type { LibrarySearchMode } from "../library/hooks";
import { Dialog } from "../../renderer/shared/components/Dialog";
import { Input } from "../../renderer/shared/components/ui/input";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../renderer/shared/components/ui/select";
import { Spinner } from "../../renderer/shared/components/ui/spinner";
import { Skeleton } from "../../renderer/shared/components/ui/skeleton";
import { cn } from "../../renderer/shared/lib/utils";
import { useDesktopSessionStore } from "../../renderer/shared/store/desktopSession";
import { useSpeechRecognition } from "../scripture/hooks/useSpeechRecognition";
import {
  Search,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Layers3,
  ArrowUp,
  ArrowDown,
  ArrowDownToLine,
  ArrowUpFromLine,
  LayoutGrid,
  List,
  Loader2,
  Library,
  Mic,
  MicOff,
  Music2,
  BookOpenText,
  FileText,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "../../renderer/shared/components/ui/dropdown-menu";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "../../renderer/shared/components/ui/resizable";
import { invoke } from "@tauri-apps/api/core";

type ImportedSongFile = {
  fileName: string;
  song: {
    title: string;
    authors: string[];
    copyright: string | null;
    ccliNumber: string | null;
    body: string;
    slideCount: number;
  } | null;
  error: string | null;
};

interface LibrariesPanelProps {
  libraryItems: LibraryItem[];
  composeLibraryItems: LibraryItem[];
  categories: Category[];
  selectedLibraryId: string | null;
  selectedCategoryId: string | null;
  isInsideService: boolean;
  selectedServiceId: Id<"services"> | null;
  isLoading?: boolean;
  onSelectLibraryItem: (id: string) => void;
  onSelectCategory: (id: string | null) => void;
  onCreateLibraryItem: (
    title: string,
    body: string,
    categoryId?: string,
  ) => Promise<unknown>;
  // Creates an empty library item and opens it directly in the editor
  // (Lyrics view). Used by the "New library item" buttons instead of a modal.
  onNewLibraryItem: () => Promise<void>;
  onCreateLibraryItemFromDraft: (
    draft: LibraryItemDraft,
    categoryId?: string,
  ) => Promise<unknown>;
  onCreateComposedLibraryItem: (
    title: string,
    itemIds: string[],
    categoryId?: string,
    slideSelections?: Record<string, number[]>,
  ) => Promise<unknown>;
  onUpdateComposedLibraryItem: (
    itemId: string,
    title: string,
    itemIds: string[],
    categoryId?: string,
    slideSelections?: Record<string, number[]>,
  ) => Promise<unknown>;
  onRenameLibraryItem: (
    id: string,
    title: string,
    categoryId?: string,
  ) => Promise<void>;
  onDeleteLibraryItem: (id: string) => Promise<void>;
  onAddToService: (libraryId: string) => void;
  onOpenMiniEditor: (libraryId: string) => void;
  onCreateCategory: (name: string) => Promise<unknown>;
  onFixLyrics: (lyrics: string) => Promise<string>;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchMode: LibrarySearchMode;
  onSearchModeChange: (mode: LibrarySearchMode) => void;
  contentSource: ContentSource;
  speechLang: string;
  speechInputDeviceId: string | null;
}

export interface LibrariesPanelRef {
  focusSearch: () => void;
}

const normalizedCategoryKey = (name: string) => name.trim().toLowerCase();

export const LibrariesPanel = memo(
  forwardRef<LibrariesPanelRef, LibrariesPanelProps>(function LibrariesPanel(
    {
      libraryItems,
      composeLibraryItems,
      categories,
      selectedLibraryId,
      selectedCategoryId,
      isInsideService,
      selectedServiceId,
      isLoading = false,
      onSelectLibraryItem,
      onSelectCategory,
      onNewLibraryItem,
      onCreateLibraryItemFromDraft,
      onCreateComposedLibraryItem,
      onUpdateComposedLibraryItem,
      onRenameLibraryItem,
      onDeleteLibraryItem,
      onAddToService,
      onOpenMiniEditor,
      onCreateCategory,
      searchQuery,
      onSearchChange,
      searchMode,
      onSearchModeChange,
      contentSource,
      speechLang,
      speechInputDeviceId,
    }: LibrariesPanelProps,
    ref,
  ) {
    const [showNewCategoryDialog, setShowNewCategoryDialog] = useState(false);
    const [showComposeDialog, setShowComposeDialog] = useState(false);
    const [composeEditTarget, setComposeEditTarget] = useState<LibraryItem | null>(
      null,
    );
    const [renameTarget, setRenameTarget] = useState<{
      id: string;
      title: string;
      categoryId?: string;
    } | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{
      id: string;
      title: string;
    } | null>(null);

    const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [layoutMode, setLayoutMode] = useState<"grid" | "list">("list");
    // Selection state was removed from the library list — flow composition
    // now happens entirely inside the Create Flow wizard. Kept the dialog's
    // mount as `showComposeDialog`.


    const searchInputRef = useRef<HTMLInputElement>(null);
    const sessionToken = useDesktopSessionStore((state) => state.sessionToken);

    const {
      isListening: isSpeechListening,
      isStarting: isSpeechStarting,
      isSupported: isSpeechSupported,
      error: speechError,
      startListening,
      stopListening,
    } = useSpeechRecognition({
      sessionToken,
      lang: speechLang,
      inputDeviceId: speechInputDeviceId,
      usageSource: "library",
      onResult: ({ transcript }) => {
        onSearchChange(transcript);
      },
      onFinalResult: (transcript) => {
        onSearchChange(transcript);
      },
    });

    useImperativeHandle(ref, () => ({
      focusSearch: () => searchInputRef.current?.focus(),
    }));

    const { visibleCategories, canonicalCategoryIdById } = useMemo(() => {
      const byName = new Map<string, Category>();
      const canonicalById = new Map<string, string>();

      for (const category of categories) {
        const key = normalizedCategoryKey(category.name);
        const existing = byName.get(key);
        const canonical = existing ?? category;

        if (!existing) {
          byName.set(key, category);
        }

        canonicalById.set(String(category._id), String(canonical._id));
      }

      return {
        visibleCategories: Array.from(byName.values()),
        canonicalCategoryIdById: canonicalById,
      };
    }, [categories]);

    const resolveCategoryId = useCallback((categoryId: unknown) => {
      if (!categoryId) {
        return null;
      }
      const id = String(categoryId);
      return canonicalCategoryIdById.get(id) ?? id;
    }, [canonicalCategoryIdById]);

    const activeCategoryId = selectedCategoryId
      ? resolveCategoryId(selectedCategoryId)
      : null;

    // Filter library items by category
    const filteredItems = useMemo(() => {
      let result = activeCategoryId
        ? libraryItems.filter(
            (s) => resolveCategoryId(s.categoryId) === activeCategoryId,
          )
        : libraryItems;

      if (!searchQuery.trim()) {
        result = [...result].sort((a, b) => {
          if (sortBy === "name") {
            return sortOrder === "asc"
              ? a.title.localeCompare(b.title)
              : b.title.localeCompare(a.title);
          }

          return sortOrder === "asc"
            ? a._creationTime - b._creationTime
            : b._creationTime - a._creationTime;
        });
      }

      return result;
    }, [
      activeCategoryId,
      libraryItems,
      resolveCategoryId,
      searchQuery,
      sortBy,
      sortOrder,
    ]);

    const hasActiveSearch = searchQuery.trim().length > 0;

    const handleSpeechToggle = () => {
      searchInputRef.current?.focus();

      if (isSpeechListening) {
        stopListening();
        return;
      }
      if (isSpeechStarting) {
        return;
      }

      onSearchChange("");
      void startListening();
    };

    const handleExportLibraries = async () => {
      if (
        !window.electronAPI?.selectLibraryExportDestination ||
        !window.electronAPI.exportLibraryBundle
      ) {
        toast.error("Library export is unavailable in this build.");
        return;
      }

      const destinationPath = await window.electronAPI.selectLibraryExportDestination(
        `present-library-export-${new Date().toISOString().slice(0, 10)}`,
      );
      if (!destinationPath) {
        return;
      }

      try {
        const categoryNameById = new Map(
          categories.map((category) => [
            String(category._id),
            visibleCategories.find(
              (visibleCategory) =>
                String(visibleCategory._id) === resolveCategoryId(category._id),
            )?.name ?? category.name,
          ]),
        );
        const result = await window.electronAPI.exportLibraryBundle(
          destinationPath,
          libraryItems.map((item) => ({
            title: item.title,
            body: item.body,
            categoryName: item.categoryId
              ? (categoryNameById.get(String(item.categoryId)) ?? null)
              : null,
            author: item.content?.presentation?.author ?? null,
            artist: item.content?.presentation?.artist ?? null,
            type: item.type ?? "song",
            content: item.content ?? null,
            slides: item.slides ?? [],
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          })),
        );
        toast.success(`Exported ${result.itemCount} libraries to ${result.path}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to export libraries");
      }
    };

    // Songs from OpenLP and other OpenLyrics exporters, into the library being
    // viewed (`services/openlyrics.rs`).
    const handleImportOpenLyrics = async () => {
      let files: ImportedSongFile[] | null;
      try {
        files = await invoke<ImportedSongFile[] | null>("import_openlyrics_songs");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not open the songs");
        return;
      }
      if (!files) {
        return;
      }
      const categoryId = selectedCategoryId ? resolveCategoryId(selectedCategoryId) : undefined;
      let imported = 0;
      const failed: string[] = [];
      for (const file of files) {
        if (!file.song) {
          failed.push(`${file.fileName}: ${file.error ?? "unreadable"}`);
          continue;
        }
        const credits = file.song.authors.join(", ");
        await onCreateLibraryItemFromDraft(
          {
            title: file.song.title,
            body: file.song.body,
            slides: [],
            content: {
              presentation: {
                author: credits,
                artist: "",
              },
            },
          } as LibraryItemDraft,
          categoryId ?? undefined,
        );
        imported += 1;
      }
      if (imported > 0) {
        toast.success(`Imported ${imported} ${imported === 1 ? "song" : "songs"}`);
      }
      if (failed.length > 0) {
        toast.error(`Could not import ${failed.length}: ${failed.slice(0, 3).join("; ")}`);
      }
    };

    const handleImportLibraries = async () => {
      if (!window.electronAPI?.selectFolder || !window.electronAPI.importLibraryBundle) {
        toast.error("Library import is unavailable in this build.");
        return;
      }

      const selectedFolder = await window.electronAPI.selectFolder();
      if (!selectedFolder) {
        return;
      }

      try {
        const imported = await window.electronAPI.importLibraryBundle(selectedFolder.path);
        const categoryIdByName = new Map(
          visibleCategories.map((category) => [
            normalizedCategoryKey(category.name),
            String(category._id),
          ]),
        );

        let importedCount = 0;
        for (const item of imported.items) {
          const title = item.title.trim();
          if (!title) {
            continue;
          }

          let categoryId: string | undefined;
          const categoryName = item.categoryName?.trim();
          if (categoryName) {
            const normalizedCategoryName = normalizedCategoryKey(categoryName);
            categoryId = categoryIdByName.get(normalizedCategoryName);
            if (!categoryId) {
              const created = await onCreateCategory(categoryName);
              if (typeof created === "string") {
                categoryId = created;
                categoryIdByName.set(normalizedCategoryName, created);
              }
            }
          }

          const importedContent = (
            item.content && typeof item.content === "object"
              ? item.content
              : {}
          ) as LibraryItemDraft["content"];
          const nextPresentation = {
            ...(importedContent?.presentation ?? {}),
            author:
              typeof item.author === "string"
                ? item.author
                : importedContent?.presentation?.author ?? "",
            artist:
              typeof item.artist === "string"
                ? item.artist
                : importedContent?.presentation?.artist ?? "",
          };

          await onCreateLibraryItemFromDraft(
            {
              title,
              body: item.body,
              slides: Array.isArray(item.slides) ? (item.slides as LibraryItemDraft["slides"]) : [],
              content: {
                ...importedContent,
                presentation: nextPresentation,
              },
            },
            categoryId,
          );
          importedCount += 1;
        }

        toast.success(`Imported ${importedCount} libraries from ${selectedFolder.name}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to import libraries");
      }
    };

    return (
      <>
        <ResizablePanelGroup direction="horizontal" className="flex h-full min-h-0 overflow-hidden bg-background">
        <ResizablePanel defaultSize={20} minSize={15} maxSize={30} className="flex shrink-0 flex-col border-r border-border/70 bg-card/40">
          <div className="border-b border-border/70 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Libraries
            </p>
            <button
              type="button"
              onClick={() => setShowNewCategoryDialog(true)}
              className="mt-3 flex w-full items-center justify-between rounded-xl border border-dashed border-border/80 px-3 py-2 text-[11px] font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
            >
              New library
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-auto p-2">
            <button
              type="button"
              onClick={() => onSelectCategory(null)}
              className={cn(
                "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition",
                !selectedCategoryId
                  ? "bg-primary/[0.10] font-medium text-foreground"
                  : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
              )}
            >
              {!selectedCategoryId && (
                <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
              )}
              <Library
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  !selectedCategoryId ? "text-primary" : "text-muted-foreground",
                )}
                strokeWidth={1.8}
              />
              <span className="min-w-0 flex-1 truncate">All Libraries</span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                  !selectedCategoryId
                    ? "bg-primary/15 text-primary"
                    : "bg-secondary text-muted-foreground",
                )}
              >
                {libraryItems.length}
              </span>
            </button>

            {visibleCategories.map((cat) => {
              const categoryId = String(cat._id);
              const count = libraryItems.filter(
                (item) => resolveCategoryId(item.categoryId) === categoryId,
              ).length;
              const isActive = activeCategoryId === categoryId;
              return (
                <button
                  key={categoryId}
                  type="button"
                  onClick={() => onSelectCategory(categoryId)}
                  className={cn(
                    "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition",
                    isActive
                      ? "bg-primary/[0.10] font-medium text-foreground"
                      : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{cat.name}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                        isActive
                          ? "bg-primary/15 text-primary"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={80} className="flex min-w-0 flex-col">
          <div className="border-b border-border/70 bg-card/30 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-[240px] flex-1">
                <div className="flex max-w-xl items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(e) => onSearchChange(e.target.value)}
                      placeholder={
                        searchMode === "exact"
                          ? "Search exact phrase..."
                          : "Search title or lyrics..."
                      }
                      className="h-10 w-full rounded-xl border-border/80 bg-background/90 pl-9 pr-3 text-xs shadow-sm"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onSearchModeChange(
                        searchMode === "exact" ? "broad" : "exact",
                      )
                    }
                    aria-pressed={searchMode === "exact"}
                    title={
                      searchMode === "exact"
                        ? "Exact match: finds the whole phrase as typed. Click for broad match."
                        : "Broad match: finds items containing each word. Click for exact match."
                    }
                    className={cn(
                      "h-10 shrink-0 rounded-xl border px-3 text-xs font-medium transition-colors",
                      searchMode === "exact"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-muted-foreground hover:bg-secondary",
                    )}
                  >
                    Exact
                  </button>

                  <button
                    type="button"
                    onClick={handleSpeechToggle}
                    disabled={!isSpeechSupported || isSpeechStarting}
                    aria-busy={isSpeechStarting}
                    className={cn(
                      "relative h-10 w-10 shrink-0 rounded-xl border transition-colors",
                      isSpeechListening
                        ? "border-red-600 bg-red-500 text-white"
                        : isSpeechStarting
                          ? "border-amber-500 bg-amber-500/10 text-amber-600"
                        : "border-input bg-background text-muted-foreground hover:bg-secondary",
                      (!isSpeechSupported || isSpeechStarting) && "cursor-not-allowed opacity-40",
                    )}
                    title={
                      isSpeechListening
                        ? "Stop listening"
                        : isSpeechStarting
                          ? "Starting microphone"
                        : "Speak to search libraries"
                    }
                  >
                    {isSpeechListening ? (
                      <Mic className="mx-auto h-4 w-4 animate-pulse" />
                    ) : isSpeechStarting ? (
                      <>
                        <span className="absolute right-1 top-1 flex h-2.5 w-2.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
                        </span>
                        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                      </>
                    ) : (
                      <MicOff className="mx-auto h-4 w-4" />
                    )}
                  </button>
                </div>

                {speechError ? (
                  <p className="mt-2 text-[10px] text-destructive">
                    {speechError}
                  </p>
                ) : isSpeechStarting ? (
                  <p className="mt-2 flex items-center gap-2 text-[10px] text-amber-600">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                    </span>
                    Starting microphone...
                  </p>
                ) : isSpeechListening ? (
                  <p className="mt-2 text-[10px] text-primary">
                    Listening for song title or lyrics...
                  </p>
                ) : !isSpeechSupported ? (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Voice search is unavailable in this runtime.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowComposeDialog(true)}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#ff6f59]/30 bg-[#ff6f59]/12 px-3 text-xs font-semibold text-[#ff6f59] shadow-sm transition hover:bg-[#ff6f59]/18"
                  title="Create a flow by picking songs and slides"
                >
                  <Layers3 className="h-4 w-4" />
                  Create flow
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void handleExportLibraries();
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-input bg-background text-muted-foreground shadow-sm transition hover:bg-secondary"
                  title="Export libraries"
                >
                  <ArrowUpFromLine className="h-4 w-4" />
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-xl border border-input bg-background text-muted-foreground shadow-sm transition hover:bg-secondary"
                      title="Import"
                    >
                      <ArrowDownToLine className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void handleImportLibraries()}>
                      Present library export…
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void handleImportOpenLyrics()}>
                      OpenLyrics songs (.xml)…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-xl border border-input bg-background text-muted-foreground shadow-sm transition hover:bg-secondary"
                    >
                      <ArrowUpDown className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={() => setSortBy("recent")}>
                      <Check
                        className={cn(
                          "mr-2 h-3 w-3",
                          sortBy === "recent" ? "opacity-100" : "opacity-0",
                        )}
                      />
                      Recent
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSortBy("name")}>
                      <Check
                        className={cn(
                          "mr-2 h-3 w-3",
                          sortBy === "name" ? "opacity-100" : "opacity-0",
                        )}
                      />
                      Name
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setSortOrder("asc")}>
                      <ArrowUp
                        className={cn(
                          "mr-2 h-3 w-3",
                          sortOrder === "asc" ? "opacity-100" : "opacity-0",
                        )}
                      />
                      Ascending
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSortOrder("desc")}>
                      <ArrowDown
                        className={cn(
                          "mr-2 h-3 w-3",
                          sortOrder === "desc" ? "opacity-100" : "opacity-0",
                        )}
                      />
                      Descending
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="flex h-10 items-center rounded-xl border border-input bg-background p-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setLayoutMode("list")}
                    className={cn(
                      "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition",
                      layoutMode === "list" && "bg-primary/10 text-primary",
                    )}
                    title="List view"
                  >
                    <List className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLayoutMode("grid")}
                    className={cn(
                      "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition",
                      layoutMode === "grid" && "bg-primary/10 text-primary",
                    )}
                    title="Grid view"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            {isLoading ? (
              <ShowsGridSkeleton />
            ) : contentSource === "community" ? (
              <div className="flex h-full flex-col items-center justify-center space-y-2 text-center">
                <div className="rounded-full bg-primary/10 p-4">
                  <Search className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">Community Content</h3>
                <p className="max-w-[250px] text-sm text-muted-foreground">
                  The community library is growing! Public shows and templates will appear here soon.
                </p>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="max-w-sm rounded-2xl border border-dashed border-border/80 bg-card/40 px-6 py-8 text-center shadow-sm">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <Search className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-foreground">
                    {hasActiveSearch ? "No matching items" : "Library is ready for content"}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {hasActiveSearch
                      ? "Try another lyric fragment or title phrase to refine the search."
                      : "Create a new library item or import an existing catalog to start building your service flow."}
                  </p>
                  {!hasActiveSearch ? (
                    <button
                      type="button"
                      onClick={() => { void onNewLibraryItem(); }}
                      className="mt-4 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
                    >
                      New library item
                    </button>
                  ) : null}
                </div>
              </div>
            ) : layoutMode === "grid" ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                <NewLibraryItemButton onClick={() => { void onNewLibraryItem(); }} />
                {filteredItems.map((item) => (
                  <LibraryItemCard
                    key={item._id}
                    item={item}
                    isSelected={selectedLibraryId === item._id}
                    showAddToService={isInsideService && !!selectedServiceId}
                    onSelect={() => onSelectLibraryItem(item._id)}
                    onRename={() =>
                      setRenameTarget({
                        id: item._id,
                        title: item.title,
                        categoryId: resolveCategoryId(item.categoryId) ?? undefined,
                      })
                    }
                    onOpenMiniEditor={() => onOpenMiniEditor(String(item._id))}
                    onEditFlow={
                      item.content?.composition
                        ? () => {
                            setComposeEditTarget(item);
                            setShowComposeDialog(true);
                          }
                        : undefined
                    }
                    onDelete={() =>
                      setDeleteTarget({ id: item._id, title: item.title })
                    }
                    onAddToService={() => onAddToService(item._id)}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-1.5">
                <NewLibraryItemRowButton onClick={() => { void onNewLibraryItem(); }} />
                {filteredItems.map((item) => (
                  <LibraryItemRow
                    key={item._id}
                    item={item}
                    isSelected={selectedLibraryId === item._id}
                    showAddToService={isInsideService && !!selectedServiceId}
                    onSelect={() => onSelectLibraryItem(item._id)}
                    onRename={() =>
                      setRenameTarget({
                        id: item._id,
                        title: item.title,
                        categoryId: resolveCategoryId(item.categoryId) ?? undefined,
                      })
                    }
                    onOpenMiniEditor={() => onOpenMiniEditor(String(item._id))}
                    onEditFlow={
                      item.content?.composition
                        ? () => {
                            setComposeEditTarget(item);
                            setShowComposeDialog(true);
                          }
                        : undefined
                    }
                    onDelete={() =>
                      setDeleteTarget({ id: item._id, title: item.title })
                    }
                    onAddToService={() => onAddToService(item._id)}
                  />
                ))}
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Dialogs */}
        {showNewCategoryDialog && (
          <NewCategoryDialog
            onClose={() => setShowNewCategoryDialog(false)}
            onCreate={onCreateCategory}
          />
        )}

        {showComposeDialog && (
          <ComposeLibrariesDialog
            libraryItems={libraryItems}
            composeLibraryItems={composeLibraryItems}
            categories={visibleCategories}
            categoryId={activeCategoryId}
            editItem={composeEditTarget}
            onClose={() => {
              setShowComposeDialog(false);
              setComposeEditTarget(null);
            }}
            onCreate={async (title, itemIds, categoryId, slideSelections) => {
              await onCreateComposedLibraryItem(
                title,
                itemIds,
                categoryId,
                slideSelections,
              );
              setShowComposeDialog(false);
              setComposeEditTarget(null);
            }}
            onUpdate={async (itemId, title, itemIds, categoryId, slideSelections) => {
              await onUpdateComposedLibraryItem(
                itemId,
                title,
                itemIds,
                categoryId,
                slideSelections,
              );
              setShowComposeDialog(false);
              setComposeEditTarget(null);
            }}
          />
        )}

        {renameTarget && (
          <EditLibraryItemDialog
            title={renameTarget.title}
            categoryId={renameTarget.categoryId}
            categories={visibleCategories}
            onClose={() => setRenameTarget(null)}
            onSave={(newTitle, categoryId) => {
              void onRenameLibraryItem(renameTarget.id, newTitle, categoryId);
              setRenameTarget(null);
            }}
          />
        )}

        {deleteTarget && (
          <DeleteLibraryItemDialog
            title={deleteTarget.title}
            onClose={() => setDeleteTarget(null)}
            onDelete={async () => {
              await onDeleteLibraryItem(deleteTarget.id);
              setDeleteTarget(null);
            }}
          />
        )}
      </>
    );
  }),
);

// Sub-components

// Visual identity for a library item based on its type / composition.
// Returns a leading icon and a colour tint so each row/card reads at a glance.
function getItemVisual(item: LibraryItem): {
  Icon: typeof Music2;
  tint: string;
  label: string;
} {
  const isFlow = Boolean(item.content?.composition);
  if (isFlow) {
    return {
      Icon: Layers3,
      tint: "bg-[#ff6f59]/15 text-[#ff6f59]",
      label: "Flow",
    };
  }
  switch (item.type) {
    case "scripture":
      return {
        Icon: BookOpenText,
        tint: "bg-amber-500/15 text-amber-400",
        label: "Scripture",
      };
    case "slide":
    case "note":
      return {
        Icon: FileText,
        tint: "bg-violet-500/15 text-violet-400",
        label: item.type === "note" ? "Note" : "Slides",
      };
    case "song":
    default:
      return {
        Icon: Music2,
        tint: "bg-sky-500/15 text-sky-400",
        label: "Song",
      };
  }
}

interface LibraryItemCardProps {
  item: LibraryItem;
  isSelected: boolean;
  showAddToService: boolean;
  onSelect: () => void;
  onRename: () => void;
  onOpenMiniEditor: () => void;
  onEditFlow?: () => void;
  onDelete: () => void;
  onAddToService: () => void;
}

const LibraryItemCard = memo(function LibraryItemCard({
  item,
  isSelected,
  showAddToService,
  onSelect,
  onRename,
  onOpenMiniEditor,
  onEditFlow,
  onDelete,
  onAddToService,
}: LibraryItemCardProps) {
  const { Icon, tint, label } = getItemVisual(item);
  return (
    <div
      className={cn(
        "group relative flex flex-col gap-2.5 rounded-xl border p-3 text-left transition-all duration-150",
        isSelected
          ? "border-primary/60 bg-primary/[0.07] ring-1 ring-primary/40"
          : "border-border/60 bg-card/40 hover:border-primary/40 hover:bg-card hover:shadow-md hover:shadow-black/20",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-col gap-2.5 text-left"
      >
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            tint,
          )}
        >
          <Icon className="h-4.5 w-4.5" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-foreground">
            {item.title || "Untitled"}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{label}</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{item.slides.length} slides</span>
          </p>
        </div>
      </button>

      <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          aria-label="Open mini editor"
          title="Open mini editor"
          onClick={(event) => {
            event.stopPropagation();
            onOpenMiniEditor();
          }}
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <NotebookPen className="h-3 w-3" />
        </button>
        {onEditFlow ? (
          <button
            type="button"
            aria-label="Edit flow"
            title="Edit flow"
            onClick={(event) => {
              event.stopPropagation();
              onEditFlow();
            }}
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <Layers3 className="h-3 w-3" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Rename library item"
          onClick={onRename}
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label="Delete library item"
          onClick={onDelete}
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/15 hover:text-destructive"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {showAddToService && (
        <button
          type="button"
          onClick={onAddToService}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-border/70 py-1.5 text-[10px] font-medium text-muted-foreground transition hover:border-primary/50 hover:text-primary"
        >
          <Plus className="h-3 w-3" />
          Add to service
        </button>
      )}
    </div>
  );
});

function NewLibraryItemButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/60 transition group-hover:bg-primary/10">
        <Plus className="h-4 w-4" strokeWidth={2} />
      </span>
      New library item
    </button>
  );
}

function NewLibraryItemRowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border/70 px-2.5 py-2 text-[12px] font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary/60">
        <Plus className="h-4 w-4" strokeWidth={2} />
      </span>
      New library item
    </button>
  );
}

const LibraryItemRow = memo(function LibraryItemRow({
  item,
  isSelected,
  showAddToService,
  onSelect,
  onRename,
  onOpenMiniEditor,
  onEditFlow,
  onDelete,
  onAddToService,
}: LibraryItemCardProps) {
  const { Icon, tint, label } = getItemVisual(item);
  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-all duration-150",
        isSelected
          ? "border-primary/60 bg-primary/[0.07] ring-1 ring-primary/40"
          : "border-border/60 bg-card/40 hover:border-primary/40 hover:bg-card",
      )}
    >
      {/* Selected accent bar */}
      {isSelected && (
        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
      )}
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          tint,
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <p className="truncate text-[13px] font-semibold text-foreground">
          {item.title || "Untitled"}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{label}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{item.slides.length} slides</span>
        </p>
      </button>
      {showAddToService ? (
        <button
          type="button"
          onClick={onAddToService}
          className="shrink-0 rounded-lg border border-border/70 px-2 py-1 text-[10px] font-medium text-muted-foreground transition hover:border-primary/50 hover:text-primary"
        >
          Add to service
        </button>
      ) : null}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          aria-label="Open mini editor"
          title="Open mini editor"
          onClick={onOpenMiniEditor}
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <NotebookPen className="h-3.5 w-3.5" />
        </button>
        {onEditFlow ? (
          <button
            type="button"
            aria-label="Edit flow"
            title="Edit flow"
            onClick={onEditFlow}
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <Layers3 className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Rename library item"
          onClick={onRename}
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Delete library item"
          onClick={onDelete}
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/15 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
});

// Dialog components
/**
 * Create-flow wizard.
 *
 * Step 1: search the org's library and add songs one by one with the + icon.
 *         Songs appear in the order they were added (and that order is
 *         honoured by the backend now — see createComposedItem).
 *
 * Step 2: drag-reorder the added songs, and pick which slides of each song
 *         to include. Each card can expand to show its slides; an
 *         "all slides" toggle covers the common case.
 */
function ComposeLibrariesDialog({
  libraryItems,
  composeLibraryItems,
  categories,
  categoryId,
  editItem,
  onClose,
  onCreate,
  onUpdate,
}: {
  libraryItems: LibraryItem[];
  composeLibraryItems: LibraryItem[];
  categories: Category[];
  categoryId: string | null;
  editItem?: LibraryItem | null;
  onClose: () => void;
  onCreate: (
    title: string,
    itemIds: string[],
    categoryId?: string,
    slideSelections?: Record<string, number[]>,
  ) => Promise<unknown>;
  onUpdate: (
    itemId: string,
    title: string,
    itemIds: string[],
    categoryId?: string,
    slideSelections?: Record<string, number[]>,
  ) => Promise<unknown>;
}) {
  type Step = "pick" | "arrange";

  type SongSelection = {
    libraryId: string;
    slideIndexes: number[];
  };

  const itemsById = useMemo(
    () => new Map(composeLibraryItems.map((item) => [String(item._id), item])),
    [composeLibraryItems],
  );
  const initialPicked = useMemo<SongSelection[]>(
    () => {
      const editableSources = editItem?.content?.composition?.sourceItems ?? [];
      return editableSources
        .map((source) => {
          const item = itemsById.get(String(source.libraryId));
          if (!item) return null;
          const slideIndexes =
            Array.isArray(source.slideIndexes) && source.slideIndexes.length > 0
              ? source.slideIndexes.filter(
                  (index) => index >= 0 && index < item.slides.length,
                )
              : item.slides.map((_, index) => index);
          return {
            libraryId: String(source.libraryId),
            slideIndexes,
          };
        })
        .filter((entry): entry is SongSelection => entry !== null);
    },
    [editItem, itemsById],
  );

  const [step, setStep] = useState<Step>(editItem ? "arrange" : "pick");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<SongSelection[]>(initialPicked);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [title, setTitle] = useState(editItem?.title ?? "");
  const [hasManualTitle, setHasManualTitle] = useState(Boolean(editItem));
  const [targetCategoryId, setTargetCategoryId] = useState<string>(
    String(editItem?.categoryId ?? categoryId ?? categories[0]?._id ?? ""),
  );
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickedIds = useMemo(
    () => new Set(picked.map((p) => p.libraryId)),
    [picked],
  );

  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    const available = composeLibraryItems.filter(
      (item) => !pickedIds.has(String(item._id)),
    );
    if (!query) return available;
    return available.filter((item) =>
      item.title.toLowerCase().includes(query),
    );
  }, [composeLibraryItems, pickedIds, search]);

  // Keep the title in sync with the picked songs until the user types
  // something themselves — then leave it alone.
  const derivedTitle = useMemo(() => {
    const names = picked
      .map((p) => itemsById.get(p.libraryId)?.title)
      .filter((name): name is string => Boolean(name));
    return names.slice(0, 3).join(" / ");
  }, [itemsById, picked]);
  if (!hasManualTitle && title !== derivedTitle) {
    setTimeout(() => setTitle(derivedTitle), 0);
  }

  const addSong = (libraryId: string) => {
    const item = itemsById.get(libraryId);
    if (!item) return;
    setPicked((current) => [
      ...current,
      {
        libraryId,
        slideIndexes: item.slides.map((_, index) => index),
      },
    ]);
  };

  const removeSong = (libraryId: string) => {
    setPicked((current) => current.filter((p) => p.libraryId !== libraryId));
    if (expandedId === libraryId) setExpandedId(null);
  };

  const moveSong = (fromIndex: number, toIndex: number) => {
    setPicked((current) => {
      if (toIndex < 0 || toIndex >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const setSongSlides = (libraryId: string, slideIndexes: number[]) => {
    setPicked((current) =>
      current.map((p) =>
        p.libraryId === libraryId ? { ...p, slideIndexes } : p,
      ),
    );
  };

  const toggleSongSlide = (libraryId: string, slideIndex: number) => {
    setPicked((current) =>
      current.map((p) => {
        if (p.libraryId !== libraryId) return p;
        const isSelected = p.slideIndexes.includes(slideIndex);
        const next = isSelected
          ? p.slideIndexes.filter((index) => index !== slideIndex)
          : [...p.slideIndexes, slideIndex].sort((a, b) => a - b);
        return { ...p, slideIndexes: next };
      }),
    );
  };

  const totalSlides = picked.reduce(
    (sum, p) => sum + p.slideIndexes.length,
    0,
  );

  const handleSave = async () => {
    if (picked.length < 1) {
      setError("Add at least one song");
      return;
    }
    if (totalSlides < 1) {
      setError("Select at least one slide");
      return;
    }
    if (!title.trim()) {
      setError("Flow title is required");
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      const slideSelections: Record<string, number[]> = {};
      for (const p of picked) {
        slideSelections[p.libraryId] = p.slideIndexes;
      }
      if (editItem) {
        await onUpdate(
          String(editItem._id),
          title.trim(),
          picked.map((p) => p.libraryId),
          targetCategoryId || undefined,
          slideSelections,
        );
      } else {
        await onCreate(
          title.trim(),
          picked.map((p) => p.libraryId),
          targetCategoryId || undefined,
          slideSelections,
        );
      }
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : editItem
            ? "Failed to update flow"
            : "Failed to create flow",
      );
      setIsCreating(false);
      return;
    }
    setIsCreating(false);
  };

  return (
    <Dialog
      title={
        step === "pick"
          ? editItem
            ? "Edit flow — pick songs"
            : "Create flow — pick songs"
          : editItem
            ? "Edit flow — arrange slides"
            : "Create flow — arrange slides"
      }
      onClose={onClose}
    >
      {step === "pick" ? (
        <PickStep
          search={search}
          onSearchChange={setSearch}
          results={searchResults}
          picked={picked}
          itemsById={itemsById}
          totalCount={composeLibraryItems.length}
          onAdd={addSong}
          onRemove={removeSong}
          onMove={moveSong}
          onNext={() => {
            if (picked.length === 0) {
              setError("Add at least one song first");
              return;
            }
            setError(null);
            setStep("arrange");
          }}
          onCancel={onClose}
          error={error}
        />
      ) : (
        <ArrangeStep
          picked={picked}
          itemsById={itemsById}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          draggingId={draggingId}
          setDraggingId={setDraggingId}
          onMove={moveSong}
          onSetSlides={setSongSlides}
          onToggleSlide={toggleSongSlide}
          onRemove={removeSong}
          title={title}
          onTitleChange={(value) => {
            setHasManualTitle(true);
            setTitle(value);
          }}
          targetCategoryId={targetCategoryId}
          setTargetCategoryId={setTargetCategoryId}
          categories={categories}
          onBack={() => setStep("pick")}
          onCreate={handleSave}
          isCreating={isCreating}
          isEditing={Boolean(editItem)}
          error={error}
          totalSlides={totalSlides}
        />
      )}
    </Dialog>
  );
}

/** Step 1: search + add songs, with a running list of picks below. */
function PickStep({
  search,
  onSearchChange,
  results,
  picked,
  itemsById,
  totalCount,
  onAdd,
  onRemove,
  onMove,
  onNext,
  onCancel,
  error,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  results: LibraryItem[];
  picked: { libraryId: string; slideIndexes: number[] }[];
  itemsById: Map<string, LibraryItem>;
  totalCount: number;
  onAdd: (libraryId: string) => void;
  onRemove: (libraryId: string) => void;
  onMove: (from: number, to: number) => void;
  onNext: () => void;
  onCancel: () => void;
  error: string | null;
}) {
  return (
    <div className="flex max-h-[70vh] flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search your library…"
          className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          autoFocus
        />
      </div>

      <div className="max-h-56 min-h-[80px] overflow-y-auto rounded-md border border-border/70 bg-card/40">
        {results.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            {search.trim()
              ? "No matches."
              : picked.length >= totalCount
                ? "Every song is already in the flow."
                : "Start typing to find songs."}
          </p>
        ) : (
          results.slice(0, 50).map((item) => (
            <button
              key={item._id}
              type="button"
              onClick={() => onAdd(String(item._id))}
              className="group flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left last:border-b-0 hover:bg-foreground/5"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                <Plus className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {item.title}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {item.slides.length} slides
              </span>
            </button>
          ))
        )}
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          In this flow ({picked.length})
        </p>
        {picked.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
            No songs yet — search and tap + to add.
          </p>
        ) : (
          <ul className="space-y-1">
            {picked.map((entry, index) => {
              const item = itemsById.get(entry.libraryId);
              if (!item) return null;
              return (
                <li
                  key={entry.libraryId}
                  className="flex items-center gap-2 rounded-md border border-border/70 bg-background/70 px-2 py-1.5 text-xs"
                >
                  <span className="w-5 text-center text-muted-foreground">
                    {index + 1}.
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {item.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => onMove(index, index - 1)}
                    disabled={index === 0}
                    className="rounded-sm p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(index, index + 1)}
                    disabled={index === picked.length - 1}
                    className="rounded-sm p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(entry.libraryId)}
                    className="rounded-sm p-1 text-muted-foreground transition hover:text-destructive"
                    aria-label="Remove from flow"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="mt-1 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-input px-4 py-2 text-xs font-medium text-foreground hover:bg-secondary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={picked.length === 0}
          className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** Step 2: drag-reorder + per-song slide selection + title/category. */
function ArrangeStep({
  picked,
  itemsById,
  expandedId,
  setExpandedId,
  draggingId,
  setDraggingId,
  onMove,
  onSetSlides,
  onToggleSlide,
  onRemove,
  title,
  onTitleChange,
  targetCategoryId,
  setTargetCategoryId,
  categories,
  onBack,
  onCreate,
  isCreating,
  isEditing,
  error,
  totalSlides,
}: {
  picked: { libraryId: string; slideIndexes: number[] }[];
  itemsById: Map<string, LibraryItem>;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  onMove: (from: number, to: number) => void;
  onSetSlides: (libraryId: string, slideIndexes: number[]) => void;
  onToggleSlide: (libraryId: string, slideIndex: number) => void;
  onRemove: (libraryId: string) => void;
  title: string;
  onTitleChange: (value: string) => void;
  targetCategoryId: string;
  setTargetCategoryId: (id: string) => void;
  categories: Category[];
  onBack: () => void;
  onCreate: () => void;
  isCreating: boolean;
  isEditing: boolean;
  error: string | null;
  totalSlides: number;
}) {
  const titleInputId = useId();
  const categoryInputId = useId();

  return (
    <div className="flex max-h-[78vh] flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1.4fr_1fr]">
        <div className="space-y-1">
          <label
            htmlFor={titleInputId}
            className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            Flow title
          </label>
          <input
            id={titleInputId}
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
            placeholder="Praise flow"
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor={categoryInputId}
            className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            Save to library
          </label>
          <Select value={targetCategoryId} onValueChange={setTargetCategoryId}>
            <SelectTrigger
              id={categoryInputId}
              className="h-9 w-full border border-input bg-background px-3 text-sm text-foreground focus-visible:border-primary focus-visible:ring-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat._id} value={String(cat._id)}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {picked.map((entry, index) => {
          const item = itemsById.get(entry.libraryId);
          if (!item) return null;
          const isExpanded = expandedId === entry.libraryId;
          const isDragging = draggingId === entry.libraryId;
          return (
            <div
              key={entry.libraryId}
              draggable
              onDragStart={() => setDraggingId(entry.libraryId)}
              onDragEnd={() => setDraggingId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (!draggingId || draggingId === entry.libraryId) return;
                const fromIndex = picked.findIndex(
                  (p) => p.libraryId === draggingId,
                );
                if (fromIndex < 0) return;
                onMove(fromIndex, index);
                setDraggingId(null);
              }}
              className={cn(
                "rounded-md border bg-background/70 transition",
                isDragging
                  ? "border-primary/60 opacity-60"
                  : "border-border/70 hover:border-primary/30",
              )}
            >
              <div className="flex items-center gap-2 px-2 py-2">
                <span
                  className="cursor-grab text-muted-foreground active:cursor-grabbing"
                  title="Drag to reorder"
                >
                  <GripVertical className="h-4 w-4" />
                </span>
                <span className="w-5 text-center text-xs text-muted-foreground">
                  {index + 1}.
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : entry.libraryId)
                  }
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {entry.slideIndexes.length} / {item.slides.length} slides
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : entry.libraryId)
                  }
                  className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                >
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(entry.libraryId)}
                  className="rounded-sm p-1 text-muted-foreground hover:text-destructive"
                  aria-label="Remove from flow"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {isExpanded && (
                <SlidePicker
                  item={item}
                  selection={entry.slideIndexes}
                  onSelectAll={() =>
                    onSetSlides(
                      entry.libraryId,
                      item.slides.map((_, slideIndex) => slideIndex),
                    )
                  }
                  onSelectNone={() => onSetSlides(entry.libraryId, [])}
                  onToggle={(slideIndex) =>
                    onToggleSlide(entry.libraryId, slideIndex)
                  }
                />
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {totalSlides} slide{totalSlides === 1 ? "" : "s"} across {picked.length}{" "}
        song{picked.length === 1 ? "" : "s"}.
      </p>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-input px-4 py-2 text-xs font-medium text-foreground hover:bg-secondary"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onCreate}
          disabled={isCreating}
          className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isCreating
            ? isEditing
              ? "Saving..."
              : "Creating..."
            : isEditing
              ? "Save flow"
              : "Create flow"}
        </button>
      </div>
    </div>
  );
}

function SlidePicker({
  item,
  selection,
  onSelectAll,
  onSelectNone,
  onToggle,
}: {
  item: LibraryItem;
  selection: number[];
  onSelectAll: () => void;
  onSelectNone: () => void;
  onToggle: (slideIndex: number) => void;
}) {
  const allSelected = selection.length === item.slides.length;
  const selectionSet = useMemo(() => new Set(selection), [selection]);

  return (
    <div className="space-y-2 border-t border-border/60 bg-card/40 px-3 py-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={allSelected ? onSelectNone : onSelectAll}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border/70 bg-background px-2 py-1 text-[10px] font-medium text-foreground hover:bg-foreground/5"
        >
          <span
            className={cn(
              "flex h-3.5 w-3.5 items-center justify-center rounded border",
              allSelected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background",
            )}
          >
            {allSelected ? <Check className="h-2.5 w-2.5" /> : null}
          </span>
          Select all slides
        </button>
        <span className="text-[10px] text-muted-foreground">
          {selection.length} selected
        </span>
      </div>
      <ul className="space-y-1">
        {item.slides.map((slide, slideIndex) => {
          const checked = selectionSet.has(slideIndex);
          const previewText =
            slide.text?.split("\n").slice(0, 2).join(" / ").slice(0, 100) ||
            (slide.label ?? `Slide ${slideIndex + 1}`);
          return (
            <li key={slide.id ?? slideIndex}>
              <button
                type="button"
                onClick={() => onToggle(slideIndex)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-sm border px-2 py-1.5 text-left text-[11px] transition",
                  checked
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/60 bg-background/60 text-muted-foreground hover:border-foreground/40",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                    checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background",
                  )}
                >
                  {checked ? <Check className="h-2.5 w-2.5" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] uppercase tracking-wider text-muted-foreground/80">
                    {slide.label ?? `Slide ${slideIndex + 1}`}
                  </span>
                  <span className="block truncate text-foreground">
                    {previewText}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NewCategoryDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) return;
    await onCreate(name.trim());
    onClose();
  };

  return (
    <Dialog title="New library" onClose={onClose}>
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Library name"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-input py-2 text-xs font-medium text-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            className="flex-1 rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Create
          </button>
        </div>
      </div>
    </Dialog>
  );
}

const ALL_CATEGORY_VALUE = "__all__";

function EditLibraryItemDialog({
  title,
  categoryId,
  categories,
  onClose,
  onSave,
}: {
  title: string;
  categoryId?: string;
  categories: Category[];
  onClose: () => void;
  onSave: (newTitle: string, categoryId?: string) => void;
}) {
  const [newTitle, setNewTitle] = useState(title);
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    categoryId ?? ALL_CATEGORY_VALUE,
  );
  const titleInputId = "edit-library-item-title";
  const categoryInputId = "edit-library-item-category";
  const handleSave = () => {
    onSave(
      newTitle,
      selectedCategoryId === ALL_CATEGORY_VALUE
        ? undefined
        : selectedCategoryId,
    );
  };

  return (
    <Dialog title="Edit library item" onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label
            htmlFor={titleInputId}
            className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            Name
          </label>
          <input
            id={titleInputId}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor={categoryInputId}
            className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            Category
          </label>
          <Select
            value={selectedCategoryId}
            onValueChange={setSelectedCategoryId}
          >
            <SelectTrigger id={categoryInputId} className="h-9 w-full">
              <SelectValue placeholder="Choose category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORY_VALUE}>
                All
              </SelectItem>
              {categories.map((cat) => (
                <SelectItem key={String(cat._id)} value={String(cat._id)}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-input py-2 text-xs font-medium text-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Save
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function DeleteLibraryItemDialog({
  title,
  onClose,
  onDelete,
}: {
  title: string;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);

    try {
      await onDelete();
    } catch (error) {
      console.error("Failed to delete library item:", error);
    }

    setIsDeleting(false);
  };

  return (
    <Dialog title="Delete library item" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete "{title}"?
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="flex-1 rounded-md border border-input py-2 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="flex-1 rounded-md bg-destructive py-2 text-xs font-semibold text-white hover:bg-destructive/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isDeleting && <Spinner className="size-3" />}
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}


// Icons
// Skeleton loading component
function ShowsGridSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-card/40 p-3"
        >
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
