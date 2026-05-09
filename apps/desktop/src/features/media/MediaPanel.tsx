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

type MediaFilter = "all" | "images" | "videos";

// Memoized media item card component
const MediaItemCard = memo(function MediaItemCard({
  item,
  isActive,
  onSelect,
  onAddToService,
  isInsideService,
  isGridView,
}: {
  item: MediaItem;
  isActive: boolean;
  onSelect: (item: MediaItem) => void;
  onAddToService: (item: MediaItem) => void;
  isInsideService: boolean;
  isGridView?: boolean;
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
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-black transition",
        isGridView ? "aspect-video w-full" : "flex h-16 w-full flex-row items-center",
        isActive
          ? "border-primary ring-2 ring-primary"
          : "border-border hover:border-primary"
      )}
    >
          <div className={cn(
            "overflow-hidden shrink-0",
            isGridView ? "h-full w-full" : "h-full w-28 border-r border-border"
          )}>
            {item.type === "image" ? (
              <img
                src={item.url}
                alt={item.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <video
                src={item.url}
                className="h-full w-full object-cover"
                muted
                preload={isInView ? "metadata" : "none"}
                playsInline
                onLoadedMetadata={(e) => {
                  if (!isInView) {
                    return;
                  }
                  try {
                    e.currentTarget.currentTime = 0.01;
                    e.currentTarget.pause();
                  } catch {
                    // Ignore seek errors for unsupported formats.
                  }
                }}
              />
            )}
          </div>
          {isGridView ? (
            <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
              <p className="truncate text-xs text-white">{item.name}</p>
            </div>
          ) : (
            <div className="flex flex-1 items-center px-4 overflow-hidden">
              <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
            </div>
          )}
          {/* Type indicator */}
          <div className="absolute right-1 top-1 rounded bg-black/60 p-1">
            {item.type === "video" ? (
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
      </ContextMenuContent>
    </ContextMenu>
  );
});

interface MediaPanelProps {
  mediaState: MediaState;
  onSelectForOutput: (item: MediaItem | null) => void;
  isInsideService: boolean;
  selectedServiceId: Id<"services"> | null;
  onAddToService: (mediaId: string, mediaName: string) => Promise<void>;
  orgId: Id<"organizations"> | null;
}

export interface MediaPanelRef {
  focusSearch: () => void;
}

export const MediaPanel = memo(
  forwardRef<MediaPanelRef, MediaPanelProps>(function MediaPanel(
    {
      mediaState,
      onSelectForOutput,
      isInsideService,
      selectedServiceId,
      onAddToService,
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
    } = mediaState;

    const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");

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
      if (activeMediaItem?.id === item.id) {
        onSelectForOutput(null);
      } else {
        onSelectForOutput(item);
      }
    };

    // Check if File System Access API is supported
    const isSupported =
      typeof window !== "undefined" && "showDirectoryPicker" in window;

    if (!isSupported) {
      return (
        <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
          <div>
            <p className="font-medium">Browser not supported</p>
            <p className="mt-1 text-xs">
              Your browser doesn&apos;t support the File System Access API.
              <br />
              Please use Chrome, Edge, or another Chromium-based browser.
            </p>
          </div>
        </div>
      );
    }

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
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
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
                          ? "bg-primary text-primary-foreground"
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
                            ? "bg-primary text-primary-foreground"
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
              <div className="flex items-center justify-between border-b border-border px-3 py-1.5 gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setFilter("all")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition",
                      filter === "all"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    All
                    <span className="text-[10px] opacity-70">
                      ({filteredItems.length})
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilter("images")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition",
                      filter === "images"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    <Image className="h-3 w-3" />
                    Images
                    <span className="text-[10px] opacity-70">
                      ({imageCount})
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilter("videos")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition",
                      filter === "videos"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    <Video className="h-3 w-3" />
                    Videos
                    <span className="text-[10px] opacity-70">
                      ({videoCount})
                    </span>
                  </button>
                </div>

                {/* Search Input */}
                <div className="flex items-center gap-1">
                  {/* Search moved to footer */}

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

              {/* Media items grid - using Activity for each filter view to pre-render */}
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
                  <>
                    <div
                      className={cn("absolute inset-0 overflow-auto p-3", filter !== "all" && "hidden")}
                      data-media-scroll
                    >
                      <div 
                        className={cn("pb-8", isGridView ? "grid" : "flex flex-col")}
                        style={{
                          gap: `${itemGap}px`,
                          gridTemplateColumns: isGridView 
                            ? `repeat(auto-fill, minmax(${minItemWidth}px, 1fr))` 
                            : undefined
                        }}
                      >
                        {filteredItems.map((item) => (
                          <div key={item.id}>
                            <MediaItemCard
                              item={item}
                              isActive={activeMediaItem?.id === item.id}
                              onSelect={handleSelectMedia}
                              onAddToService={handleAddToService}
                              isInsideService={isInsideService}
                              isGridView={isGridView}
                            />
                          </div>
                        ))}
                      </div>
                      {/* Empty state overlay */}
                      {filteredItems.length === 0 && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                          <Image className="h-8 w-8" />
                          <span>No items found</span>
                        </div>
                      )}
                    </div>
                    <div
                      className={cn("absolute inset-0 overflow-auto p-3", filter !== "images" && "hidden")}
                      data-media-scroll
                    >
                      <div 
                         className={cn("pb-8", isGridView ? "grid" : "flex flex-col")}
                         style={{
                           gap: `${itemGap}px`,
                           gridTemplateColumns: isGridView 
                             ? `repeat(auto-fill, minmax(${minItemWidth}px, 1fr))` 
                             : undefined
                         }}
                      >
                        {filteredItems
                          .filter((item) => item.type === "image")
                          .map((item) => (
                            <div key={item.id}>
                              <MediaItemCard
                                item={item}
                                isActive={activeMediaItem?.id === item.id}
                                onSelect={handleSelectMedia}
                                onAddToService={handleAddToService}
                                isInsideService={isInsideService}
                                isGridView={isGridView}
                              />
                            </div>
                          ))}
                      </div>
                      {/* Empty state overlay */}
                      {imageCount === 0 && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                          <Image className="h-8 w-8" />
                          <span>No images found</span>
                        </div>
                      )}
                    </div>
                    <div
                      className={cn("absolute inset-0 overflow-auto p-3", filter !== "videos" && "hidden")}
                      data-media-scroll
                    >
                      <div 
                         className={cn("pb-8", isGridView ? "grid" : "flex flex-col")}
                         style={{
                           gap: `${itemGap}px`,
                           gridTemplateColumns: isGridView 
                             ? `repeat(auto-fill, minmax(${minItemWidth}px, 1fr))` 
                             : undefined
                         }}
                      >
                        {filteredItems
                          .filter((item) => item.type === "video")
                          .map((item) => (
                            <div key={item.id}>
                              <MediaItemCard
                                item={item}
                                isActive={activeMediaItem?.id === item.id}
                                onSelect={handleSelectMedia}
                                onAddToService={handleAddToService}
                                isInsideService={isInsideService}
                                isGridView={isGridView}
                              />
                            </div>
                          ))}
                      </div>
                      {/* Empty state overlay */}
                      {videoCount === 0 && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                          <Video className="h-8 w-8" />
                          <span>No videos found</span>
                        </div>
                      )}
                    </div>
                  </>
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
