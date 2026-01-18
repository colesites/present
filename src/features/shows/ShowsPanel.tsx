"use client";

import {
  memo,
  useState,
  forwardRef,
  useImperativeHandle,
  useRef,
  useMemo,
} from "react";
import type { Id } from "@/../convex/_generated/dataModel";
import type { Song, Category } from "@/types";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Search, ArrowUpDown, Check, ArrowUp, ArrowDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface ShowsPanelProps {
  songs: Song[];
  categories: Category[];
  selectedSongId: Id<"songs"> | null;
  selectedCategoryId: Id<"categories"> | null;
  isInsideService: boolean;
  selectedServiceId: Id<"services"> | null;
  onSelectSong: (id: Id<"songs">) => void;
  onSelectCategory: (id: Id<"categories"> | null) => void;
  onCreateSong: (
    title: string,
    lyrics: string,
    categoryId?: Id<"categories">
  ) => Promise<unknown>;
  onRenameSong: (id: Id<"songs">, title: string) => Promise<void>;
  onDeleteSong: (id: Id<"songs">) => Promise<void>;
  onAddToService: (songId: Id<"songs">) => void;
  onCreateCategory: (name: string) => Promise<unknown>;
  onFixLyrics: (lyrics: string) => Promise<string>;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export interface ShowsPanelRef {
  focusSearch: () => void;
}

export const ShowsPanel = memo(
  forwardRef<ShowsPanelRef, ShowsPanelProps>(function ShowsPanel(
    {
      songs,
      categories,
      selectedSongId,
      selectedCategoryId,
      isInsideService,
      selectedServiceId,
      onSelectSong,
      onSelectCategory,
      onCreateSong,
      onRenameSong,
      onDeleteSong,
      onAddToService,
      onCreateCategory,
      onFixLyrics,
      searchQuery,
      onSearchChange,
    }: ShowsPanelProps,
    ref
  ) {
    const [showNewSongDialog, setShowNewSongDialog] = useState(false);
    const [showNewCategoryDialog, setShowNewCategoryDialog] = useState(false);
    const [renameTarget, setRenameTarget] = useState<{
      id: Id<"songs">;
      title: string;
    } | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{
      id: Id<"songs">;
      title: string;
    } | null>(null);

    const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    const searchInputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      focusSearch: () => searchInputRef.current?.focus(),
    }));

    // Filter songs by category
    const filteredSongs = useMemo(() => {
      let result = selectedCategoryId
        ? songs.filter((s) => s.categoryId === selectedCategoryId)
        : songs;

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
    }, [songs, selectedCategoryId, sortBy, sortOrder]);

    return (
      <div className="flex h-full flex-col">
        {/* Category bar and Search */}
        <div className="flex items-center justify-between border-b border-border px-2 py-1 gap-2">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1">
            <p className="text-[10px] text-muted-foreground mr-2 shrink-0">
              Categories:
            </p>
            <button
              type="button"
              onClick={() => onSelectCategory(null)}
              className={cn(
                "px-2 py-1 rounded text-[10px] transition",
                !selectedCategoryId
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground"
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
                    : "text-muted-foreground hover:text-foreground"
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
                      sortBy === "recent" ? "opacity-100" : "opacity-0"
                    )}
                  />
                  Recent
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("name")}>
                  <Check
                    className={cn(
                      "mr-2 h-3 w-3",
                      sortBy === "name" ? "opacity-100" : "opacity-0"
                    )}
                  />
                  Name
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSortOrder("asc")}>
                  <ArrowUp
                    className={cn(
                      "mr-2 h-3 w-3",
                      sortOrder === "asc" ? "opacity-100" : "opacity-0"
                    )}
                  />
                  Ascending
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortOrder("desc")}>
                  <ArrowDown
                    className={cn(
                      "mr-2 h-3 w-3",
                      sortOrder === "desc" ? "opacity-100" : "opacity-0"
                    )}
                  />
                  Descending
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Songs grid */}
        <div className="flex-1 overflow-auto p-2">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
            {filteredSongs.map((song) => (
              <SongCard
                key={song._id}
                song={song}
                isSelected={selectedSongId === song._id}
                showAddToService={isInsideService && !!selectedServiceId}
                onSelect={() => onSelectSong(song._id)}
                onRename={() =>
                  setRenameTarget({ id: song._id, title: song.title })
                }
                onDelete={() =>
                  setDeleteTarget({ id: song._id, title: song.title })
                }
                onAddToService={() => onAddToService(song._id)}
              />
            ))}
            <NewSongButton onClick={() => setShowNewSongDialog(true)} />
          </div>
        </div>

        {/* Dialogs */}
        {showNewSongDialog && (
          <NewSongDialog
            onClose={() => setShowNewSongDialog(false)}
            onCreate={onCreateSong}
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
          <RenameSongDialog
            title={renameTarget.title}
            onClose={() => setRenameTarget(null)}
            onSave={(newTitle) => {
              onRenameSong(renameTarget.id, newTitle);
              setRenameTarget(null);
            }}
          />
        )}

        {deleteTarget && (
          <DeleteSongDialog
            title={deleteTarget.title}
            onClose={() => setDeleteTarget(null)}
            onDelete={() => {
              onDeleteSong(deleteTarget.id);
              setDeleteTarget(null);
            }}
          />
        )}
      </div>
    );
  })
);

