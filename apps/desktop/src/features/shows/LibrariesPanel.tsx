"use client";

import {
  memo,
  useState,
  forwardRef,
  useImperativeHandle,
  useRef,
  useMemo,
  type ChangeEvent,
} from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { LibraryItem, Category, ContentSource } from "../../shared/types";
import { Dialog } from "../../renderer/shared/components/Dialog";
import { Input } from "../../renderer/shared/components/ui/input";
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
  Layers3,
  ArrowUp,
  ArrowDown,
  Download,
  Upload,
  LayoutGrid,
  List,
  Loader2,
  Mic,
  MicOff,
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

interface LibrariesPanelProps {
  libraryItems: LibraryItem[];
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
  onCreateComposedLibraryItem: (
    title: string,
    itemIds: string[],
    categoryId?: string,
  ) => Promise<unknown>;
  onRenameLibraryItem: (id: string, title: string) => Promise<void>;
  onDeleteLibraryItem: (id: string) => Promise<void>;
  onAddToService: (libraryId: string) => void;
  onCreateCategory: (name: string) => Promise<unknown>;
  onFixLyrics: (lyrics: string) => Promise<string>;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  contentSource: ContentSource;
}

export interface LibrariesPanelRef {
  focusSearch: () => void;
}

export const LibrariesPanel = memo(
  forwardRef<LibrariesPanelRef, LibrariesPanelProps>(function LibrariesPanel(
    {
      libraryItems,
      categories,
      selectedLibraryId,
      selectedCategoryId,
      isInsideService,
      selectedServiceId,
      isLoading = false,
      onSelectLibraryItem,
      onSelectCategory,
      onCreateLibraryItem,
      onCreateComposedLibraryItem,
      onRenameLibraryItem,
      onDeleteLibraryItem,
      onAddToService,
      onCreateCategory,
      onFixLyrics,
      searchQuery,
      onSearchChange,
      contentSource,
    }: LibrariesPanelProps,
    ref,
  ) {
    const [showNewLibraryItemDialog, setShowNewLibraryItemDialog] = useState(false);
    const [showNewCategoryDialog, setShowNewCategoryDialog] = useState(false);
    const [showComposeDialog, setShowComposeDialog] = useState(false);
    const [renameTarget, setRenameTarget] = useState<{
      id: string;
      title: string;
    } | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{
      id: string;
      title: string;
    } | null>(null);

    const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [layoutMode, setLayoutMode] = useState<"grid" | "list">("list");
    const [selectedComposeIds, setSelectedComposeIds] = useState<string[]>([]);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
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
      lang: "en-US",
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

    // Filter library items by category
    const filteredItems = useMemo(() => {
      let result = selectedCategoryId
        ? libraryItems.filter((s) => s.categoryId === selectedCategoryId)
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
    }, [libraryItems, searchQuery, selectedCategoryId, sortBy, sortOrder]);

    const hasActiveSearch = searchQuery.trim().length > 0;
    const composeSelectionCount = selectedComposeIds.length;

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

    const handleExportLibraries = () => {
      const payload = {
        exportedAt: new Date().toISOString(),
        version: 1,
        items: libraryItems.map((item) => ({
          title: item.title,
          body: item.body,
          categoryId: item.categoryId ?? null,
        })),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const fileName = `present-libraries-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    };

    const toggleComposeSelection = (itemId: string) => {
      setSelectedComposeIds((previous) =>
        previous.includes(itemId)
          ? previous.filter((currentId) => currentId !== itemId)
          : [...previous, itemId],
      );
    };

    const handleImportLibraries = async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const file = input.files?.[0];
      if (!file) {
        return;
      }

      let items: Array<{
        title?: string;
        body?: string;
        lyrics?: string;
        categoryId?: Id<"categories"> | null;
      }> = [];
      let parsedItems: unknown;

      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as {
          items?: Array<{
            title?: string;
            body?: string;
            lyrics?: string; // fallback
            categoryId?: Id<"categories"> | null;
          }>;
        };
        parsedItems = parsed.items;
      } catch (error) {
        console.error("Failed to import libraries:", error);
        input.value = "";
        return;
      }

      if (Array.isArray(parsedItems)) {
        items = parsedItems;
      }

      for (const item of items) {
        const title = typeof item.title === "string" ? item.title.trim() : "";
        const body = typeof item.body === "string"
          ? item.body
          : (typeof item.lyrics === "string" ? item.lyrics : "");
        if (!title) {
          continue;
        }
        await onCreateLibraryItem(title, body, item.categoryId ?? undefined);
      }

      input.value = "";
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
              className="mt-3 flex w-full items-center justify-between rounded-xl border border-dashed border-border/80 px-3 py-2 text-[11px] font-medium text-muted-foreground transition hover:border-primary/50 hover:text-primary"
            >
              New library
              <span className="text-sm leading-none">+</span>
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
            <button
              type="button"
              onClick={() => onSelectCategory(null)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition",
                !selectedCategoryId
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-secondary"
              )}
            >
              <span className="min-w-0 flex-1 truncate">All Libraries</span>
              <span className="shrink-0 text-[10px] opacity-70">
                {libraryItems.length}
              </span>
            </button>

            {categories.map((cat) => {
              const count = libraryItems.filter(item => item.categoryId === cat._id).length;
              return (
                <button
                  key={cat._id}
                  type="button"
                  onClick={() => onSelectCategory(cat._id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition",
                    selectedCategoryId === cat._id
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-secondary"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{cat.name}</span>
                  {count > 0 && (
                    <span className="shrink-0 text-[10px] opacity-70">
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
                      placeholder="Search title or lyrics..."
                      className="h-10 w-full rounded-xl border-border/80 bg-background/90 pl-9 pr-3 text-xs shadow-sm"
                    />
                  </div>

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
                  disabled={composeSelectionCount < 2}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold shadow-sm transition",
                    composeSelectionCount >= 2
                      ? "border border-[#ff6f59]/30 bg-[#ff6f59]/12 text-[#ff6f59] hover:bg-[#ff6f59]/18"
                      : "border border-input bg-background text-muted-foreground",
                  )}
                  title="Create one flow from selected library items"
                >
                  <Layers3 className="h-4 w-4" />
                  Create flow
                </button>

                {composeSelectionCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSelectedComposeIds([])}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-input bg-background px-3 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-secondary"
                    title="Clear selected libraries"
                  >
                    <X className="h-4 w-4" />
                    {composeSelectionCount} selected
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={handleExportLibraries}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-input bg-background text-muted-foreground shadow-sm transition hover:bg-secondary"
                  title="Export libraries"
                >
                  <Download className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-input bg-background text-muted-foreground shadow-sm transition hover:bg-secondary"
                  title="Import libraries"
                >
                  <Upload className="h-4 w-4" />
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(event) => {
                    void handleImportLibraries(event);
                  }}
                />

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex h-10 w-10 items-center justify-center rounded-xl border border-input bg-background text-muted-foreground shadow-sm transition hover:bg-secondary">
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
                      onClick={() => setShowNewLibraryItemDialog(true)}
                      className="mt-4 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
                    >
                      New library item
                    </button>
                  ) : null}
                </div>
              </div>
            ) : layoutMode === "grid" ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                <NewLibraryItemButton onClick={() => setShowNewLibraryItemDialog(true)} />
                {filteredItems.map((item) => (
                  <LibraryItemCard
                    key={item._id}
                    item={item}
                    isSelected={selectedLibraryId === item._id}
                    showAddToService={isInsideService && !!selectedServiceId}
                    isChecked={selectedComposeIds.includes(item._id)}
                    onToggleSelected={() => toggleComposeSelection(item._id)}
                    onSelect={() => onSelectLibraryItem(item._id)}
                    onRename={() =>
                      setRenameTarget({ id: item._id, title: item.title })
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
                <NewLibraryItemRowButton onClick={() => setShowNewLibraryItemDialog(true)} />
                {filteredItems.map((item) => (
                  <LibraryItemRow
                    key={item._id}
                    item={item}
                    isSelected={selectedLibraryId === item._id}
                    showAddToService={isInsideService && !!selectedServiceId}
                    isChecked={selectedComposeIds.includes(item._id)}
                    onToggleSelected={() => toggleComposeSelection(item._id)}
                    onSelect={() => onSelectLibraryItem(item._id)}
                    onRename={() =>
                      setRenameTarget({ id: item._id, title: item.title })
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
        {showNewLibraryItemDialog && (
          <NewLibraryItemDialog
            onClose={() => setShowNewLibraryItemDialog(false)}
            onCreate={onCreateLibraryItem}
            onFixLyrics={onFixLyrics}
            categoryId={selectedCategoryId}
            categories={categories}
          />
        )}

        {showNewCategoryDialog && (
          <NewCategoryDialog
            onClose={() => setShowNewCategoryDialog(false)}
            onCreate={onCreateCategory}
          />
        )}

        {showComposeDialog && (
          <ComposeLibrariesDialog
            itemIds={selectedComposeIds}
            libraryItems={libraryItems}
            categories={categories}
            categoryId={selectedCategoryId}
            onClose={() => setShowComposeDialog(false)}
            onCreate={async (title, itemIds, categoryId) => {
              await onCreateComposedLibraryItem(title, itemIds, categoryId);
              setSelectedComposeIds([]);
              setShowComposeDialog(false);
            }}
          />
        )}

        {renameTarget && (
          <RenameLibraryItemDialog
            title={renameTarget.title}
            onClose={() => setRenameTarget(null)}
            onSave={(newTitle) => {
              onRenameLibraryItem(renameTarget.id, newTitle);
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
interface LibraryItemCardProps {
  item: LibraryItem;
  isSelected: boolean;
  showAddToService: boolean;
  isChecked: boolean;
  onToggleSelected: () => void;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAddToService: () => void;
}

const LibraryItemCard = memo(function LibraryItemCard({
  item,
  isSelected,
  showAddToService,
  isChecked,
  onToggleSelected,
  onSelect,
  onRename,
  onDelete,
  onAddToService,
}: LibraryItemCardProps) {
  return (
    <div
      className={cn(
        "group rounded-lg border px-3 py-2 text-left text-xs transition",
        isSelected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-foreground hover:border-primary/50"
      )}
    >
      <div className="flex items-start justify-between">
        <button
          type="button"
          onClick={onToggleSelected}
          className={cn(
            "mr-2 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition",
            isChecked
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-transparent hover:border-primary/60",
          )}
          aria-label={isChecked ? "Deselect library item" : "Select library item"}
        >
          <Check className="h-3 w-3" />
        </button>
        <button type="button" onClick={onSelect} className="flex-1 text-left">
          <div className="font-medium">{item.title}</div>
          <div className="mt-1 text-muted-foreground">
            {item.slides.length} slides
          </div>
        </button>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100">
          <button
            type="button"
            aria-label="Rename library item"
            onClick={onRename}
            className="text-muted-foreground hover:text-foreground p-1"
          >
            <EditIcon />
          </button>
          <button
            type="button"
            aria-label="Delete library item"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive p-1"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      {showAddToService && (
        <button
          type="button"
          onClick={onAddToService}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-border py-1 text-[10px] text-muted-foreground transition hover:border-primary hover:text-primary"
        >
          + Add to service
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
      className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground transition hover:border-primary hover:text-primary"
    >
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      New library item
    </button>
  );
}

function NewLibraryItemRowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md border border-dashed border-border bg-card px-3 py-2 text-[11px] text-muted-foreground transition hover:border-primary hover:text-primary"
    >
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      New library item
    </button>
  );
}

const LibraryItemRow = memo(function LibraryItemRow({
  item,
  isSelected,
  showAddToService,
  isChecked,
  onToggleSelected,
  onSelect,
  onRename,
  onDelete,
  onAddToService,
}: LibraryItemCardProps) {
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-left transition",
        isSelected
          ? "border-primary bg-primary/8"
          : "border-border hover:border-primary/35",
      )}
    >
      <button
        type="button"
        onClick={onToggleSelected}
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition",
          isChecked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-background text-transparent hover:border-primary/60",
        )}
        aria-label={isChecked ? "Deselect library item" : "Select library item"}
      >
        <Check className="h-3 w-3" />
      </button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
        <p className="text-[11px] text-muted-foreground">{item.slides.length} slides</p>
      </button>
      {showAddToService ? (
        <button
          type="button"
          onClick={onAddToService}
          className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground transition hover:border-primary hover:text-primary"
        >
          Add to service
        </button>
      ) : null}
      <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          aria-label="Rename library item"
          onClick={onRename}
          className="p-1 text-muted-foreground hover:text-foreground"
        >
          <EditIcon />
        </button>
        <button
          type="button"
          aria-label="Delete library item"
          onClick={onDelete}
          className="p-1 text-muted-foreground hover:text-destructive"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
});

// Dialog components
function NewLibraryItemDialog({
  onClose,
  onCreate,
  onFixLyrics,
  categoryId,
  categories,
}: {
  onClose: () => void;
  onCreate: (
    title: string,
    body: string,
    categoryId?: string
  ) => Promise<unknown>;
  onFixLyrics: (lyrics: string) => Promise<string>;
  categoryId: string | null;
  categories: Category[];
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isFixing, setIsFixing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to selected category, or first available category if "All" is selected
  const [targetCategoryId, setTargetCategoryId] = useState<string>(
    categoryId ?? categories[0]?._id ?? ""
  );

  const handleCreate = async () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    setIsCreating(true);

    let shouldClose = false;
    const nextCategoryId = targetCategoryId || undefined;
    try {
      await onCreate(
        title.trim(),
        body,
        nextCategoryId,
      );
      shouldClose = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    }

    setIsCreating(false);
    if (shouldClose) {
      onClose();
    }
  };

  const handleFix = async () => {
    if (!body.trim()) {
      return;
    }

    setIsFixing(true);

    let fixedBody: string | null = null;
    try {
      fixedBody = await onFixLyrics(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fix");
    }

    setIsFixing(false);
    if (fixedBody !== null) {
      setBody(fixedBody);
    }
  };

  return (
    <Dialog title="New library item" onClose={onClose}>
      <div className="space-y-3">
        {/* Library Dropdown */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Library
          </label>
          <Select
            value={targetCategoryId}
            onValueChange={setTargetCategoryId}
          >
            <SelectTrigger className="w-full border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary focus-visible:ring-0">
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

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Library item title"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Content
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"[Verse 1]\nLine 1\nLine 2\n\n[Chorus]\nLine 1"}
            rows={10}
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleFix}
            disabled={isFixing}
            className="flex-1 rounded-md border border-input py-2 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {isFixing ? "Fixing..." : "Fix body"}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={isCreating}
            className="flex-1 rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isCreating && <Spinner className="size-3" />}
            {isCreating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function ComposeLibrariesDialog({
  itemIds,
  libraryItems,
  categories,
  categoryId,
  onClose,
  onCreate,
}: {
  itemIds: string[];
  libraryItems: LibraryItem[];
  categories: Category[];
  categoryId: string | null;
  onClose: () => void;
  onCreate: (
    title: string,
    itemIds: string[],
    categoryId?: string,
  ) => Promise<unknown>;
}) {
  const selectedItems = useMemo(
    () => libraryItems.filter((item) => itemIds.includes(String(item._id))),
    [itemIds, libraryItems],
  );
  const [title, setTitle] = useState(
    selectedItems.map((item) => item.title).slice(0, 3).join(" / "),
  );
  const [targetCategoryId, setTargetCategoryId] = useState<string>(
    categoryId ?? categories[0]?._id ?? "",
  );
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!title.trim()) {
      setError("Flow title is required");
      return;
    }

    if (selectedItems.length < 2) {
      setError("Select at least two library items");
      return;
    }

    setIsCreating(true);
    try {
      await onCreate(title.trim(), itemIds, targetCategoryId || undefined);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Failed to create flow",
      );
      setIsCreating(false);
      return;
    }
    setIsCreating(false);
  };

  return (
    <Dialog title="Create flow from library items" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-border/70 bg-card/50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Selected items
          </p>
          <div className="mt-3 space-y-2">
            {selectedItems.map((item, index) => (
              <div
                key={item._id}
                className="flex items-center justify-between rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-xs"
              >
                <span className="truncate text-foreground">
                  {index + 1}. {item.title}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {item.slides.length} slides
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Save to library
          </label>
          <Select
            value={targetCategoryId}
            onValueChange={setTargetCategoryId}
          >
            <SelectTrigger className="w-full border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary focus-visible:ring-0">
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

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Flow title
          </label>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            placeholder="Praise flow"
            autoFocus
          />
        </div>

        <p className="text-xs text-muted-foreground">
          The new library item starts as one combined flow. You can then reorder
          slides, remove verses, and relabel sections in edit mode.
        </p>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

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
            disabled={isCreating}
            className="flex-1 rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isCreating ? "Creating..." : "Create flow"}
          </button>
        </div>
      </div>
    </Dialog>
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

function RenameLibraryItemDialog({
  title,
  onClose,
  onSave,
}: {
  title: string;
  onClose: () => void;
  onSave: (newTitle: string) => void;
}) {
  const [newTitle, setNewTitle] = useState(title);

  return (
    <Dialog title="Rename library item" onClose={onClose}>
      <div className="space-y-3">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && onSave(newTitle)}
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
            onClick={() => onSave(newTitle)}
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
function EditIcon() {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

// Skeleton loading component
function ShowsGridSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-border px-3 py-2"
        >
          <Skeleton className="h-4 w-3/4 mb-2" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
