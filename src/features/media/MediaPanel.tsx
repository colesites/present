"use client";

import {
  memo,
  useState,
  useMemo,
  Activity,
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
  AlertTriangle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type {
  MediaState,
  MediaItem,
  MediaFolder,
} from "@/hooks/useMediaFolders";
import type { Id } from "@/../convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

type MediaFilter = "all" | "images" | "videos";

// Memoized media item card component
const MediaItemCard = memo(function MediaItemCard({
  item,
  isActive,
  onSelect,
  onAddToService,
  isInsideService,
}: {
  item: MediaItem;
  isActive: boolean;
  onSelect: (item: MediaItem) => void;
  onAddToService: (item: MediaItem) => void;
  isInsideService: boolean;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={() => onSelect(item)}
          className={cn(
            "group relative aspect-video overflow-hidden rounded-lg border bg-black transition",
            isActive
              ? "border-primary ring-2 ring-primary"
              : "border-border hover:border-primary"
          )}
        >
          {item.type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.url}
              alt={item.name}
              className="h-full w-full object-cover"
              loading="eager"
            />
          ) : (
            <video
              src={item.url}
              className="h-full w-full object-cover"
              muted
              preload="auto"
            />
          )}
          {/* Overlay with name */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
            <p className="truncate text-xs text-white">{item.name}</p>
          </div>
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
      allMediaItems, // Use all items, filter by folder via CSS
      isLoading,
      selectedFolderId,
      setSelectedFolderId,
      addFolder,
      removeFolder,
      refreshMedia,
      activeMediaItem,
      reconnectFolder,
      reconnectAllFolders,
    } = mediaState;

    const [filter, setFilter] = useState<MediaFilter>("all");
    const [folderToRemove, setFolderToRemove] = useState<MediaFolder | null>(
      null
    );
    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    const hasBrokenFolders = useMemo(
      () => folders.some((f) => f.needsPermission),
      [folders]
    );

    const searchInputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      focusSearch: () => searchInputRef.current?.focus(),
    }));

    // Compute filtered items based on folder and search query
    const filteredItems = useMemo(() => {
      let items = selectedFolderId
        ? allMediaItems.filter((item) => item.folderId === selectedFolderId)
        : allMediaItems;

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
          // Recent using file.lastModified
          return sortOrder === "asc"
            ? (a.file.lastModified || 0) - (b.file.lastModified || 0)
            : (b.file.lastModified || 0) - (a.file.lastModified || 0);
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
          await removeMediaFromServices({ folderId: folderToRemove.id, orgId });
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
          autoSaveId="present-media-panel-layout"
        >
          {/* Folders sidebar - resizable */}
          <ResizablePanel defaultSize={20} minSize={12} maxSize={40}>
            <div className="flex h-full flex-col border-r border-border">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Folders
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
                  {hasBrokenFolders && (
                    <button
                      type="button"
                      onClick={reconnectAllFolders}
                      className="rounded p-1 text-yellow-500 transition hover:bg-yellow-500/10 hover:text-yellow-600"
                      title="Reconnect all folders"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleAddFolder}
                    className="rounded p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                    title="Add folder"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
                {folders.length === 0 ? (
                  <button
                    type="button"
                    onClick={handleAddFolder}
                    className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-4 text-muted-foreground transition hover:border-primary hover:text-foreground"
                  >
                    <FolderPlus className="h-8 w-8" />
                    <span className="text-xs">Add folder</span>
                  </button>
                ) : (
                  <div className="space-y-1">
                    {/* All folders option */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFolderId(null);
                        if (hasBrokenFolders) {
                          reconnectAllFolders();
                        }
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
                      {hasBrokenFolders && (
                        <AlertTriangle className="h-3 w-3 shrink-0 text-yellow-500" />
                      )}
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
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <Folder className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">
                            {folder.name}
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          {folder.needsPermission && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                reconnectFolder(folder.id);
                              }}
                              className="shrink-0 rounded p-0.5 text-yellow-500 hover:bg-yellow-500/10"
                              title="Grant Permission (Browser Restarted)"
                            >
                              <AlertTriangle className="h-3 w-3" />
                            </button>
                          )}
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

          <ResizableHandle />

          {/* Media grid */}
          <ResizablePanel defaultSize={80}>
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
                  <div className="relative w-32 xl:w-40">
                    <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search files..."
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
                    {/* All items view - pre-rendered with Activity */}
                    <Activity mode={filter === "all" ? "visible" : "hidden"}>
                      <div className="absolute inset-0 overflow-auto p-3">
                        <div className="grid grid-cols-4 gap-2">
                          {filteredItems.map((item) => {
                            return (
                              <div key={item.id}>
                                <MediaItemCard
                                  item={item}
                                  isActive={activeMediaItem?.id === item.id}
                                  onSelect={handleSelectMedia}
                                  onAddToService={handleAddToService}
                                  isInsideService={isInsideService}
                                />
                              </div>
                            );
                          })}
                        </div>
                        {/* Empty state overlay */}
                        {filteredItems.length === 0 && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Image className="h-8 w-8" />
                            <span>No items found</span>
                          </div>
                        )}
                      </div>
                    </Activity>
                    {/* Images view - pre-rendered with Activity */}
                    <Activity mode={filter === "images" ? "visible" : "hidden"}>
                      <div className="absolute inset-0 overflow-auto p-3">
                        <div className="grid grid-cols-4 gap-2">
                          {filteredItems
                            .filter((item) => item.type === "image")
                            .map((item) => {
                              return (
                                <div key={item.id}>
                                  <MediaItemCard
                                    item={item}
                                    isActive={activeMediaItem?.id === item.id}
                                    onSelect={handleSelectMedia}
                                    onAddToService={handleAddToService}
                                    isInsideService={isInsideService}
                                  />
                                </div>
                              );
                            })}
                        </div>
                        {/* Empty state overlay */}
                        {imageCount === 0 && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Image className="h-8 w-8" />
                            <span>No images found</span>
                          </div>
                        )}
                      </div>
                    </Activity>
                    {/* Videos view - pre-rendered with Activity */}
                    <Activity mode={filter === "videos" ? "visible" : "hidden"}>
                      <div className="absolute inset-0 overflow-auto p-3">
                        <div className="grid grid-cols-4 gap-2">
                          {filteredItems
                            .filter((item) => item.type === "video")
                            .map((item) => {
                              return (
                                <div key={item.id}>
                                  <MediaItemCard
                                    item={item}
                                    isActive={activeMediaItem?.id === item.id}
                                    onSelect={handleSelectMedia}
                                    onAddToService={handleAddToService}
                                    isInsideService={isInsideService}
                                  />
                                </div>
                              );
                            })}
                        </div>
                        {/* Empty state overlay */}
                        {videoCount === 0 && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Video className="h-8 w-8" />
                            <span>No videos found</span>
                          </div>
                        )}
                      </div>
                    </Activity>
                  </>
                )}
              </div>
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
