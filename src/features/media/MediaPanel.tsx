"use client";

import { memo, useState, Activity } from "react";
import {
  FolderPlus,
  Trash2,
  RefreshCw,
  Image,
  Video,
  Folder,
  Check,
  Monitor,
  Plus,
} from "lucide-react";
import type {
  MediaState,
  MediaItem,
  MediaFolder,
} from "@/hooks/useMediaFolders";
import type { Id } from "@/../convex/_generated/dataModel";
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
              : "border-border hover:border-primary",
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
}

export const MediaPanel = memo(function MediaPanel({
  mediaState,
  onSelectForOutput,
  isInsideService,
  selectedServiceId,
  onAddToService,
}: MediaPanelProps) {
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
  } = mediaState;

  // Compute counts for display (filtered by folder if selected)
  const folderFilteredItems = selectedFolderId
    ? allMediaItems.filter((item) => item.folderId === selectedFolderId)
    : allMediaItems;
  const imageCount = folderFilteredItems.filter(
    (item) => item.type === "image",
  ).length;
  const videoCount = folderFilteredItems.filter(
    (item) => item.type === "video",
  ).length;

  const [filter, setFilter] = useState<MediaFilter>("all");
  const [folderToRemove, setFolderToRemove] = useState<MediaFolder | null>(
    null,
  );

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
        error instanceof Error ? error.message : "Failed to add folder",
      );
    }
  };

  const handleConfirmRemoveFolder = async () => {
    if (!folderToRemove) return;
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
      <div className="flex h-full">
        {/* Folders sidebar */}
        <div className="flex w-48 shrink-0 flex-col border-r border-border">
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

          <div className="flex-1 overflow-auto p-2">
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
                  onClick={() => setSelectedFolderId(null)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition",
                    selectedFolderId === null
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-secondary",
                  )}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">All folders</span>
                  <span className="ml-auto text-[10px] opacity-70">
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
                        : "text-foreground hover:bg-secondary",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedFolderId(folder.id)}
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      <Folder className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{folder.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFolderToRemove(folder)}
                      className="rounded p-0.5 opacity-0 transition hover:bg-destructive/20 group-hover:opacity-100"
                      title="Remove folder"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Media grid */}
        <div className="flex flex-1 flex-col">
          {/* Filter tabs */}
          <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition",
                filter === "all"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              All
              <span className="text-[10px] opacity-70">
                ({folderFilteredItems.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setFilter("images")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition",
                filter === "images"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Image className="h-3 w-3" />
              Images
              <span className="text-[10px] opacity-70">({imageCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter("videos")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition",
                filter === "videos"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Video className="h-3 w-3" />
              Videos
              <span className="text-[10px] opacity-70">({videoCount})</span>
            </button>
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
                      {/* Render ALL items, use CSS hidden for folder filtering */}
                      {allMediaItems.map((item) => {
                        const matchesFolder =
                          !selectedFolderId ||
                          item.folderId === selectedFolderId;
                        return (
                          <div
                            key={item.id}
                            className={cn(!matchesFolder && "hidden")}
                          >
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
                    {folderFilteredItems.length === 0 && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                        <Image className="h-8 w-8" />
                        <span>No media in this folder</span>
                      </div>
                    )}
                  </div>
                </Activity>

                {/* Images view - pre-rendered with Activity */}
                <Activity mode={filter === "images" ? "visible" : "hidden"}>
                  <div className="absolute inset-0 overflow-auto p-3">
                    <div className="grid grid-cols-4 gap-2">
                      {/* Render ALL images, use CSS hidden for folder filtering */}
                      {allMediaItems
                        .filter((item) => item.type === "image")
                        .map((item) => {
                          const matchesFolder =
                            !selectedFolderId ||
                            item.folderId === selectedFolderId;
                          return (
                            <div
                              key={item.id}
                              className={cn(!matchesFolder && "hidden")}
                            >
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
                      {/* Render ALL videos, use CSS hidden for folder filtering */}
                      {allMediaItems
                        .filter((item) => item.type === "video")
                        .map((item) => {
                          const matchesFolder =
                            !selectedFolderId ||
                            item.folderId === selectedFolderId;
                          return (
                            <div
                              key={item.id}
                              className={cn(!matchesFolder && "hidden")}
                            >
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
      </div>

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
});
