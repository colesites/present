"use client";

import { memo, useState } from "react";
import type { Id } from "@/../convex/_generated/dataModel";
import type { Service, Song } from "@/types";
import { Dialog } from "@/components/Dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface ServiceItem {
  type: "song" | "media" | "scripture";
  refId: string;
  label?: string;
  addedAt: number;
  song: Song | null | undefined;
  index: number;
}

interface ServicesSidebarProps {
  services: Service[];
  selectedServiceId: Id<"services"> | null;
  isInsideService: boolean;
  selectedService: Service | null;
  serviceItems: ServiceItem[];
  serviceItemIndex: number | null;
  isLoading?: boolean;
  onEnterService: (id: Id<"services">) => void;
  onExitService: () => void;
  onSelectServiceItem: (index: number) => void;
  onDoubleClickServiceItem?: (index: number) => void;
  onRemoveFromService: (index: number) => void;
  onCreateService: (name: string) => Promise<unknown>;
  onRenameService: (id: Id<"services">, name: string) => Promise<void>;
  onDeleteService: (id: Id<"services">) => Promise<void>;
  onReorderServiceItems?: (fromIndex: number, toIndex: number) => Promise<void>;
  onReorderServices?: (fromIndex: number, toIndex: number) => Promise<void>;
}

export const ServicesSidebar = memo(function ServicesSidebar({
  services,
  selectedServiceId,
  isInsideService,
  selectedService,
  serviceItems,
  serviceItemIndex,
  isLoading = false,
  onEnterService,
  onExitService,
  onSelectServiceItem,
  onDoubleClickServiceItem,
  onRemoveFromService,
  onCreateService,
  onRenameService,
  onDeleteService,
  onReorderServiceItems,
  onReorderServices,
}: ServicesSidebarProps) {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState<{
    id: Id<"services">;
    name: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"services">;
    name: string;
  } | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await onCreateService(newName.trim());
    setNewName("");
    setShowNewDialog(false);
  };

  const handleRename = async () => {
    if (!renameTarget || !renameTarget.name.trim()) return;
    await onRenameService(renameTarget.id, renameTarget.name.trim());
    setRenameTarget(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await onDeleteService(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <aside className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {isInsideService && selectedService
            ? selectedService.name
            : "Services"}
        </p>
        {isInsideService && (
          <button
            type="button"
            onClick={onExitService}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
        )}
      </div>

      <div className="flex-1 overflow-hidden p-2">
        {isLoading ? (
          <ServiceListSkeleton />
        ) : isInsideService && selectedService ? (
          <ServiceItemsList
            items={serviceItems}
            selectedIndex={serviceItemIndex}
            onSelect={onSelectServiceItem}
            onDoubleClick={onDoubleClickServiceItem}
            onRemove={onRemoveFromService}
            onReorder={onReorderServiceItems}
          />
        ) : (
          <ServiceList
            services={services}
            selectedId={selectedServiceId}
            onEnter={onEnterService}
            onRename={(id, name) => setRenameTarget({ id, name })}
            onDelete={(id, name) => setDeleteTarget({ id, name })}
            onReorder={onReorderServices}
          />
        )}
      </div>

      {!isInsideService && (
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={() => setShowNewDialog(true)}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition hover:border-primary hover:text-primary"
          >
            + New service
          </button>
        </div>
      )}

      {/* New Service Dialog */}
      {showNewDialog && (
        <Dialog title="New service" onClose={() => setShowNewDialog(false)}>
          <div className="space-y-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Service name"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowNewDialog(false)}
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
      )}

      {/* Rename Dialog */}
      {renameTarget && (
        <Dialog title="Rename service" onClose={() => setRenameTarget(null)}>
          <div className="space-y-3">
            <input
              value={renameTarget.name}
              onChange={(e) =>
                setRenameTarget({ ...renameTarget, name: e.target.value })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="flex-1 rounded-md border border-input py-2 text-xs font-medium text-foreground hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRename}
                className="flex-1 rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Save
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Delete Dialog */}
      {deleteTarget && (
        <Dialog title="Delete service" onClose={() => setDeleteTarget(null)}>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete "{deleteTarget.name}"?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 rounded-md border border-input py-2 text-xs font-medium text-foreground hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="flex-1 rounded-md bg-destructive py-2 text-xs font-semibold text-white hover:bg-destructive/90"
              >
                Delete
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </aside>
  );
});

// Sub-components
const ServiceList = memo(function ServiceList({
  services,
  selectedId,
  onEnter,
  onRename,
  onDelete,
  onReorder,
}: {
  services: Service[];
  selectedId: Id<"services"> | null;
  onEnter: (id: Id<"services">) => void;
  onRename: (id: Id<"services">, name: string) => void;
  onDelete: (id: Id<"services">, name: string) => void;
  onReorder?: (fromIndex: number, toIndex: number) => Promise<void>;
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggedIndex !== null && index !== draggedIndex) {
      setDropTargetIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDropTargetIndex(null);
  };

  const handleDrop = async (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = draggedIndex;
    setDraggedIndex(null);
    setDropTargetIndex(null);
    if (fromIndex !== null && fromIndex !== toIndex && onReorder) {
      await onReorder(fromIndex, toIndex);
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDropTargetIndex(null);
  };

  return (
    <div className="space-y-1">
      {services.map((service, index) => (
        <ContextMenu key={service._id}>
          <ContextMenuTrigger asChild>
            <div
              draggable={!!onReorder}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={cn(
                "group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition",
                selectedId === service._id
                  ? "bg-primary/20 text-primary"
                  : "text-foreground hover:bg-secondary",
                draggedIndex === index && "opacity-50",
                dropTargetIndex === index && "ring-2 ring-primary ring-inset",
                onReorder && "cursor-grab active:cursor-grabbing"
              )}
            >
              {onReorder && (
                <span className="text-muted-foreground/50 shrink-0">
                  <GripIcon />
                </span>
              )}
              <button
                type="button"
                onClick={() => onEnter(service._id)}
                className="flex flex-1 min-w-0 items-center gap-2 text-left"
              >
                <FolderIcon />
                <span className="flex-1 truncate">{service.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {service.items.length}
                </span>
              </button>
              <button
                type="button"
                aria-label="Rename service"
                onClick={() => onRename(service._id, service.name)}
                className="shrink-0 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
              >
                <EditIcon />
              </button>
              <button
                type="button"
                aria-label="Delete service"
                onClick={() => onDelete(service._id, service.name)}
                className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
              >
                <TrashIcon />
              </button>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-32">
            <ContextMenuItem
              inset
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(service._id, service.name)}
            >
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </div>
  );
});

const ServiceItemsList = memo(function ServiceItemsList({
  items,
  selectedIndex,
  onSelect,
  onDoubleClick,
  onRemove,
  onReorder,
}: {
  items: ServiceItem[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onDoubleClick?: (index: number) => void;
  onRemove: (index: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => Promise<void>;
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggedIndex !== null && index !== draggedIndex) {
      setDropTargetIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDropTargetIndex(null);
  };

  const handleDrop = async (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = draggedIndex;
    setDraggedIndex(null);
    setDropTargetIndex(null);
    if (fromIndex !== null && fromIndex !== toIndex && onReorder) {
      await onReorder(fromIndex, toIndex);
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDropTargetIndex(null);
  };

  if (items.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground px-2">
        No items. Add songs or media from below.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {items.map((item) => {
        // Determine display name and icon based on type
        let displayName = item.refId;
        let icon = <MusicIcon />;

        if (item.type === "song") {
          displayName = item.song?.title ?? item.refId;
          icon = <MusicIcon />;
        } else if (item.type === "media") {
          displayName = item.label ?? item.refId;
          // Check if it's a video or image based on extension or label
          const isVideo = /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(displayName);
          icon = isVideo ? <VideoIcon /> : <ImageIcon />;
        } else if (item.type === "scripture") {
          displayName = item.label ?? "Scripture";
          icon = <BookIcon />;
        }

        return (
          <ContextMenu key={`${item.refId}-${item.index}`}>
            <ContextMenuTrigger asChild>
              <div
                draggable={!!onReorder}
                onDragStart={(e) => handleDragStart(e, item.index)}
                onDragOver={(e) => handleDragOver(e, item.index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, item.index)}
                onDragEnd={handleDragEnd}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition",
                  selectedIndex === item.index
                    ? "bg-primary/20 text-primary"
                    : "text-foreground hover:bg-secondary",
                  draggedIndex === item.index && "opacity-50",
                  dropTargetIndex === item.index &&
                    "ring-2 ring-primary ring-inset",
                  onReorder && "cursor-grab active:cursor-grabbing"
                )}
              >
                {onReorder && (
                  <span className="text-muted-foreground/50 shrink-0">
                    <GripIcon />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onSelect(item.index)}
                  onDoubleClick={() => onDoubleClick?.(item.index)}
                  className="flex flex-1 min-w-0 items-center gap-2 text-left"
                >
                  <span className="w-4 text-[10px] text-muted-foreground">
                    {item.index + 1}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{icon}</span>
                  <span className="flex-1 truncate">{displayName}</span>
                </button>
                <button
                  type="button"
                  aria-label="Remove from service"
                  onClick={() => onRemove(item.index)}
                  className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                >
                  <CloseIcon />
                </button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-32">
              <ContextMenuItem
                inset
                className="text-destructive focus:text-destructive"
                onClick={() => onRemove(item.index)}
              >
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
});

// Icons
function GripIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="9" cy="6" r="1.5" fill="currentColor" />
      <circle cx="15" cy="6" r="1.5" fill="currentColor" />
      <circle cx="9" cy="12" r="1.5" fill="currentColor" />
      <circle cx="15" cy="12" r="1.5" fill="currentColor" />
      <circle cx="9" cy="18" r="1.5" fill="currentColor" />
      <circle cx="15" cy="18" r="1.5" fill="currentColor" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
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
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function MusicIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  );
}

// Skeleton loading component
function ServiceListSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-md px-2 py-1.5"
        >
          <Skeleton className="h-3 w-3 shrink-0" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-4 shrink-0" />
        </div>
      ))}
    </div>
  );
}
