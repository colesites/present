"use client";

import { memo, useMemo, useState } from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import {
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
  onMoveServiceItemToGroup: (index: number, groupId: string | null) => Promise<void>;
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
  onDeleteServiceTemplate,
  onCreateService,
  onRenameService,
  onDeleteService,
  onReorderServiceItems,
  onReorderServices,
}: ServicesSidebarProps) {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newServiceTemplateId, setNewServiceTemplateId] = useState<string | null>(
    selectedServiceTemplateId,
  );
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
    <aside className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            {isInsideService ? (
              <button
                type="button"
                onClick={onExitService}
                className="inline-flex h-6 items-center rounded border border-border px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition hover:text-foreground"
              >
                Back
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
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-secondary/30 text-muted-foreground transition hover:border-primary hover:text-primary"
                aria-label="Service template"
                title="Service template"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={openNewServiceDialog}
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-secondary/30 text-xs font-semibold text-muted-foreground transition hover:border-primary hover:text-primary"
                aria-label="Add service"
                title="Add service"
              >
                +
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openTemplateDialog}
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-secondary/30 text-muted-foreground transition hover:border-primary hover:text-primary"
                aria-label="Service templates"
                title="Service templates"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowGroupDialog(true)}
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-secondary/30 text-muted-foreground transition hover:border-primary hover:text-primary"
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

      <div className="flex-1 overflow-hidden p-2">
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
            onRenameItem={onRenameServiceItem}
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
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              autoFocus
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
        <Dialog title="Service templates" onClose={() => setShowTemplateDialog(false)}>
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
  ) => void;
}) {
  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) ??
    templates[0] ??
    null;
  const [groupName, setGroupName] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [itemType, setItemType] = useState<"library" | "media" | "scripture">(
    "library",
  );
  const [selectedLibraryId, setSelectedLibraryId] = useState("");
  const [selectedMediaId, setSelectedMediaId] = useState("");
  const [scriptureLabel, setScriptureLabel] = useState("");
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

  const handleAddGroup = () => {
    if (!selectedTemplate || !groupName.trim()) return;
    const groupId = onAddGroup(selectedTemplate.id, groupName.trim());
    setGroupName("");
    if (groupId) {
      setSelectedGroupId(groupId);
    }
  };

  const handleAddItem = () => {
    if (!selectedTemplate) return;

    if (itemType === "library") {
      const libraryId = selectedLibraryId || String(libraryItems[0]?._id ?? "");
      const libraryItem = libraryItems.find(
        (item) => String(item._id) === libraryId,
      );
      if (!libraryItem) return;
      onAddItem(selectedTemplate.id, {
        type: "library",
        refId: String(libraryItem._id),
        label: libraryItem.title,
        groupId: selectedGroupId,
      });
      setSelectedLibraryId("");
      return;
    }

    if (itemType === "media") {
      const mediaId = selectedMediaId || mediaItems[0]?.id || "";
      const mediaItem = mediaItems.find((item) => item.id === mediaId);
      if (!mediaItem) return;
      onAddItem(selectedTemplate.id, {
        type: "media",
        refId: mediaItem.id,
        label: mediaItem.name,
        groupId: selectedGroupId,
      });
      setSelectedMediaId("");
      return;
    }

    if (!scriptureLabel.trim()) return;
    onAddItem(selectedTemplate.id, {
      type: "scripture",
      refId: scriptureLabel.trim(),
      label: scriptureLabel.trim(),
      groupId: selectedGroupId,
    });
    setScriptureLabel("");
  };

  return (
    <div className="grid max-h-[72vh] min-h-[460px] grid-cols-[180px_minmax(0,1fr)] gap-3 overflow-hidden">
      <div className="flex min-h-0 flex-col gap-3 border-r border-border pr-3">
        <div className="space-y-1 overflow-auto pr-1">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelectTemplate(template.id)}
              className={cn(
                "w-full rounded-md border px-2 py-2 text-left transition",
                selectedTemplate?.id === template.id
                  ? "border-primary/70 bg-primary/10 text-primary"
                  : "border-border bg-background text-foreground hover:bg-secondary",
              )}
            >
              <span className="block truncate text-xs font-medium">
                {template.name}
              </span>
              <span className="block text-[10px] text-muted-foreground">
                {template.groups.length} folder
                {template.groups.length === 1 ? "" : "s"} · {template.items.length} item
                {template.items.length === 1 ? "" : "s"}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-auto space-y-2 rounded-md border border-border bg-muted/20 p-2">
          <input
            value={newTemplateName}
            onChange={(event) => onNewTemplateNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCreateTemplate();
            }}
            placeholder="Template name"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={onCreateTemplate}
            disabled={!newTemplateName.trim()}
            className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            New template
          </button>
        </div>
      </div>

      <div className="min-h-0 overflow-auto pr-1">
        {!selectedTemplate ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Create a template to begin.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Template
                </span>
                <input
                  key={selectedTemplate.id}
                  defaultValue={selectedTemplate.name}
                  onBlur={(event) =>
                    onRenameTemplate(selectedTemplate.id, event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => onDeleteTemplate(selectedTemplate.id)}
                className="mt-5 rounded-md border border-border px-2 py-2 text-xs font-medium text-muted-foreground hover:text-destructive"
              >
                Delete
              </button>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 rounded-md border border-border bg-muted/20 p-2">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Add folder
                </span>
                <div className="flex gap-2">
                  <input
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleAddGroup();
                    }}
                    placeholder="Announcements"
                    className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddGroup}
                    disabled={!groupName.trim()}
                    className="rounded-md border border-border px-2 text-xs font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Add item
                </span>
                <div className="grid grid-cols-[86px_minmax(0,1fr)] gap-2">
                  <select
                    value={itemType}
                    onChange={(event) =>
                      setItemType(event.target.value as "library" | "media" | "scripture")
                    }
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="library">Library</option>
                    <option value="media">Media</option>
                    <option value="scripture">Scripture</option>
                  </select>
                  <select
                    value={selectedGroupId ?? ""}
                    onChange={(event) => setSelectedGroupId(event.target.value || null)}
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="">No folder</option>
                    {orderedGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  {itemType === "library" ? (
                    <select
                      value={selectedLibraryId}
                      onChange={(event) => setSelectedLibraryId(event.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
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
                    <select
                      value={selectedMediaId}
                      onChange={(event) => setSelectedMediaId(event.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    >
                      <option value="">Select media</option>
                      {mediaItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {itemType === "scripture" ? (
                    <input
                      value={scriptureLabel}
                      onChange={(event) => setScriptureLabel(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleAddItem();
                      }}
                      placeholder="John 3:16"
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {groupedItems.map(({ group, items }) => (
                <section
                  key={group.id}
                  className={cn(
                    "overflow-hidden rounded-md border bg-background/40",
                    selectedGroupId === group.id
                      ? "border-primary/60"
                      : "border-border/70",
                  )}
                >
                  <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-2 py-1.5">
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                      key={group.id}
                      defaultValue={group.name}
                      onFocus={() => setSelectedGroupId(group.id)}
                      onBlur={(event) =>
                        onRenameGroup(
                          selectedTemplate.id,
                          group.id,
                          event.currentTarget.value,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      className="min-w-0 flex-1 bg-transparent text-[10px] font-semibold uppercase tracking-widest text-muted-foreground outline-none focus:text-foreground"
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {items.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDeleteGroup(selectedTemplate.id, group.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete template folder"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  <div className="space-y-1 p-1 pl-4">
                    {items.length ? (
                      items.map(({ item, index }) => (
                        <TemplateItemRow
                          key={getTemplateItemKey(item)}
                          item={item}
                          index={index}
                          groups={orderedGroups}
                          libraryItems={libraryItems}
                          mediaItems={mediaItems}
                          onMove={(groupId) =>
                            onMoveItemToGroup(selectedTemplate.id, index, groupId)
                          }
                          onRemove={() => onRemoveItem(selectedTemplate.id, index)}
                        />
                      ))
                    ) : (
                      <p className="px-2 py-2 text-[10px] text-muted-foreground">
                        Add items to this folder from the controls above.
                      </p>
                    )}
                  </div>
                </section>
              ))}

              {ungroupedItems.length ? (
                <section className="space-y-1 rounded-md border border-border/50 p-1">
                  <button
                    type="button"
                    onClick={() => setSelectedGroupId(null)}
                    className={cn(
                      "w-full rounded-sm px-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground",
                      selectedGroupId === null && "bg-primary/10 text-primary",
                    )}
                  >
                    No folder
                  </button>
                  {ungroupedItems.map(({ item, index }) => (
                    <TemplateItemRow
                      key={getTemplateItemKey(item)}
                      item={item}
                      index={index}
                      groups={orderedGroups}
                      libraryItems={libraryItems}
                      mediaItems={mediaItems}
                      onMove={(groupId) =>
                        onMoveItemToGroup(selectedTemplate.id, index, groupId)
                      }
                      onRemove={() => onRemoveItem(selectedTemplate.id, index)}
                    />
                  ))}
                </section>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

function TemplateItemRow({
  item,
  index,
  groups,
  libraryItems,
  mediaItems,
  onMove,
  onRemove,
}: {
  item: ServiceTemplate["items"][number];
  index: number;
  groups: ServiceGroup[];
  libraryItems: LibraryItem[];
  mediaItems: MediaItem[];
  onMove: (groupId: string | null) => void;
  onRemove: () => void;
}) {
  const label = getTemplateItemLabel(item, libraryItems, mediaItems);

  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-secondary">
      <span className="w-4 text-[10px] text-muted-foreground">{index + 1}</span>
      <span className="shrink-0 text-muted-foreground">
        {item.type === "library" ? <MusicIcon /> : null}
        {item.type === "media" ? (
          /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(label) ? (
            <VideoIcon />
          ) : (
            <ImageIcon />
          )
        ) : null}
        {item.type === "scripture" ? <BookIcon /> : null}
        {item.type === "presentation" ? <FolderIcon /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <select
        value={item.groupId ?? ""}
        onChange={(event) => onMove(event.target.value || null)}
        className="h-6 max-w-[120px] rounded border border-border bg-background px-1 text-[10px] text-muted-foreground opacity-0 outline-none focus:opacity-100 group-hover:opacity-100"
        aria-label="Move template item to folder"
      >
        <option value="">No folder</option>
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
  onRenameItem,
  onReorder,
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
  onMoveToGroup: (index: number, groupId: string | null) => Promise<void>;
  onRenameItem: (index: number, label: string) => Promise<void>;
  onReorder?: (fromIndex: number, toIndex: number) => Promise<void>;
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
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
  const orderedGroups = [...groups].sort((a, b) => a.order - b.order);
  const groupedItems = orderedGroups.map((group) => ({
    group,
    items: items.filter((item) => item.groupId === group.id),
  }));
  const ungroupedItems = items.filter(
    (item) => !item.groupId || !groups.some((group) => group.id === item.groupId),
  );

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
    setDropTargetGroupId(null);
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

  const renderItem = (item: ServiceItem) => {
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
              void handleDrop(event, item.index);
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
                onSelectGroup(null);
                onSelect(item.index);
              }}
              onDoubleClick={() => onDoubleClick?.(item.index)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span className="w-4 text-[10px] text-muted-foreground">
                {item.index + 1}
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
                Ungrouped
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
    <div className="space-y-3">
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
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              autoFocus
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
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              autoFocus
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

      {groupedItems.map(({ group, items: groupItems }) => (
        <section
          key={group.id}
          onDragOver={(event) => handleGroupDragOver(event, group.id)}
          onDragLeave={() => setDropTargetGroupId(null)}
          onDrop={(event) => handleGroupDrop(event, group.id)}
          className={cn(
            "overflow-hidden rounded-md border bg-background/40 transition",
            selectedGroupId === group.id
              ? "border-primary/60 bg-primary/10"
              : "border-border/70",
            dropTargetGroupId === group.id && "ring-2 ring-primary/70",
          )}
        >
          <div className="group flex items-center gap-1 border-b border-border/60 bg-muted/30 px-1.5 py-1">
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
            <div className="space-y-1 p-1 pl-4">
              {groupItems.length ? (
                groupItems.map(renderItem)
              ) : (
                <p className="px-2 py-2 text-[10px] text-muted-foreground">
                  Drop items here, or select this folder before adding.
                </p>
              )}
            </div>
          ) : null}
        </section>
      ))}

      {ungroupedItems.length ? (
        <section
          className={cn(
            "space-y-1 rounded-md border border-transparent p-1 transition",
            dropTargetGroupId === "__ungrouped__" && "border-primary/60 ring-2 ring-primary/70",
          )}
          onDragOver={(event) => handleGroupDragOver(event, null)}
          onDragLeave={() => setDropTargetGroupId(null)}
          onDrop={(event) => handleGroupDrop(event, null)}
        >
          <button
            type="button"
            onClick={() => onSelectGroup(null)}
            className={cn(
              "w-full rounded-sm px-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground",
              selectedGroupId === null && selectedIndex === null && "bg-primary/10 text-primary",
            )}
          >
            Ungrouped
          </button>
          {ungroupedItems.map(renderItem)}
        </section>
      ) : null}
    </div>
  );
});

function getServiceItemDisplay(item: ServiceItem) {
  if (item.type === "library") {
    return {
      displayName: item.label ?? item.libraryItem?.title ?? item.refId,
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
