"use client";

import { memo, useMemo, useState } from "react";
import type { DragEvent } from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  NotebookPen,
  Plus,
  Settings2,
} from "lucide-react";
import type { Service, LibraryItem, ServiceGroup } from "../../shared/types";
import type { MediaItem } from "../media/hooks";
import type { ServiceTemplate } from "./hooks/useServices";
import {
  getServiceTemplateItemLayoutKey,
  normalizeServiceLayout,
} from "./hooks/useServices";
import { resolveRowDropLineIndex } from "./lib/service-layout.mjs";
import { Dialog } from "../../renderer/shared/components/Dialog";
import { Skeleton } from "../../renderer/shared/components/ui/skeleton";
import { cn } from "../../renderer/shared/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../renderer/shared/components/ui/context-menu";

interface ServiceItem {
  type: "library" | "media" | "scripture" | "presentation" | "group";
  refId: string;
  label?: string;
  labelIsCustom?: boolean;
  groupId?: string | null;
  addedAt: number;
  presentation?: {
    title: string;
    sourceType: "pdf" | "pptx";
  } | null;
  libraryItem: LibraryItem | null | undefined;
  index: number;
}

interface ServicesSidebarProps {
  services: Service[];
  selectedServiceId: Id<"services"> | null;
  isInsideService: boolean;
  selectedService: Service | null;
  serviceItems: ServiceItem[];
  serviceGroups?: ServiceGroup[];
  serviceTemplates: ServiceTemplate[];
  selectedServiceTemplateId: string | null;
  templateLibraryItems: LibraryItem[];
  templateMediaItems: MediaItem[];
  serviceItemIndex: number | null;
  selectedServiceGroupId: string | null;
  isLoading?: boolean;
  onEnterService: (id: Id<"services">) => void;
  onExitService: () => void;
  onSelectServiceItem: (index: number) => void;
  onSelectServiceGroup: (groupId: string | null) => void;
  onDoubleClickServiceItem?: (index: number) => void;
  onOpenMiniEditor?: (libraryId: string) => void;
  onRemoveFromService: (index: number) => void;
  onAddGroupToService: (label: string) => Promise<void>;
  onRenameServiceGroup: (groupId: string, label: string) => Promise<void>;
  onDeleteServiceGroup: (groupId: string) => Promise<void>;
  onMoveServiceItemToGroup: (
    index: number,
    groupId: string | null,
    toIndex?: number,
  ) => Promise<void>;
  onReorderServiceGroup: (groupId: string, toLayoutIndex: number) => Promise<void>;
  onRenameServiceItem: (index: number, label: string) => Promise<void>;
  onSelectServiceTemplate: (templateId: string | null) => void;
  onCreateServiceTemplate: (name: string) => string | null;
  onRenameServiceTemplate: (templateId: string, name: string) => void;
  onAddGroupToServiceTemplate: (templateId: string, label: string) => string | null;
  onRenameServiceTemplateGroup: (
    templateId: string,
    groupId: string,
    label: string,
  ) => void;
  onDeleteServiceTemplateGroup: (templateId: string, groupId: string) => void;
  onAddItemToServiceTemplate: (
    templateId: string,
    item: Omit<Service["items"][number], "addedAt">,
  ) => void;
  onRemoveItemFromServiceTemplate: (templateId: string, index: number) => void;
  onMoveServiceTemplateItemToGroup: (
    templateId: string,
    index: number,
    groupId: string | null,
    toIndex?: number,
  ) => void;
  onReorderServiceTemplateGroup: (
    templateId: string,
    groupId: string,
    targetGroupId: string,
    position: "before" | "after",
  ) => void;
  onDeleteServiceTemplate: (templateId: string) => void;
  onCreateService: (name: string, templateId?: string | null) => Promise<unknown>;
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
  serviceGroups = [],
  serviceTemplates,
  selectedServiceTemplateId,
  templateLibraryItems,
  templateMediaItems,
  serviceItemIndex,
  selectedServiceGroupId,
  isLoading = false,
  onEnterService,
  onExitService,
  onSelectServiceItem,
  onSelectServiceGroup,
  onDoubleClickServiceItem,
  onOpenMiniEditor,
  onRemoveFromService,
  onAddGroupToService,
  onRenameServiceGroup,
  onDeleteServiceGroup,
  onMoveServiceItemToGroup,
  onReorderServiceGroup,
  onRenameServiceItem,
  onSelectServiceTemplate,
  onCreateServiceTemplate,
  onRenameServiceTemplate,
  onAddGroupToServiceTemplate,
  onRenameServiceTemplateGroup,
  onDeleteServiceTemplateGroup,
  onAddItemToServiceTemplate,
  onRemoveItemFromServiceTemplate,
  onMoveServiceTemplateItemToGroup,
  onReorderServiceTemplateGroup,
  onDeleteServiceTemplate,
  onCreateService,
  onRenameService,
  onDeleteService,
  onReorderServiceItems,
  onReorderServices,
}: ServicesSidebarProps) {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newServiceTemplateId, setNewServiceTemplateId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    id: Id<"services">;
    name: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"services">;
    name: string;
  } | null>(null);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await onCreateService(newName.trim(), newServiceTemplateId);
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

  const handleCreateGroup = async () => {
    if (!groupName.trim()) return;
    await onAddGroupToService(groupName.trim());
    setGroupName("");
    setShowGroupDialog(false);
  };

  const openTemplateDialog = () => {
    setShowTemplateDialog(true);
  };

  const openNewServiceDialog = () => {
    setNewServiceTemplateId(selectedServiceTemplateId ?? serviceTemplates[0]?.id ?? null);
    setShowNewDialog(true);
  };

  const handleCreateTemplate = () => {
    if (!templateName.trim()) return;
    const templateId = onCreateServiceTemplate(templateName.trim());
    if (templateId) {
      onSelectServiceTemplate(templateId);
      setTemplateName("");
    }
  };

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            {isInsideService ? (
              <button
                type="button"
                onClick={onExitService}
                className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground transition hover:text-foreground"
                aria-label="Back"
                title="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : null}
            <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {isInsideService && selectedService ? selectedService.name : "Services"}
            </p>
          </div>

          {!isInsideService ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openTemplateDialog}
                className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground transition hover:text-primary"
                aria-label="Service template"
                title="Service template"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={openNewServiceDialog}
                className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground transition hover:text-primary"
                aria-label="Add service"
                title="Add service"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openTemplateDialog}
                className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground transition hover:text-primary"
                aria-label="Service templates"
                title="Service templates"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowGroupDialog(true)}
                className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground transition hover:text-primary"
                aria-label="Add group"
                title="Add group"
              >
                <Folder className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] text-muted-foreground">
                {serviceItems.length} item{serviceItems.length === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {isLoading ? (
          <ServiceListSkeleton />
        ) : isInsideService && selectedService ? (
          <ServiceItemsList
            items={serviceItems}
            groups={serviceGroups}
            selectedIndex={serviceItemIndex}
            selectedGroupId={selectedServiceGroupId}
            onSelect={onSelectServiceItem}
            onSelectGroup={onSelectServiceGroup}
            onDoubleClick={onDoubleClickServiceItem}
            onOpenMiniEditor={onOpenMiniEditor}
            onRemove={onRemoveFromService}
            onRenameGroup={onRenameServiceGroup}
            onDeleteGroup={onDeleteServiceGroup}
            onMoveToGroup={onMoveServiceItemToGroup}
            onReorderGroup={onReorderServiceGroup}
            onRenameItem={onRenameServiceItem}
            onReorder={onReorderServiceItems}
            layout={selectedService.layout ?? []}
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

      {/* New Service Dialog */}
      {showNewDialog && (
        <Dialog title="New service" onClose={() => setShowNewDialog(false)}>
          <div className="space-y-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Service name"
              aria-label="Service name"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Template
              </span>
              <select
                value={newServiceTemplateId ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setNewServiceTemplateId(value || null);
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="">None</option>
                {serviceTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
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

      {showGroupDialog && (
        <Dialog title="New group" onClose={() => setShowGroupDialog(false)}>
          <div className="space-y-3">
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name"
              aria-label="Group name"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowGroupDialog(false)}
                className="flex-1 rounded-md border border-input py-2 text-xs font-medium text-foreground hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateGroup}
                className="flex-1 rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Create
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {showTemplateDialog && (
        <Dialog
          title="Service templates"
          onClose={() => setShowTemplateDialog(false)}
          contentClassName="w-[min(980px,calc(100vw-64px))] max-w-none"
        >
          <ServiceTemplateEditor
            templates={serviceTemplates}
            selectedTemplateId={selectedServiceTemplateId}
            libraryItems={templateLibraryItems}
            mediaItems={templateMediaItems}
            newTemplateName={templateName}
            onNewTemplateNameChange={setTemplateName}
            onCreateTemplate={handleCreateTemplate}
            onSelectTemplate={onSelectServiceTemplate}
            onRenameTemplate={onRenameServiceTemplate}
            onDeleteTemplate={onDeleteServiceTemplate}
            onAddGroup={onAddGroupToServiceTemplate}
            onRenameGroup={onRenameServiceTemplateGroup}
            onDeleteGroup={onDeleteServiceTemplateGroup}
            onAddItem={onAddItemToServiceTemplate}
            onRemoveItem={onRemoveItemFromServiceTemplate}
            onMoveItemToGroup={onMoveServiceTemplateItemToGroup}
            onReorderGroup={onReorderServiceTemplateGroup}
          />
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
              aria-label="Service name"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
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
const ServiceTemplateEditor = memo(function ServiceTemplateEditor({
  templates,
  selectedTemplateId,
  libraryItems,
  mediaItems,
  newTemplateName,
  onNewTemplateNameChange,
  onCreateTemplate,
  onSelectTemplate,
  onRenameTemplate,
  onDeleteTemplate,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
  onAddItem,
  onRemoveItem,
  onMoveItemToGroup,
  onReorderGroup,
}: {
  templates: ServiceTemplate[];
  selectedTemplateId: string | null;
  libraryItems: LibraryItem[];
  mediaItems: MediaItem[];
  newTemplateName: string;
  onNewTemplateNameChange: (value: string) => void;
  onCreateTemplate: () => void;
  onSelectTemplate: (templateId: string | null) => void;
  onRenameTemplate: (templateId: string, name: string) => void;
  onDeleteTemplate: (templateId: string) => void;
  onAddGroup: (templateId: string, label: string) => string | null;
  onRenameGroup: (templateId: string, groupId: string, label: string) => void;
  onDeleteGroup: (templateId: string, groupId: string) => void;
  onAddItem: (
    templateId: string,
    item: Omit<Service["items"][number], "addedAt">,
  ) => void;
  onRemoveItem: (templateId: string, index: number) => void;
  onMoveItemToGroup: (
    templateId: string,
    index: number,
    groupId: string | null,
    toIndex?: number,
  ) => void;
  onReorderGroup: (
    templateId: string,
    groupId: string,
    targetGroupId: string,
    position: "before" | "after",
  ) => void;
}) {
  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) ??
    templates[0] ??
    null;
  const [groupName, setGroupName] = useState("");
  const orderedGroups = useMemo(
    () =>
      selectedTemplate
        ? [...selectedTemplate.groups].sort((left, right) => left.order - right.order)
        : [],
    [selectedTemplate],
  );

  const groupedItems = useMemo(
    () => {
      const buckets = new Map<
        string,
        { item: ServiceTemplate["items"][number]; index: number }[]
      >();
      for (const group of orderedGroups) {
        buckets.set(group.id, []);
      }
      selectedTemplate?.items.forEach((item, index) => {
        if (!item.groupId) return;
        buckets.get(item.groupId)?.push({ item, index });
      });
      return orderedGroups.map((group) => ({
        group,
        items: buckets.get(group.id) ?? [],
      }));
    },
    [orderedGroups, selectedTemplate],
  );
  const ungroupedItems = useMemo(
    () => {
      const groupIds = new Set(orderedGroups.map((group) => group.id));
      const items: { item: ServiceTemplate["items"][number]; index: number }[] = [];
      selectedTemplate?.items.forEach((item, index) => {
        if (!item.groupId || !groupIds.has(item.groupId)) {
          items.push({ item, index });
        }
      });
      return items;
    },
    [orderedGroups, selectedTemplate],
  );
  const templateRows = useMemo(() => {
    const rows: Array<
      | { type: "item"; item: ServiceTemplate["items"][number]; index: number }
      | {
          type: "group";
          group: ServiceGroup;
          items: { item: ServiceTemplate["items"][number]; index: number }[];
        }
    > = [];
    if (!selectedTemplate) return rows;

    const groupedItemsByGroupId = new Map(
      groupedItems.map((entry) => [entry.group.id, entry.items]),
    );
    const groupsById = new Map(orderedGroups.map((group) => [group.id, group]));
    const ungroupedItemsByKey = new Map(
      ungroupedItems.map((entry) => [
        getServiceTemplateItemLayoutKey(entry.item),
        entry,
      ]),
    );
    const seenGroups = new Set<string>();
    const seenItems = new Set<string>();

    for (const entry of selectedTemplate.layout ?? []) {
      if (entry.type === "group") {
        const group = groupsById.get(entry.id);
        if (!group || seenGroups.has(group.id)) continue;
        seenGroups.add(group.id);
        rows.push({
          type: "group",
          group,
          items: groupedItemsByGroupId.get(group.id) ?? [],
        });
        continue;
      }

      const itemEntry = ungroupedItemsByKey.get(entry.key);
      if (!itemEntry || seenItems.has(entry.key)) continue;
      seenItems.add(entry.key);
      rows.push({ type: "item", ...itemEntry });
    }

    for (const group of orderedGroups) {
      if (seenGroups.has(group.id)) continue;
      seenGroups.add(group.id);
      rows.push({
        type: "group",
        group,
        items: groupedItemsByGroupId.get(group.id) ?? [],
      });
    }

    for (const entry of ungroupedItems) {
      const key = getServiceTemplateItemLayoutKey(entry.item);
      if (seenItems.has(key)) continue;
      seenItems.add(key);
      rows.push({ type: "item", ...entry });
    }

    return rows;
  }, [groupedItems, orderedGroups, selectedTemplate, ungroupedItems]);
  const templateItemDisplayNumbers = useMemo(() => {
    const numbers = new Map<number, number>();
    let nextNumber = 1;
    for (const row of templateRows) {
      if (row.type === "item") {
        numbers.set(row.index, nextNumber);
        nextNumber += 1;
        continue;
      }
      for (const { index } of row.items) {
        numbers.set(index, nextNumber);
        nextNumber += 1;
      }
    }
    return numbers;
  }, [templateRows]);
  const [draggedTemplateItemIndex, setDraggedTemplateItemIndex] =
    useState<number | null>(null);
  const [draggedTemplateGroupId, setDraggedTemplateGroupId] = useState<string | null>(
    null,
  );
  const [templateDropTarget, setTemplateDropTarget] = useState<string | null>(null);
  const templateItemDragKey = "application/x-present-template-item-index";
  const templateGroupDragKey = "application/x-present-template-group-id";

  const handleAddGroup = () => {
    if (!selectedTemplate || !groupName.trim()) return;
    onAddGroup(selectedTemplate.id, groupName.trim());
    setGroupName("");
  };

  const clearTemplateDrag = () => {
    setDraggedTemplateItemIndex(null);
    setDraggedTemplateGroupId(null);
    setTemplateDropTarget(null);
  };

  const getDraggedTemplateItemIndex = (event: DragEvent<HTMLElement>) => {
    const rawValue =
      event.dataTransfer.getData(templateItemDragKey) ||
      event.dataTransfer.getData("text/plain");
    const parsed = Number.parseInt(rawValue, 10);
    return draggedTemplateItemIndex ?? (Number.isFinite(parsed) ? parsed : null);
  };

  const getDraggedTemplateGroupId = (event: DragEvent<HTMLElement>) =>
    draggedTemplateGroupId ||
    event.dataTransfer.getData(templateGroupDragKey) ||
    null;

  const handleTemplateTopLevelDrop = (
    event: DragEvent<HTMLDivElement>,
    toLayoutIndex: number,
    boundaryGroup?: { groupId: string; position: "before" | "after" },
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedTemplate) return;
    const itemIndex = getDraggedTemplateItemIndex(event);
    const draggedGroupId = getDraggedTemplateGroupId(event);
    clearTemplateDrag();
    if (itemIndex !== null) {
      onMoveItemToGroup(selectedTemplate.id, itemIndex, null, toLayoutIndex);
      return;
    }
    if (draggedGroupId && boundaryGroup) {
      onReorderGroup(
        selectedTemplate.id,
        draggedGroupId,
        boundaryGroup.groupId,
        boundaryGroup.position,
      );
    }
  };

  const handleTemplateGroupDrop = (
    event: DragEvent<HTMLDivElement>,
    groupId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedTemplate) return;
    const itemIndex = getDraggedTemplateItemIndex(event);
    clearTemplateDrag();
    if (itemIndex !== null) {
      onMoveItemToGroup(selectedTemplate.id, itemIndex, groupId);
    }
  };

  const handleTemplateItemDrop = (
    event: DragEvent<HTMLDivElement>,
    targetIndex: number,
    targetGroupId: string | null,
    targetLayoutIndex?: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedTemplate) return;
    const itemIndex = getDraggedTemplateItemIndex(event);
    clearTemplateDrag();
    if (itemIndex !== null && itemIndex !== targetIndex) {
      onMoveItemToGroup(
        selectedTemplate.id,
        itemIndex,
        targetGroupId,
        targetGroupId === null ? targetLayoutIndex : targetIndex,
      );
    }
  };

  return (
    <div className="grid h-[min(76vh,680px)] min-h-[520px] w-full grid-cols-[240px_minmax(0,1fr)] overflow-hidden rounded-md border border-border/70">
      <div className="flex min-h-0 flex-col border-r border-border bg-background/70 p-4">
        <div className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Templates
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose the default structure for new services.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelectTemplate(template.id)}
              className={cn(
                "w-full rounded-md border px-3 py-2.5 text-left transition",
                selectedTemplate?.id === template.id
                  ? "border-primary/70 bg-primary/10 text-primary shadow-[inset_3px_0_0_hsl(var(--primary))]"
                  : "border-transparent bg-transparent text-foreground hover:border-border hover:bg-secondary/60",
              )}
            >
              <span className="block truncate text-sm font-semibold">
                {template.name}
              </span>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {template.groups.length} group
                {template.groups.length === 1 ? "" : "s"} · {template.items.length} item
                {template.items.length === 1 ? "" : "s"}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-2 border-t border-border pt-3">
          <input
            aria-label="New service template name"
            value={newTemplateName}
            onChange={(event) => onNewTemplateNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCreateTemplate();
            }}
            placeholder="Template name"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={onCreateTemplate}
            disabled={!newTemplateName.trim()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            New template
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-col bg-card">
        {!selectedTemplate ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Create a template to begin.
          </div>
        ) : (
          <>
            <div className="border-b border-border px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Template
                  </span>
                  <input
                    aria-label="Service template name"
                    key={selectedTemplate.id}
                    defaultValue={selectedTemplate.name}
                    onBlur={(event) =>
                      onRenameTemplate(
                        selectedTemplate.id,
                        event.currentTarget.value,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-base font-semibold text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteTemplate(selectedTemplate.id)}
                  className="mt-5 rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:border-destructive/50 hover:text-destructive"
                >
                  Delete
                </button>
              </div>

              <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                <label className="min-w-0">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Add group
                  </span>
                  <input
                    aria-label="New service template group name"
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleAddGroup();
                    }}
                    placeholder="Announcements"
                    className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleAddGroup}
                  disabled={!groupName.trim()}
                  className="h-9 rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
              <div className="space-y-1">
                {templateRows.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground">
                    Add groups, songs, scripture, or media to this template.
                  </p>
                ) : null}

                {templateRows.map((row, rowIndex) => {
                  const boundary =
                    row.type === "group"
                      ? {
                          groupId: row.group.id,
                          position: "before" as const,
                        }
                      : undefined;
                  const rowKey =
                    row.type === "group"
                      ? `group:${row.group.id}`
                      : `item:${getTemplateItemKey(row.item)}`;
                  if (row.type === "item") {
                    return (
                      <div key={rowKey}>
                        <TemplateDropLine
                          active={templateDropTarget === `layout:${rowIndex}`}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setTemplateDropTarget(`layout:${rowIndex}`);
                          }}
                          onDrop={(event) =>
                            handleTemplateTopLevelDrop(event, rowIndex)
                          }
                        />
                        <TemplateItemRow
                          item={row.item}
                          index={row.index}
                          displayNumber={templateItemDisplayNumbers.get(row.index)}
                          groups={orderedGroups}
                          libraryItems={libraryItems}
                          mediaItems={mediaItems}
                          isDragging={draggedTemplateItemIndex === row.index}
                          isDropTarget={templateDropTarget === `item:${row.index}`}
                          dragDataKey={templateItemDragKey}
                          onDragStart={() => setDraggedTemplateItemIndex(row.index)}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setTemplateDropTarget(`item:${row.index}`);
                          }}
                          onDrop={(event) =>
                            handleTemplateItemDrop(
                              event,
                              row.index,
                              row.item.groupId ?? null,
                              rowIndex,
                            )
                          }
                          onDragEnd={clearTemplateDrag}
                          onMove={(groupId) =>
                            onMoveItemToGroup(selectedTemplate.id, row.index, groupId)
                          }
                          onRemove={() => onRemoveItem(selectedTemplate.id, row.index)}
                        />
                      </div>
                    );
                  }

                  return (
                    <div key={rowKey}>
                      <TemplateDropLine
                        active={templateDropTarget === `layout:${rowIndex}`}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setTemplateDropTarget(`layout:${rowIndex}`);
                        }}
                        onDrop={(event) =>
                          handleTemplateTopLevelDrop(event, rowIndex, boundary)
                        }
                      />
                      <div
                        draggable
                        onDragStart={(event) => {
                          setDraggedTemplateGroupId(row.group.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(templateGroupDragKey, row.group.id);
                          event.dataTransfer.setData("text/plain", row.group.id);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setTemplateDropTarget(`group:${row.group.id}`);
                        }}
                        onDrop={(event) => handleTemplateGroupDrop(event, row.group.id)}
                        onDragEnd={clearTemplateDrag}
                        className={cn(
                          "rounded-md border border-transparent transition",
                          templateDropTarget === `group:${row.group.id}` &&
                            "border-primary/70 bg-primary/10",
                          draggedTemplateGroupId === row.group.id && "opacity-50",
                        )}
                      >
                        <div className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-secondary/60">
                          <span className="shrink-0 cursor-grab text-muted-foreground/50 active:cursor-grabbing">
                            <GripIcon />
                          </span>
                          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <input
                            aria-label="Service template group name"
                            key={row.group.id}
                            defaultValue={row.group.name}
                            onBlur={(event) =>
                              onRenameGroup(
                                selectedTemplate.id,
                                row.group.id,
                                event.currentTarget.value,
                              )
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") event.currentTarget.blur();
                            }}
                            className="min-w-0 flex-1 bg-transparent text-xs font-semibold uppercase tracking-widest text-muted-foreground outline-none focus:text-foreground"
                          />
                          <span className="text-[10px] font-semibold text-muted-foreground">
                            {row.items.length}
                          </span>
                          <button
                            type="button"
                            onClick={() => onDeleteGroup(selectedTemplate.id, row.group.id)}
                            className="text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                            aria-label="Delete template group"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                        <div className="space-y-1 pl-7">
                          {row.items.map(({ item, index }) => (
                            <TemplateItemRow
                              key={getTemplateItemKey(item)}
                              item={item}
                              index={index}
                              displayNumber={templateItemDisplayNumbers.get(index)}
                              groups={orderedGroups}
                              libraryItems={libraryItems}
                              mediaItems={mediaItems}
                              isDragging={draggedTemplateItemIndex === index}
                              isDropTarget={templateDropTarget === `item:${index}`}
                              dragDataKey={templateItemDragKey}
                              onDragStart={() => setDraggedTemplateItemIndex(index)}
                              onDragOver={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setTemplateDropTarget(`item:${index}`);
                              }}
                              onDrop={(event) =>
                                handleTemplateItemDrop(
                                  event,
                                  index,
                                  item.groupId ?? null,
                                )
                              }
                              onDragEnd={clearTemplateDrag}
                              onMove={(groupId) =>
                                onMoveItemToGroup(selectedTemplate.id, index, groupId)
                              }
                              onRemove={() => onRemoveItem(selectedTemplate.id, index)}
                            />
                          ))}
                          <AddTemplateItemControl
                            groupId={row.group.id}
                            templateId={selectedTemplate.id}
                            libraryItems={libraryItems}
                            mediaItems={mediaItems}
                            onAddItem={onAddItem}
                          />
                        </div>
                      </div>
                      <TemplateDropLine
                        active={
                          templateDropTarget === `layout:${rowIndex + 1}:after`
                        }
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setTemplateDropTarget(`layout:${rowIndex + 1}:after`);
                        }}
                        onDrop={(event) =>
                          handleTemplateTopLevelDrop(event, rowIndex + 1, {
                            groupId: row.group.id,
                            position: "after",
                          })
                        }
                      />
                    </div>
                  );
                })}

                {templateRows.length > 0 ? (
                  <TemplateDropLine
                    active={templateDropTarget === `layout:${templateRows.length}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setTemplateDropTarget(`layout:${templateRows.length}`);
                    }}
                    onDrop={(event) =>
                      handleTemplateTopLevelDrop(event, templateRows.length)
                    }
                  />
                ) : null}

                <AddTemplateItemControl
                  groupId={null}
                  templateId={selectedTemplate.id}
                  libraryItems={libraryItems}
                  mediaItems={mediaItems}
                  onAddItem={onAddItem}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

function AddTemplateItemControl({
  groupId,
  templateId,
  libraryItems,
  mediaItems,
  onAddItem,
}: {
  groupId: string | null;
  templateId: string;
  libraryItems: LibraryItem[];
  mediaItems: MediaItem[];
  onAddItem: (
    templateId: string,
    item: Omit<Service["items"][number], "addedAt">,
  ) => void;
}) {
  const [itemType, setItemType] = useState<"library" | "media" | "scripture">(
    "library",
  );
  const [selectedLibraryId, setSelectedLibraryId] = useState("");
  const [selectedMediaId, setSelectedMediaId] = useState("");
  const [scriptureLabel, setScriptureLabel] = useState("");

  const handleAddItem = () => {
    if (itemType === "library") {
      const libraryId = selectedLibraryId || String(libraryItems[0]?._id ?? "");
      const libraryItem = libraryItems.find(
        (item) => String(item._id) === libraryId,
      );
      if (!libraryItem) return;
      onAddItem(templateId, {
        type: "library",
        refId: String(libraryItem._id),
        label: libraryItem.title,
        groupId,
      });
      setSelectedLibraryId("");
      return;
    }

    if (itemType === "media") {
      const mediaId = selectedMediaId || mediaItems[0]?.id || "";
      const mediaItem = mediaItems.find((item) => item.id === mediaId);
      if (!mediaItem) return;
      onAddItem(templateId, {
        type: "media",
        refId: mediaItem.id,
        label: mediaItem.name,
        groupId,
      });
      setSelectedMediaId("");
      return;
    }

    if (!scriptureLabel.trim()) return;
    onAddItem(templateId, {
      type: "scripture",
      refId: scriptureLabel.trim(),
      label: scriptureLabel.trim(),
      groupId,
    });
    setScriptureLabel("");
  };

  return (
    <div className="mt-2 rounded-md border border-border/70 bg-muted/15 p-2">
      <div className="grid grid-cols-[112px_minmax(0,1fr)_auto] gap-2">
      <select
        aria-label="Template item type"
        value={itemType}
        onChange={(event) =>
          setItemType(event.target.value as "library" | "media" | "scripture")
        }
        className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none"
      >
        <option value="library">Library</option>
        <option value="media">Media</option>
        <option value="scripture">Scripture</option>
      </select>

      {itemType === "library" ? (
        <select
          aria-label="Library item to add"
          value={selectedLibraryId}
          onChange={(event) => setSelectedLibraryId(event.target.value)}
          className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none"
        >
          <option value="">Select library item</option>
          {libraryItems.map((item) => (
            <option key={String(item._id)} value={String(item._id)}>
              {item.title}
            </option>
          ))}
        </select>
      ) : null}

      {itemType === "media" ? (
        <div className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground">
          <span className="flex h-full items-center truncate">
            {selectedMediaId
              ? mediaItems.find((item) => item.id === selectedMediaId)?.name
              : "Select media below"}
          </span>
        </div>
      ) : null}

      {itemType === "scripture" ? (
        <input
          aria-label="Scripture reference to add"
          value={scriptureLabel}
          onChange={(event) => setScriptureLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleAddItem();
          }}
          placeholder="John 3:16"
          className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      ) : null}

      <button
        type="button"
        onClick={handleAddItem}
        className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="h-3.5 w-3.5" />
        Add
      </button>
      </div>

      {itemType === "media" ? (
        <div
          className="mt-2 grid max-h-40 min-h-24 grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2 overflow-auto rounded-md border border-border/70 bg-background p-2"
          aria-label="Media item to add"
        >
          {mediaItems.length ? (
            mediaItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedMediaId(item.id)}
                className={cn(
                  "group overflow-hidden rounded-md border text-left transition",
                  selectedMediaId === item.id
                    ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                    : "border-border/70 bg-card hover:border-primary/50",
                )}
              >
                <TemplateMediaPreview item={item} className="aspect-video" />
                <span className="block truncate px-2 py-1.5 text-[10px] font-medium text-foreground">
                  {item.name}
                </span>
              </button>
            ))
          ) : (
            <span className="col-span-full px-2 py-3 text-xs text-muted-foreground">
              No media available.
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TemplateItemRow({
  item,
  index,
  displayNumber,
  groups,
  libraryItems,
  mediaItems,
  isDragging,
  isDropTarget,
  dragDataKey,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMove,
  onRemove,
}: {
  item: ServiceTemplate["items"][number];
  index: number;
  displayNumber?: number;
  groups: ServiceGroup[];
  libraryItems: LibraryItem[];
  mediaItems: MediaItem[];
  isDragging?: boolean;
  isDropTarget?: boolean;
  dragDataKey?: string;
  onDragStart?: () => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  onMove: (groupId: string | null) => void;
  onRemove: () => void;
}) {
  const label = getTemplateItemLabel(item, libraryItems, mediaItems);
  const mediaItem =
    item.type === "media"
      ? mediaItems.find((candidate) => candidate.id === item.refId) ?? null
      : null;

  return (
    <div
      draggable={Boolean(dragDataKey)}
      onDragStart={(event) => {
        if (!dragDataKey) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(dragDataKey, String(index));
        event.dataTransfer.setData("text/plain", String(index));
        onDragStart?.();
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        "group flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition hover:bg-secondary",
        dragDataKey && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50",
        isDropTarget && "bg-primary/10 ring-1 ring-primary/70",
      )}
    >
      {dragDataKey ? (
        <span className="shrink-0 text-muted-foreground/50">
          <GripIcon />
        </span>
      ) : null}
      <span className="w-5 text-right text-[10px] text-muted-foreground">
        {displayNumber ?? index + 1}
      </span>
      <span className="shrink-0 text-muted-foreground">
        {item.type === "library" ? <MusicIcon /> : null}
        {item.type === "media" && !mediaItem ? (
          /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(label) ? <VideoIcon /> : <ImageIcon />
        ) : null}
        {item.type === "scripture" ? <BookIcon /> : null}
        {item.type === "presentation" ? <FolderIcon /> : null}
      </span>
      {mediaItem ? (
        <TemplateMediaPreview
          item={mediaItem}
          className="h-8 w-14 shrink-0 rounded-sm"
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <select
        value={item.groupId ?? ""}
        onChange={(event) => onMove(event.target.value || null)}
        className="h-6 max-w-[120px] rounded border border-border bg-background px-1 text-[10px] text-muted-foreground opacity-0 outline-none focus:opacity-100 group-hover:opacity-100"
        aria-label="Move template item to group"
      >
        <option value="">Standalone</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
        aria-label="Remove template item"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function TemplateMediaPreview({
  item,
  className,
}: {
  item: MediaItem;
  className?: string;
}) {
  if (item.type === "image") {
    return (
      <span
        className={cn("block overflow-hidden bg-black", className)}
        aria-hidden="true"
      >
        <img src={item.url} alt="" className="h-full w-full object-cover" loading="lazy" />
      </span>
    );
  }

  return (
    <span className={cn("relative block overflow-hidden bg-black", className)}>
      <video
        src={item.url}
        className="h-full w-full object-cover"
        aria-label={`${item.name} preview`}
        tabIndex={-1}
        muted
        preload="metadata"
        playsInline
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          try {
            video.currentTime = 0.01;
            video.pause();
          } catch {
            // Some codecs do not allow seeking before enough data is buffered.
          }
        }}
      />
      <span className="pointer-events-none absolute right-1 top-1 rounded bg-black/70 p-0.5 text-white">
        <VideoIcon />
      </span>
    </span>
  );
}

function TemplateDropLine({
  active,
  onDragOver,
  onDrop,
}: {
  active: boolean;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={() => undefined}
      onDrop={onDrop}
      className={cn(
        "h-px rounded-full border border-transparent transition hover:border-border/40",
        active && "h-2 border-primary/70 bg-primary/20",
      )}
      aria-hidden="true"
    />
  );
}

function getTemplateItemLabel(
  item: ServiceTemplate["items"][number],
  libraryItems: LibraryItem[],
  mediaItems: MediaItem[],
) {
  if (item.type === "library") {
    return (
      libraryItems.find((libraryItem) => String(libraryItem._id) === item.refId)
        ?.title ??
      item.label ??
      item.refId
    );
  }
  if (item.type === "media") {
    return (
      mediaItems.find((mediaItem) => mediaItem.id === item.refId)?.name ??
      item.label ??
      item.refId
    );
  }
  if (item.type === "scripture") {
    return item.label ?? item.refId;
  }
  if (item.type === "presentation") {
    return item.presentation?.title ?? item.label ?? "Presentation";
  }
  return item.label ?? item.refId;
}

function getTemplateItemKey(item: ServiceTemplate["items"][number]) {
  return [
    item.type,
    item.refId,
    item.addedAt,
    item.groupId ?? "none",
    item.label ?? "",
  ].join(":");
}

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
  const dragDataKey = "application/x-present-service-index";

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(dragDataKey, String(index));
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
    const droppedIndex = Number.parseInt(
      e.dataTransfer.getData(dragDataKey) || e.dataTransfer.getData("text/plain"),
      10,
    );
    const fromIndex =
      draggedIndex ?? (Number.isFinite(droppedIndex) ? droppedIndex : null);
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
      {services.length === 0 ? (
        <p className="px-2 py-1 text-[10px] text-muted-foreground">
          No services yet. Create one to get started.
        </p>
      ) : null}
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
  groups,
  selectedIndex,
  selectedGroupId,
  onSelect,
  onSelectGroup,
  onDoubleClick,
  onOpenMiniEditor,
  onRemove,
  onRenameGroup,
  onDeleteGroup,
  onMoveToGroup,
  onReorderGroup,
  onRenameItem,
  onReorder,
  layout,
}: {
  items: ServiceItem[];
  groups: ServiceGroup[];
  selectedIndex: number | null;
  selectedGroupId: string | null;
  onSelect: (index: number) => void;
  onSelectGroup: (groupId: string | null) => void;
  onDoubleClick?: (index: number) => void;
  onOpenMiniEditor?: (libraryId: string) => void;
  onRemove: (index: number) => void;
  onRenameGroup: (groupId: string, label: string) => Promise<void>;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onMoveToGroup: (
    index: number,
    groupId: string | null,
    toIndex?: number,
  ) => Promise<void>;
  onReorderGroup: (groupId: string, toLayoutIndex: number) => Promise<void>;
  onRenameItem: (index: number, label: string) => Promise<void>;
  onReorder?: (fromIndex: number, toIndex: number) => Promise<void>;
  layout: NonNullable<Service["layout"]>;
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
  const [dropTargetRowKey, setDropTargetRowKey] = useState<string | null>(null);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [renameGroupTarget, setRenameGroupTarget] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [renameItemTarget, setRenameItemTarget] = useState<{
    index: number;
    label: string;
  } | null>(null);
  const dragDataKey = "application/x-present-service-item-index";
  const groupDragDataKey = "application/x-present-service-group-id";
  // Rows come from the canonical layout rather than the stored one so that a
  // row's position is also its layout index. Deriving them from the stored
  // layout lets the two number spaces drift apart whenever it is partial, and
  // a drop then resolves against a different row than the one aimed at.
  const normalizedLayout = useMemo(
    () => normalizeServiceLayout(layout, groups, items),
    [groups, items, layout],
  );
  const orderedGroups = useMemo(
    () => [...groups].sort((a, b) => a.order - b.order),
    [groups],
  );
  const groupedItems = useMemo(
    () =>
      orderedGroups.map((group) => ({
        group,
        items: items.filter((item) => item.groupId === group.id),
      })),
    [items, orderedGroups],
  );
  const ungroupedItems = useMemo(
    () =>
      items.filter(
        (item) =>
          !item.groupId || !groups.some((group) => group.id === item.groupId),
      ),
    [groups, items],
  );
  const orderedServiceRows = useMemo(() => {
    const rows: Array<
      | { type: "item"; item: ServiceItem; layoutIndex: number }
      | {
          type: "group";
          group: ServiceGroup;
          items: ServiceItem[];
          layoutIndex: number;
        }
    > = [];
    const groupedItemsByGroupId = new Map(
      groupedItems.map((entry) => [entry.group.id, entry.items]),
    );
    const groupsById = new Map(orderedGroups.map((group) => [group.id, group]));
    const ungroupedItemsByKey = new Map(
      ungroupedItems.map((item) => [getServiceTemplateItemLayoutKey(item), item]),
    );

    // The normalized layout already covers every group and ungrouped item
    // exactly once, so every entry becomes one row in order.
    for (const entry of normalizedLayout) {
      if (entry.type === "group") {
        const group = groupsById.get(entry.id);
        if (!group) continue;
        rows.push({
          type: "group",
          group,
          items: groupedItemsByGroupId.get(group.id) ?? [],
          layoutIndex: rows.length,
        });
        continue;
      }

      const item = ungroupedItemsByKey.get(entry.key);
      if (!item) continue;
      rows.push({ type: "item", item, layoutIndex: rows.length });
    }

    return rows;
  }, [groupedItems, normalizedLayout, orderedGroups, ungroupedItems]);

  const itemDisplayNumbers = useMemo(() => {
    const numbers = new Map<number, number>();
    let nextNumber = 1;
    for (const row of orderedServiceRows) {
      if (row.type === "item") {
        numbers.set(row.item.index, nextNumber);
        nextNumber += 1;
        continue;
      }
      for (const item of row.items) {
        numbers.set(item.index, nextNumber);
        nextNumber += 1;
      }
    }
    return numbers;
  }, [orderedServiceRows]);

  const canDropOnRowBoundary = draggedIndex !== null || draggedGroupId !== null;

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(dragDataKey, String(index));
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    // A dragged group only ever lands on a row boundary, never on an item.
    if (draggedGroupId !== null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggedIndex !== null && index !== draggedIndex) {
      setDropTargetIndex(index);
    }
  };

  // A drop lands on a row, but the layout insert wants a drop line. Resolve the
  // dragged row's own position so "take this row's place" survives the trip.
  const toRowDropLineIndex = (
    draggedItemIndex: number,
    targetLayoutIndex: number,
  ) =>
    resolveRowDropLineIndex(
      orderedServiceRows.findIndex(
        (row) => row.type === "item" && row.item.index === draggedItemIndex,
      ),
      targetLayoutIndex,
    );

  const handleDrop = async (
    e: React.DragEvent,
    toIndex: number,
    targetGroupId: string | null,
    targetLayoutIndex?: number,
  ) => {
    e.preventDefault();
    const droppedIndex = Number.parseInt(
      e.dataTransfer.getData(dragDataKey) || e.dataTransfer.getData("text/plain"),
      10,
    );
    const fromIndex =
      draggedIndex ?? (Number.isFinite(droppedIndex) ? droppedIndex : null);
    setDraggedIndex(null);
    setDropTargetIndex(null);
    if (fromIndex !== null && fromIndex !== toIndex) {
      const fromItem = items.find((item) => item.index === fromIndex);
      const fromGroupId = fromItem?.groupId ?? null;
      if (fromGroupId !== targetGroupId || targetGroupId === null) {
        await onMoveToGroup(
          fromIndex,
          targetGroupId,
          targetLayoutIndex === undefined
            ? toIndex
            : toRowDropLineIndex(fromIndex, targetLayoutIndex),
        );
        onSelectGroup(targetGroupId);
        return;
      }
      if (onReorder) {
        await onReorder(fromIndex, toIndex);
      }
    }
  };

  const clearDragState = () => {
    setDraggedIndex(null);
    setDraggedGroupId(null);
    setDropTargetIndex(null);
    setDropTargetGroupId(null);
    setDropTargetRowKey(null);
  };

  const handleDragEnd = clearDragState;

  const handleGroupDragStart = (event: React.DragEvent, groupId: string) => {
    event.stopPropagation();
    setDraggedGroupId(groupId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(groupDragDataKey, groupId);
    event.dataTransfer.setData("text/plain", groupId);
  };

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const handleGroupDragOver = (event: React.DragEvent, groupId: string | null) => {
    if (draggedIndex === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetIndex(null);
    setDropTargetGroupId(groupId ?? "__ungrouped__");
  };

  const handleGroupDrop = async (event: React.DragEvent, groupId: string | null) => {
    event.preventDefault();
    const droppedIndex = Number.parseInt(
      event.dataTransfer.getData(dragDataKey) || event.dataTransfer.getData("text/plain"),
      10,
    );
    const fromIndex =
      draggedIndex ?? (Number.isFinite(droppedIndex) ? droppedIndex : null);
    setDraggedIndex(null);
    setDropTargetIndex(null);
    setDropTargetGroupId(null);
    if (fromIndex !== null) {
      await onMoveToGroup(fromIndex, groupId);
      onSelectGroup(groupId);
    }
  };

  const handleRowBoundaryDrop = async (
    event: React.DragEvent,
    toLayoutIndex: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const groupId =
      draggedGroupId || event.dataTransfer.getData(groupDragDataKey) || null;
    const droppedIndex = Number.parseInt(
      event.dataTransfer.getData(dragDataKey) || event.dataTransfer.getData("text/plain"),
      10,
    );
    const fromIndex =
      draggedIndex ?? (Number.isFinite(droppedIndex) ? droppedIndex : null);
    clearDragState();
    if (groupId) {
      await onReorderGroup(groupId, toLayoutIndex);
      return;
    }
    if (fromIndex !== null) {
      await onMoveToGroup(fromIndex, null, toLayoutIndex);
      onSelectGroup(null);
    }
  };

  const renderItem = (
    item: ServiceItem,
    displayNumber?: number,
    layoutIndex?: number,
  ) => {
    const { displayName, icon } = getServiceItemDisplay(item);
    return (
      <ContextMenu key={`${item.refId}-${item.index}`}>
        <ContextMenuTrigger asChild>
          <div
            draggable={!!onReorder}
            onDragStart={(event) => {
              event.stopPropagation();
              handleDragStart(event, item.index);
            }}
            onDragOver={(event) => {
              event.stopPropagation();
              handleDragOver(event, item.index);
            }}
            onDragLeave={(event) => {
              event.stopPropagation();
              setDropTargetIndex(null);
            }}
            onDrop={(event) => {
              event.stopPropagation();
              void handleDrop(
                event,
                item.index,
                item.groupId ?? null,
                layoutIndex,
              );
            }}
            onDragEnd={handleDragEnd}
            className={cn(
              "group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition",
              selectedIndex === item.index
                ? "bg-primary/20 text-primary"
                : "text-foreground hover:bg-secondary",
              draggedIndex === item.index && "opacity-50",
              dropTargetIndex === item.index && "ring-2 ring-primary ring-inset",
              onReorder && "cursor-grab active:cursor-grabbing",
            )}
          >
            {onReorder ? (
              <span className="shrink-0 text-muted-foreground/50">
                <GripIcon />
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                onSelectGroup(item.groupId ?? null);
                onSelect(item.index);
              }}
              onDoubleClick={() => onDoubleClick?.(item.index)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span className="w-4 text-[10px] text-muted-foreground">
                {displayNumber ?? item.index + 1}
              </span>
              <span className="shrink-0 text-muted-foreground">{icon}</span>
              <span className="flex-1 truncate">{displayName}</span>
            </button>
            {item.type === "library" && item.libraryItem?._id ? (
              <button
                type="button"
                aria-label="Open mini editor"
                title="Open mini editor"
                onClick={() => onOpenMiniEditor?.(String(item.libraryItem?._id))}
                className="shrink-0 text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100"
              >
                <NotebookPen className="h-3.5 w-3.5" />
              </button>
            ) : null}
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
        <ContextMenuContent className="w-44">
          <ContextMenuSub>
            <ContextMenuSubTrigger>Move to group</ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-44">
              <ContextMenuItem onClick={() => onMoveToGroup(item.index, null)}>
                Standalone
              </ContextMenuItem>
              {orderedGroups.map((group) => (
                <ContextMenuItem
                  key={group.id}
                  onClick={() => onMoveToGroup(item.index, group.id)}
                >
                  {group.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem
            onClick={() =>
              setRenameItemTarget({
                index: item.index,
                label: displayName,
              })
            }
          >
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => onRemove(item.index)}
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  return (
    <div className="space-y-1">
      {renameGroupTarget ? (
        <Dialog title="Rename group" onClose={() => setRenameGroupTarget(null)}>
          <div className="space-y-3">
            <input
              value={renameGroupTarget.label}
              onChange={(event) =>
                setRenameGroupTarget({
                  ...renameGroupTarget,
                  label: event.target.value,
                })
              }
              aria-label="Group name"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              onKeyDown={(event) => {
                if (event.key === "Enter" && renameGroupTarget.label.trim()) {
                  void onRenameGroup(
                    renameGroupTarget.id,
                    renameGroupTarget.label.trim(),
                  ).then(() => setRenameGroupTarget(null));
                }
              }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRenameGroupTarget(null)}
                className="flex-1 rounded-md border border-input py-2 text-xs font-medium text-foreground hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!renameGroupTarget.label.trim()) return;
                  void onRenameGroup(
                    renameGroupTarget.id,
                    renameGroupTarget.label.trim(),
                  ).then(() => setRenameGroupTarget(null));
                }}
                className="flex-1 rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Save
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {renameItemTarget ? (
        <Dialog title="Rename service item" onClose={() => setRenameItemTarget(null)}>
          <div className="space-y-3">
            <input
              value={renameItemTarget.label}
              onChange={(event) =>
                setRenameItemTarget({
                  ...renameItemTarget,
                  label: event.target.value,
                })
              }
              aria-label="Service item name"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              onKeyDown={(event) => {
                if (event.key === "Enter" && renameItemTarget.label.trim()) {
                  void onRenameItem(
                    renameItemTarget.index,
                    renameItemTarget.label.trim(),
                  ).then(() => setRenameItemTarget(null));
                }
              }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRenameItemTarget(null)}
                className="flex-1 rounded-md border border-input py-2 text-xs font-medium text-foreground hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!renameItemTarget.label.trim()) return;
                  void onRenameItem(
                    renameItemTarget.index,
                    renameItemTarget.label.trim(),
                  ).then(() => setRenameItemTarget(null));
                }}
                className="flex-1 rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Save
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {orderedGroups.length === 0 && items.length === 0 ? (
        <p className="px-2 text-[10px] text-muted-foreground">
          No items. Add groups, library items, media, or scripture.
        </p>
      ) : null}

      {orderedServiceRows.map((row) => {
        const boundaryBefore = (
          <RowBoundaryDropZone
            layoutIndex={row.layoutIndex}
            canDrop={canDropOnRowBoundary}
            isActive={dropTargetRowKey === `row:${row.layoutIndex}`}
            onActivate={setDropTargetRowKey}
            onClear={() => setDropTargetRowKey(null)}
            onDrop={handleRowBoundaryDrop}
          />
        );

        if (row.type === "item") {
          return (
            <div key={`item:${row.item.refId}-${row.item.index}`}>
              {boundaryBefore}
              {renderItem(
                row.item,
                itemDisplayNumbers.get(row.item.index),
                row.layoutIndex,
              )}
            </div>
          );
        }

        const { group, items: groupItems } = row;
        return (
          <div key={group.id}>
            {boundaryBefore}
            <section
              onDragOver={(event) => handleGroupDragOver(event, group.id)}
              onDragLeave={() => setDropTargetGroupId(null)}
              onDrop={(event) => handleGroupDrop(event, group.id)}
              className={cn(
                "transition",
                selectedGroupId === group.id
                  ? "bg-primary/10"
                  : "hover:bg-secondary/40",
                dropTargetGroupId === group.id && "ring-2 ring-primary/70 ring-inset",
                draggedGroupId === group.id && "opacity-50",
              )}
            >
              <div
                draggable
                onDragStart={(event) => handleGroupDragStart(event, group.id)}
                onDragEnd={handleDragEnd}
                className="group flex cursor-grab items-center gap-1 px-1.5 py-1 active:cursor-grabbing"
              >
                <span className="shrink-0 text-muted-foreground/50">
                  <GripIcon />
                </span>
                <button
                  type="button"
                  aria-label={
                    collapsedGroupIds.has(group.id) ? "Expand group" : "Collapse group"
                  }
                  onClick={() => toggleGroupCollapsed(group.id)}
                  className="rounded-sm p-0.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                >
                  {collapsedGroupIds.has(group.id) ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onSelectGroup(group.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-0.5 text-left"
                >
                  {collapsedGroupIds.has(group.id) ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {group.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {groupItems.length}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Rename group"
                  onClick={() => setRenameGroupTarget({ id: group.id, label: group.name })}
                  className="text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  aria-label="Delete group"
                  onClick={() => onDeleteGroup(group.id)}
                  className="text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                >
                  <TrashIcon />
                </button>
              </div>
              {!collapsedGroupIds.has(group.id) ? (
                <div className="space-y-1 py-0.5 pl-5 pr-1">
                  {groupItems.length ? (
                    groupItems.map((item) =>
                      renderItem(item, itemDisplayNumbers.get(item.index)),
                    )
                  ) : (
                    <p className="px-2 py-1.5 text-[10px] text-muted-foreground">
                      Drop items here, or select this group before adding.
                    </p>
                  )}
                </div>
              ) : null}
            </section>
          </div>
        );
      })}

      {orderedServiceRows.length > 0 ? (
        <RowBoundaryDropZone
          layoutIndex={orderedServiceRows.length}
          canDrop={canDropOnRowBoundary}
          isActive={dropTargetRowKey === `row:${orderedServiceRows.length}`}
          onActivate={setDropTargetRowKey}
          onClear={() => setDropTargetRowKey(null)}
          onDrop={handleRowBoundaryDrop}
        />
      ) : null}
    </div>
  );
});

function getServiceItemDisplay(item: ServiceItem) {
  if (item.type === "library") {
    const serviceLabel = item.label?.trim();
    const libraryTitle = item.libraryItem?.title?.trim();
    return {
      displayName:
        item.labelIsCustom && serviceLabel
          ? serviceLabel
          : libraryTitle || serviceLabel || item.refId,
      icon: <MusicIcon />,
    };
  }
  if (item.type === "media") {
    const displayName = item.label ?? item.refId;
    const isVideo = /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(displayName);
    return {
      displayName,
      icon: isVideo ? <VideoIcon /> : <ImageIcon />,
    };
  }
  if (item.type === "scripture") {
    return { displayName: item.label ?? "Scripture", icon: <BookIcon /> };
  }
  if (item.type === "presentation") {
    return {
      displayName: item.presentation?.title ?? item.label ?? "Presentation",
      icon: <FolderIcon />,
    };
  }
  return { displayName: item.label ?? "Group", icon: <Folder className="h-3.5 w-3.5" /> };
}

/**
 * Thin drop line between two top-level rows. Accepts both dragged items
 * (which become standalone at that position) and dragged groups (which move
 * the whole group there).
 */
function RowBoundaryDropZone({
  layoutIndex,
  canDrop,
  isActive,
  onActivate,
  onClear,
  onDrop,
}: {
  layoutIndex: number;
  canDrop: boolean;
  isActive: boolean;
  onActivate: (targetKey: string) => void;
  onClear: () => void;
  onDrop: (
    event: DragEvent<HTMLDivElement>,
    layoutIndex: number,
  ) => void | Promise<void>;
}) {
  return (
    <div
      onDragOver={(event) => {
        if (!canDrop) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        onActivate(`row:${layoutIndex}`);
      }}
      onDragLeave={onClear}
      onDrop={(event) => {
        void onDrop(event, layoutIndex);
      }}
      className={cn(
        "h-px rounded-full border border-transparent transition hover:border-border/40",
        // Grow into a hittable target only while something is being dragged.
        canDrop && "h-2",
        isActive && "h-2 border-primary/70 bg-primary/20",
      )}
      aria-hidden="true"
    />
  );
}

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
