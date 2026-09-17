"use client";

import {
  memo,
  useEffect,
  useState,
  useMemo,
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import {
  FolderPlus,
  Trash2,
  RefreshCw,
  Image,
  Video,
  AlertTriangle,
  Folder,
  Monitor,
  Plus,
  Search,
  ArrowUpDown,
  Check,
  ArrowUp,
  ArrowDown,
  FilePlus,
  FolderPlus as FolderPlusIcon,
  Pencil,
} from "lucide-react";
import { Input } from "../../renderer/shared/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "../../renderer/shared/components/ui/dropdown-menu";
import type { MediaState, MediaItem, MediaFolder } from "./hooks";
import { useVideoSupport } from "../../renderer/shared/hooks/useVideoSupport";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import { toast } from "sonner";
import { cn } from "../../renderer/shared/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../renderer/shared/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../renderer/shared/components/ui/context-menu";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "../../renderer/shared/components/ui/resizable";
import { WorkspaceFooter } from "../../renderer/shared/components/WorkspaceFooter";
import { VideoThumbnail } from "./components/VideoThumbnail";

type MediaFilter = "all" | "images" | "videos";

// Memoized media item card component
const MediaItemCard = memo(function MediaItemCard({
  item,
  isActive,
  onSelect,
  onAddToService,
  onRename,
  onDelete,
  isInsideService,
  isGridView,
  unplayableReason,
}: {
  item: MediaItem;
  isActive: boolean;
  onSelect: (item: MediaItem) => void;
  onAddToService: (item: MediaItem) => void;
  onRename: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
  isInsideService: boolean;
  isGridView?: boolean;
  /** Set when this file will not play in the app (ADR-003). */
  unplayableReason?: string;
}) {
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const element = cardRef.current;
    if (!element || isInView) {
      return;
    }

    const root = element.closest("[data-media-scroll]") as Element | null;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { root, rootMargin: "200px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [isInView]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <button
      type="button"
      onClick={() => onSelect(item)}
      ref={cardRef}
      title={unplayableReason}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-black transition-all duration-150",
        isGridView ? "aspect-video w-full" : "flex h-16 w-full flex-row items-center",
        isActive
          ? "border-primary/70 ring-2 ring-primary/70 ring-offset-1 ring-offset-background"
          : unplayableReason
            ? "border-amber-500/70 hover:border-amber-500"
            : "border-border/60 hover:border-primary/40 hover:shadow-md hover:shadow-black/30"
      )}
    >
          <div className={cn(
            "overflow-hidden shrink-0",
            isGridView ? "h-full w-full" : "h-full w-28 border-r border-border/60"
          )}>
            {item.type === "image" ? (
              <img
                src={item.url}
                alt={item.name}
                className="h-full w-full object-contain"
                loading="lazy"
              />
            ) : (
              <VideoThumbnail
                path={item.path}
                lastModified={item.lastModified}
                name={item.name}
                enabled={isInView}
              />
            )}
          </div>
          {isGridView ? (
            <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
              <p className="truncate text-xs text-white">{item.name}</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col justify-center px-4 overflow-hidden">
              <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
              {unplayableReason ? (
                <p className="truncate text-xs text-amber-500">{unplayableReason}</p>
              ) : null}
            </div>
          )}
          {/* Type indicator, or a warning when the file will not play.
              A volunteer needs to find this out while there is still time to
              convert the file, not when it reaches the screen (ADR-002). */}
          <div
            className={cn(
              "absolute right-1 top-1 rounded p-1",
              unplayableReason ? "bg-amber-500" : "bg-black/60"
            )}
          >
            {unplayableReason ? (
              <AlertTriangle className="h-3 w-3 text-black" aria-hidden />
            ) : item.type === "video" ? (
              <Video className="h-3 w-3 text-white" />
            ) : (
              <Image className="h-3 w-3 text-white" />
            )}
          </div>
          {/* Active/Playing indicator */}
          {isActive && (
            <div className="absolute left-1 top-1 flex items-center gap-1 rounded bg-primary px-1.5 py-0.5">
              <Monitor className="h-3 w-3 text-primary-foreground" />
              <span className="text-[10px] font-medium text-primary-foreground">
                LIVE
              </span>
            </div>
          )}
          {/* Selection check */}
          {isActive && (
            <div className="absolute bottom-1 right-1 rounded-full bg-primary p-0.5">
              <Check className="h-3 w-3 text-primary-foreground" />
            </div>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onSelect(item)}>
          <Monitor className="mr-2 h-4 w-4" />
          {isActive ? "Remove from Output" : "Show in Output"}
        </ContextMenuItem>
        {isInsideService && (
          <ContextMenuItem onClick={() => onAddToService(item)}>
            <Plus className="mr-2 h-4 w-4" />
            Add to Service
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => onRename(item)}>
          <Pencil className="mr-2 h-4 w-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => onDelete(item)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Remove from media
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

interface MediaPanelProps {
  mediaState: MediaState;
  liveMediaItem?: MediaItem | null;
  onSelectForOutput: (item: MediaItem | null) => void;
  isInsideService: boolean;
  selectedServiceId: Id<"services"> | null;
  onAddToService: (mediaId: string, mediaName: string) => Promise<void>;
  onRenameInServices: (
    oldMediaId: string,
    nextMedia: { id: string; name: string },
  ) => Promise<void>;
  onRemoveFromServices: (mediaId: string) => Promise<void>;
  orgId: Id<"organizations"> | null;
}

export interface MediaPanelRef {
  focusSearch: () => void;
}

export const MediaPanel = memo(
  forwardRef<MediaPanelRef, MediaPanelProps>(function MediaPanel(
    {
      mediaState,
      liveMediaItem,
      onSelectForOutput,
      isInsideService,
      selectedServiceId,
      onAddToService,
      onRenameInServices,
      onRemoveFromServices,
      orgId,
    }: MediaPanelProps,
    ref
  ) {
    const {
      folders,
      allMediaItems,
      isLoading,
      selectedFolderId,
      setSelectedFolderId,
      addFolder,
      removeFolder,
      refreshMedia,
      activeMediaItem,
      addMediaFile,
      createFolder,
      renameFolder,
      renameMediaItem,
      deleteMediaItem,
    } = mediaState;
    const outputMediaItem = liveMediaItem ?? activeMediaItem;

    const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [renameMediaTarget, setRenameMediaTarget] = useState<MediaItem | null>(
      null,
    );
    const [renameMediaName, setRenameMediaName] = useState("");
    const [mediaToRemove, setMediaToRemove] = useState<MediaItem | null>(null);

    const [filter, setFilter] = useState<MediaFilter>("all");
    const [folderToRemove, setFolderToRemove] = useState<MediaFolder | null>(
      null
    );
    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    // UI State for Footer
    const [scale, setScale] = useState(60);
    const [isGridView, setIsGridView] = useState(true);

    const scaleFactor = scale / 60;
    const minItemWidth = Math.round(180 * scaleFactor);
    const itemGap = Math.max(8, Math.round(12 * scaleFactor));



    const searchInputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      focusSearch: () => searchInputRef.current?.focus(),
    }));

    // Compute filtered items based on folder and search query
    const filteredItems = useMemo(() => {
      const baseItems = selectedFolderId
        ? allMediaItems.filter((item) => item.folderId === selectedFolderId)
        : allMediaItems;
      let items = [...baseItems];

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        items = items.filter((item) => item.name.toLowerCase().includes(q));
      }

      // Sort
      return items.sort((a, b) => {
        if (sortBy === "name") {
          return sortOrder === "asc"
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name);
        } else {
          // Recent using lastModified
          return sortOrder === "asc"
            ? (a.lastModified || 0) - (b.lastModified || 0)
            : (b.lastModified || 0) - (a.lastModified || 0);
        }
      });
    }, [allMediaItems, selectedFolderId, searchQuery, sortBy, sortOrder]);

    const imageCount = filteredItems.filter(
      (item) => item.type === "image"
    ).length;
    const videoCount = filteredItems.filter(
      (item) => item.type === "video"
    ).length;
    const visibleMediaItems = useMemo(() => {
      if (filter === "images") {
        return filteredItems.filter((item) => item.type === "image");
      }
      if (filter === "videos") {
        return filteredItems.filter((item) => item.type === "video");
      }
      return filteredItems;
    }, [filter, filteredItems]);

    // Which of the visible videos will not play in the app (ADR-003).
    // Asked about what is on screen rather than the whole library, so a folder
    // of a thousand files does not check nine hundred it is not showing.
    const visibleVideoPaths = useMemo(
      () =>
        visibleMediaItems
          .filter((item) => item.type === "video")
          .map((item) => item.path),
      [visibleMediaItems]
    );
    const unplayableMedia = useVideoSupport(visibleVideoPaths);

    const handleAddToService = async (item: MediaItem) => {
      if (!selectedServiceId) {
        toast.error("Please select a service first");
        return;
      }
      try {
        await onAddToService(item.id, item.name);
        toast.success(`Added "${item.name}" to service`);
      } catch (error) {
        toast.error("Failed to add to service");
      }
    };

    const handleAddFolder = async () => {
      try {
        const folder = await addFolder();
        if (folder) {
          toast.success(`Added folder: ${folder.name}`);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to add folder"
        );
      }
    };

    const removeMediaFromServices = useMutation(
      api.services.removeMediaForFolder
    );

    const handleConfirmRemoveFolder = async () => {
      if (!folderToRemove) return;

      if (orgId) {
        try {
          await removeMediaFromServices({ folderId: folderToRemove.id, workspaceId: orgId });
        } catch (e) {
          console.error("Failed to cleanup media from services", e);
          // Continue with local removal even if cleanup fails
        }
      }

      await removeFolder(folderToRemove.id);
      toast.success(`Removed folder: ${folderToRemove.name}`);
      setFolderToRemove(null);
    };

    const handleRefresh = async () => {
      await refreshMedia();
      toast.success("Media refreshed");
    };

    const handleSelectMedia = (item: MediaItem) => {
      // Toggle selection - if same item, deselect
      if (outputMediaItem?.id === item.id) {
        onSelectForOutput(null);
      } else {
        onSelectForOutput(item);
      }
    };

    const openRenameMedia = (item: MediaItem) => {
      setRenameMediaTarget(item);
      setRenameMediaName(item.name);
    };

    const handleConfirmRenameMedia = async () => {
      if (!renameMediaTarget || !renameMediaName.trim()) return;
      try {
        const oldMediaId = renameMediaTarget.id;
        const nextItem = await renameMediaItem(
          renameMediaTarget,
          renameMediaName.trim(),
        );
        await onRenameInServices(oldMediaId, {
          id: nextItem.id,
          name: nextItem.name,
        });
        if (activeMediaItem?.id === oldMediaId) {
          onSelectForOutput(nextItem);
        }
        toast.success(`Renamed media to "${nextItem.name}"`);
        setRenameMediaTarget(null);
        setRenameMediaName("");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to rename media",
        );
      }
    };

    const handleConfirmRemoveMedia = async () => {
      if (!mediaToRemove) return;
      try {
        const mediaId = mediaToRemove.id;
        await deleteMediaItem(mediaToRemove);
        await onRemoveFromServices(mediaId);
        if (activeMediaItem?.id === mediaId) {
          onSelectForOutput(null);
        }
        toast.success(`Removed "${mediaToRemove.name}" from media`);
        setMediaToRemove(null);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to remove media",
        );
      }
    };

    // NOTE: this panel used to gate itself on `"showDirectoryPicker" in window`.
    // That check was vestigial — the app has never called the File System
    // Access API. Folders are chosen through a native dialog
    // (`useMediaFolders.addFolder` → `selectFolder`) and read from the native
    // layer, neither of which touches the web API. Under Chromium the check
    // always passed, so it was invisible; under a non-Chromium webview it hid a
    // fully working panel behind a "browser not supported" message.

    return (
      <>
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full"
          id="present-media-panel-layout"
        >
          {/* Folders sidebar - resizable */}
          <ResizablePanel defaultSize="33" minSize="20" maxSize="40">
            <div className="flex h-full flex-col border-r border-border">
              <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Media
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={isLoading || folders.length === 0}
                    className="rounded p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
                    title="Refresh"
                  >
                    <RefreshCw
                      className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
                    />
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="rounded p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                        title="Add..."
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleAddFolder}>
                        <FolderPlusIcon className="mr-2 h-4 w-4" />
                        Add Existing Folder
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={async () => {
                        // Find current folder path to use as parent, or default
                        const currentFolder = folders.find(f => f.id === selectedFolderId);
                        const newFolder = await createFolder("Untitled Folder", currentFolder?.path);
                        if (newFolder) {
                          setEditingFolderId(newFolder.id);
                          setEditName(newFolder.name);
                        }
                      }}>
                        <Plus className="mr-2 h-4 w-4" />
                        Create New Folder
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
                {folders.length === 0 ? (
                  <button
                    type="button"
                    onClick={handleAddFolder}
                    className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-4 text-muted-foreground transition hover:border-primary hover:text-foreground"
                  >
                    <FolderPlusIcon className="h-8 w-8" />
                    <span className="text-xs">Add folder</span>
                  </button>
                ) : (
                  <div className="space-y-1">
                    {/* All folders option */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFolderId(null);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition",
                        selectedFolderId === null
                          ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                          : "text-foreground hover:bg-secondary"
                      )}
                    >
                      <Folder className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        All folders
                      </span>

                      <span className="shrink-0 text-[10px] opacity-70">
                        {allMediaItems.length}
                      </span>
                    </button>

                    {folders.map((folder) => (
                      <div
                        key={folder.id}
                        className={cn(
                          "group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition",
                          selectedFolderId === folder.id
                            ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                            : "text-foreground hover:bg-secondary"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedFolderId(folder.id)}
                          onDoubleClick={() => {
                            setEditingFolderId(folder.id);
                            setEditName(folder.name);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <Folder className="h-3.5 w-3.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            {editingFolderId === folder.id ? (
                              <Input
                                autoFocus
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="h-6 w-full py-0 px-1 text-xs focus-visible:ring-1"
                                onKeyDown={async (e) => {
                                  if (e.key === "Enter") {
                                    await renameFolder(folder.id, editName.trim());
                                    setEditingFolderId(null);
                                  } else if (e.key === "Escape") {
                                    setEditingFolderId(null);
                                  }
                                }}
                                onBlur={async () => {
                                  await renameFolder(folder.id, editName.trim());
                                  setEditingFolderId(null);
                                }}
                              />
                            ) : (
                              <span className="block truncate">
                                {folder.name}
                              </span>
                            )}
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">

                          <button
                            type="button"
                            onClick={() => setFolderToRemove(folder)}
                            className="shrink-0 rounded p-0.5 opacity-0 transition hover:bg-destructive/20 group-hover:opacity-100"
                            title="Remove folder"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Media grid */}
          <ResizablePanel defaultSize={67}>
            <div className="flex h-full flex-col">
              {/* Filter tabs and Search */}
              <div className="flex items-center justify-between border-b border-border px-3 py-2 gap-2">
                <div className="flex items-center gap-0.5 rounded-lg bg-secondary/40 p-0.5">
                  <button
                    type="button"
                    onClick={() => setFilter("all")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition",
                      filter === "all"
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    All
                    <span className="text-[10px] opacity-60">
                      {filteredItems.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilter("images")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition",
                      filter === "images"
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Image className="h-3 w-3" />
                    Images
                    <span className="text-[10px] opacity-60">{imageCount}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilter("videos")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition",
                      filter === "videos"
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Video className="h-3 w-3" />
                    Videos
                    <span className="text-[10px] opacity-60">{videoCount}</span>
                  </button>
                </div>

                {/* Search Input */}
                <div className="flex items-center gap-1">
                  {/* Search moved to footer */}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                      >
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

              {/* Media items grid */}
              <div className="relative flex-1 overflow-hidden">
                {isLoading ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Loading media...
                  </div>
                ) : allMediaItems.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    <FolderPlus className="h-8 w-8" />
                    <span>Add a folder to see media</span>
                  </div>
                ) : (
                  <div className="absolute inset-0 overflow-auto p-3" data-media-scroll>
                    <div
                      className={cn("pb-3", isGridView ? "grid" : "flex flex-col")}
                      style={{
                        gap: `${itemGap}px`,
                        gridTemplateColumns: isGridView
                          ? `repeat(auto-fill, minmax(${minItemWidth}px, 1fr))`
                          : undefined,
                      }}
                    >
                      {visibleMediaItems.map((item) => (
                        <div key={item.id}>
                          <MediaItemCard
                            item={item}
                            isActive={outputMediaItem?.id === item.id}
                            onSelect={handleSelectMedia}
                            onAddToService={handleAddToService}
                            onRename={openRenameMedia}
                            onDelete={setMediaToRemove}
                            isInsideService={isInsideService}
                            isGridView={isGridView}
                            unplayableReason={unplayableMedia.get(item.path)}
                          />
                        </div>
                      ))}
                    </div>
                    {visibleMediaItems.length === 0 ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                        {filter === "videos" ? (
                          <Video className="h-8 w-8" />
                        ) : (
                          <Image className="h-8 w-8" />
                        )}
                        <span>
                          {filter === "images"
                            ? "No images found"
                            : filter === "videos"
                              ? "No videos found"
                              : "No items found"}
                        </span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <WorkspaceFooter
                isGridView={isGridView}
                onViewModeChange={setIsGridView}
                scale={scale}
                onScaleChange={setScale}
                className="h-12 border-t-2"
                leftContent={
                  <button
                    type="button"
                    onClick={() => selectedFolderId && addMediaFile(selectedFolderId)}
                    disabled={!selectedFolderId}
                    className="flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary transition hover:bg-primary/20 disabled:pointer-events-none disabled:opacity-30 antialiased"
                    title="Add Media File to current folder"
                  >
                    <FilePlus className="h-3.5 w-3.5" />
                    Add Media
                  </button>
                }
                centerContent={
                  <div className="flex items-center gap-3 w-full max-w-md">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 select-none">Search</span>
                    <div className="relative flex-1 group">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/30 transition-colors group-focus-within:text-primary" />
                      <Input
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filter media..."
                        className="h-8 w-full pl-8 pr-12 text-xs bg-muted/20 border-muted-foreground/10 focus-visible:ring-1 focus-visible:bg-muted/40 transition-all shadow-inner"
                      />
                      <kbd className="absolute right-2 top-1/2 -translate-y-1/2 h-5 flex items-center px-1.5 rounded border border-muted-foreground/20 bg-muted/50 font-sans text-[10px] font-medium text-muted-foreground/60 select-none pointer-events-none group-focus-within:opacity-0 transition-opacity">
                        ⌘M
                      </kbd>
                    </div>
                  </div>
                }
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        {renameMediaTarget ? (
          <AlertDialog
            open={!!renameMediaTarget}
            onOpenChange={(open) => {
              if (!open) {
                setRenameMediaTarget(null);
                setRenameMediaName("");
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Rename media</AlertDialogTitle>
                <AlertDialogDescription>
                  Rename this file in its media folder.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                value={renameMediaName}
                onChange={(event) => setRenameMediaName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleConfirmRenameMedia();
                  }
                }}
                autoFocus
              />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmRenameMedia}>
                  Save
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}

        <AlertDialog
          open={!!mediaToRemove}
          onOpenChange={(open) => {
            if (!open) setMediaToRemove(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove media file?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes &quot;{mediaToRemove?.name}&quot; from disk and
                removes it from any services that use it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmRemoveMedia}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Remove folder confirmation dialog */}
        <AlertDialog
          open={!!folderToRemove}
          onOpenChange={() => setFolderToRemove(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove folder?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove &quot;{folderToRemove?.name}&quot; from your
                media library. The files on your computer will not be deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmRemoveFolder}>
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  })
);
