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
import type { LibraryItem, Category, ContentSource } from "../../types";
import { Dialog } from "../../components/Dialog";
import { Input } from "../../components/ui/input";
import { Spinner } from "../../components/ui/spinner";
import { Skeleton } from "../../components/ui/skeleton";
import { cn } from "../../lib/utils";
import {
  Search,
  ArrowUpDown,
  Check,
  ArrowUp,
  ArrowDown,
  Download,
  Upload,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";

interface ShowsPanelProps {
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
  onRenameLibraryItem: (id: string, title: string) => Promise<void>;
  onDeleteLibraryItem: (id: string) => Promise<void>;
  onAddToService: (libraryId: string) => void;
  onCreateCategory: (name: string) => Promise<unknown>;
  onFixLyrics: (lyrics: string) => Promise<string>;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  contentSource: ContentSource;
}

export interface ShowsPanelRef {
  focusSearch: () => void;
}

export const ShowsPanel = memo(
  forwardRef<ShowsPanelRef, ShowsPanelProps>(function ShowsPanel(
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
      onRenameLibraryItem,
      onDeleteLibraryItem,
      onAddToService,
      onCreateCategory,
      onFixLyrics,
      searchQuery,
      onSearchChange,
      contentSource,
    }: ShowsPanelProps,
    ref,
  ) {
    const [showNewLibraryItemDialog, setShowNewLibraryItemDialog] = useState(false);
    const [showNewCategoryDialog, setShowNewCategoryDialog] = useState(false);
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

    const searchInputRef = useRef<HTMLInputElement>(null);
    const importInputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      focusSearch: () => searchInputRef.current?.focus(),
    }));

    // Filter library items by category
    const filteredItems = useMemo(() => {
      let result = selectedCategoryId
        ? libraryItems.filter((s) => s.categoryId === selectedCategoryId)
        : libraryItems;

      // Sorting
      result = [...result].sort((a, b) => {
        if (sortBy === "name") {
          return sortOrder === "asc"
            ? a.title.localeCompare(b.title)
            : b.title.localeCompare(a.title);
        } else {
          // Recent
          return sortOrder === "asc"
            ? a._creationTime - b._creationTime
            : b._creationTime - a._creationTime;
        }
      });

      return result;
    }, [libraryItems, selectedCategoryId, sortBy, sortOrder]);

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

    const handleImportLibraries = async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

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

        const items = Array.isArray(parsed.items) ? parsed.items : [];
        for (const item of items) {
          const title = typeof item.title === "string" ? item.title.trim() : "";
          const body = typeof item.body === "string" ? item.body : (typeof item.lyrics === "string" ? item.lyrics : "");
          if (!title) {
            continue;
          }
          await onCreateLibraryItem(title, body, item.categoryId ?? undefined);
        }
      } catch (error) {
        console.error("Failed to import libraries:", error);
      } finally {
        event.target.value = "";
      }
    };

    return (
      <div className="flex h-full flex-col">
        {/* Library bar and Search */}
        <div className="flex items-center justify-between border-b border-border px-2 py-1 gap-2">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1">
            <p className="text-[10px] text-muted-foreground mr-2 shrink-0">
              Libraries:
            </p>
            <button
              type="button"
              onClick={() => onSelectCategory(null)}
              className={cn(
                "px-2 py-1 rounded text-[10px] transition",
                !selectedCategoryId
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat._id}
                type="button"
                onClick={() => onSelectCategory(cat._id)}
                className={cn(
                  "px-2 py-1 rounded text-[10px] transition",
                  selectedCategoryId === cat._id
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {cat.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowNewCategoryDialog(true)}
              className="px-2 py-1 text-[10px] text-muted-foreground hover:text-primary"
            >
              +
            </button>
          </div>

          {/* Search and Sort */}
          <div className="flex items-center gap-1 shrink-0">
            <div className="relative w-32 xl:w-40">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={
                  selectedCategoryId
                    ? `Search ${categories.find((c) => c._id === selectedCategoryId)?.name}...`
                    : "Search..."
                }
                className="h-7 w-full pl-7 text-[10px]"
              />
            </div>

            <button
              type="button"
              onClick={handleExportLibraries}
              className="h-7 w-7 flex items-center justify-center rounded-md border border-input hover:bg-secondary text-muted-foreground"
              title="Export libraries"
            >
              <Download className="h-3 w-3" />
            </button>

            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="h-7 w-7 flex items-center justify-center rounded-md border border-input hover:bg-secondary text-muted-foreground"
              title="Import libraries"
            >
              <Upload className="h-3 w-3" />
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
                <button className="h-7 w-7 flex items-center justify-center rounded-md border border-input hover:bg-secondary text-muted-foreground">
                  <ArrowUpDown className="h-3 w-3" />
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
          </div>
        </div>

        {/* Library items grid */}
        <div className="flex-1 overflow-auto p-2">
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
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
              <NewLibraryItemButton onClick={() => setShowNewLibraryItemDialog(true)} />
              {filteredItems.map((item) => (
                <LibraryItemCard
                  key={item._id}
                  item={item}
                  isSelected={selectedLibraryId === item._id}
                  showAddToService={isInsideService && !!selectedServiceId}
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
      </div>
    );
  }),
);

// Sub-components
interface LibraryItemCardProps {
  item: LibraryItem;
  isSelected: boolean;
  showAddToService: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAddToService: () => void;
}

const LibraryItemCard = memo(function LibraryItemCard({
  item,
  isSelected,
  showAddToService,
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
    try {
      await onCreate(
        title.trim(),
        body,
        targetCategoryId || undefined,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setIsCreating(false);
    }
  };

  const handleFix = async () => {
    if (!body.trim()) return;
    setIsFixing(true);
    try {
      const fixed = await onFixLyrics(body);
      setBody(fixed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fix");
    } finally {
      setIsFixing(false);
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
          <select
            value={targetCategoryId}
            onChange={(e) => setTargetCategoryId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          >
            {categories.map((cat) => (
              <option key={cat._id} value={cat._id}>
                {cat.name}
              </option>
            ))}
          </select>
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
    } finally {
      setIsDeleting(false);
    }
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