// Sub-components
interface SongCardProps {
  song: Song;
  isSelected: boolean;
  showAddToService: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAddToService: () => void;
}

const SongCard = memo(function SongCard({
  song,
  isSelected,
  showAddToService,
  onSelect,
  onRename,
  onDelete,
  onAddToService,
}: SongCardProps) {
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
          <div className="font-medium">{song.title}</div>
          <div className="mt-1 text-muted-foreground">
            {song.slides.length} slides
          </div>
        </button>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100">
          <button
            type="button"
            aria-label="Rename song"
            onClick={onRename}
            className="text-muted-foreground hover:text-foreground p-1"
          >
            <EditIcon />
          </button>
          <button
            type="button"
            aria-label="Delete song"
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

function NewSongButton({ onClick }: { onClick: () => void }) {
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
      New show
    </button>
  );
}

// Dialog components
function NewSongDialog({
  onClose,
  onCreate,
  onFixLyrics,
  categoryId,
  categories,
}: {
  onClose: () => void;
  onCreate: (
    title: string,
    lyrics: string,
    categoryId?: Id<"categories">
  ) => Promise<unknown>;
  onFixLyrics: (lyrics: string) => Promise<string>;
  categoryId: Id<"categories"> | null;
  categories: Category[];
}) {
  const [title, setTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [isFixing, setIsFixing] = useState(false);
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
    try {
      await onCreate(
        title.trim(),
        lyrics,
        (targetCategoryId as Id<"categories">) || undefined
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    }
  };

  const handleFix = async () => {
    if (!lyrics.trim()) return;
    setIsFixing(true);
    try {
      const fixed = await onFixLyrics(lyrics);
      setLyrics(fixed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fix");
    } finally {
      setIsFixing(false);
    }
  };

  return (
    <Dialog title="New show" onClose={onClose}>
      <div className="space-y-3">
        {/* Category Dropdown */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Category
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
            placeholder="Song title"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Lyrics
          </label>
          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
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
            {isFixing ? "Fixing..." : "Fix lyrics"}
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
    <Dialog title="New category" onClose={onClose}>
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name"
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

function RenameSongDialog({
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
    <Dialog title="Rename song" onClose={onClose}>
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

function DeleteSongDialog({
  title,
  onClose,
  onDelete,
}: {
  title: string;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <Dialog title="Delete song" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete "{title}"?
        </p>
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
            onClick={onDelete}
            className="flex-1 rounded-md bg-destructive py-2 text-xs font-semibold text-white hover:bg-destructive/90"
          >
            Delete
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
