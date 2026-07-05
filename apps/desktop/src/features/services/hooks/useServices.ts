"use client";

import { useMemo, useState, useEffect } from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type {
  LibraryItem,
  Service,
  ServiceGroup,
  ServiceItem,
  ServiceLayoutEntry,
  ServicePresentation,
} from "../../../shared/types";
import {
  createLocalService,
  enqueueSyncOperation,
  LOCAL_DATA_CHANGED_EVENT,
  readOrgServices,
  removeServiceLocal,
  replaceOrgServices,
  upsertService,
} from "../../../renderer/shared/offline/localData";

const SERVICE_STATE_KEY = "present-service-state";
const LEGACY_SERVICE_TEMPLATE_KEY = "present-service-template-groups-v1";
const SERVICE_TEMPLATES_KEY = "present-service-templates-v1";
const DEFAULT_SERVICE_TEMPLATE_ID_KEY = "present-default-service-template-id-v1";

export const DEFAULT_SERVICE_TEMPLATE_GROUPS = [
  "Welcome",
  "Pre-service",
  "Praise & Worship",
  "Word",
  "Media",
];

export type ServiceTemplate = {
  id: string;
  name: string;
  groups: ServiceGroup[];
  items: Service["items"];
  layout: ServiceTemplateLayoutEntry[];
  createdAt: number;
  updatedAt: number;
};

export type ServiceTemplateLayoutEntry = ServiceLayoutEntry;

const createId = (prefix: string) =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}_${crypto.randomUUID()}`
    : `${prefix}_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2)}`;

const groupsFromNames = (names: string[]): ServiceGroup[] =>
  names
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name, index) => ({
      id: createId("group"),
      name,
      order: index,
    }));

export const getServiceTemplateItemLayoutKey = (
  item: Pick<ServiceItem, "type" | "refId" | "addedAt" | "label" | "groupId">,
) =>
  [
    item.type,
    item.refId,
    item.addedAt,
    item.groupId ?? "standalone",
    item.label ?? "",
  ].join(":");

const getLegacyServiceItemLayoutKey = (
  item: Pick<ServiceItem, "type" | "refId" | "addedAt" | "label">,
) => [item.type, item.refId, item.addedAt, item.label ?? ""].join(":");

const isServiceItemLayoutKeyMatch = (
  key: string,
  item: Pick<ServiceItem, "type" | "refId" | "addedAt" | "label" | "groupId">,
) =>
  key === getServiceTemplateItemLayoutKey(item) ||
  key === getLegacyServiceItemLayoutKey(item);

const normalizeServiceLayout = (
  rawLayout: unknown,
  groups: ServiceGroup[],
  items: Service["items"],
): ServiceLayoutEntry[] => {
  const orderedGroups = [...groups].sort((left, right) => left.order - right.order);
  const groupIds = new Set(orderedGroups.map((group) => group.id));
  const ungroupedItems = items.filter(
    (item) => !item.groupId || !groupIds.has(item.groupId),
  );
  const fallbackLayout: ServiceTemplateLayoutEntry[] = [];
  const fallbackGroups = new Set<string>();
  const fallbackItems = new Set<string>();
  for (const item of items) {
    if (item.type === "group") continue;
    if (item.groupId && groupIds.has(item.groupId)) {
      if (!fallbackGroups.has(item.groupId)) {
        fallbackGroups.add(item.groupId);
        fallbackLayout.push({ type: "group", id: item.groupId });
      }
      continue;
    }
    const key = getServiceTemplateItemLayoutKey(item);
    if (!fallbackItems.has(key)) {
      fallbackItems.add(key);
      fallbackLayout.push({ type: "item", key });
    }
  }
  for (const group of orderedGroups) {
    if (!fallbackGroups.has(group.id)) {
      fallbackGroups.add(group.id);
      fallbackLayout.push({ type: "group", id: group.id });
    }
  }
  const seenGroups = new Set<string>();
  const seenItems = new Set<string>();
  const layout: ServiceTemplateLayoutEntry[] = [];
  const expectedItemKeys = new Set(
    ungroupedItems.map((item) => getServiceTemplateItemLayoutKey(item)),
  );

  if (Array.isArray(rawLayout)) {
    for (const entry of rawLayout) {
      if (!entry || typeof entry !== "object") continue;
      const candidate = entry as Partial<ServiceLayoutEntry>;
      if (
        candidate.type === "group" &&
        typeof candidate.id === "string" &&
        groupIds.has(candidate.id) &&
        !seenGroups.has(candidate.id)
      ) {
        seenGroups.add(candidate.id);
        layout.push({ type: "group", id: candidate.id });
      }
      if (
        candidate.type === "item" &&
        typeof candidate.key === "string"
      ) {
        const item = ungroupedItems.find((candidateItem) =>
          isServiceItemLayoutKeyMatch(candidate.key, candidateItem),
        );
        if (!item) {
          continue;
        }
        const key = getServiceTemplateItemLayoutKey(item);
        if (seenItems.has(key)) {
          continue;
        }
        seenItems.add(key);
        layout.push({ type: "item", key });
      }
    }
  }

  const rawLayoutIsMissingVisibleRows =
    seenGroups.size < groupIds.size || seenItems.size < expectedItemKeys.size;
  if (rawLayoutIsMissingVisibleRows) {
    return fallbackLayout;
  }

  for (const group of orderedGroups) {
    if (!seenGroups.has(group.id)) {
      seenGroups.add(group.id);
      layout.push({ type: "group", id: group.id });
    }
  }

  for (const item of ungroupedItems) {
    const key = getServiceTemplateItemLayoutKey(item);
    if (!seenItems.has(key)) {
      seenItems.add(key);
      layout.push({ type: "item", key });
    }
  }

  return layout;
};

const normalizeServiceTemplateLayout = normalizeServiceLayout;

const orderServiceItemsByLayout = (
  rawLayout: unknown,
  groups: ServiceGroup[],
  items: Service["items"],
) => {
  const layout = normalizeServiceLayout(rawLayout, groups, items);
  const orderedItems: Service["items"] = [];
  const usedIndexes = new Set<number>();

  const appendItemAtIndex = (index: number) => {
    if (usedIndexes.has(index)) return;
    const item = items[index];
    if (!item || item.type === "group") return;
    usedIndexes.add(index);
    orderedItems.push(item);
  };

  for (const entry of layout) {
    if (entry.type === "group") {
      items.forEach((item, index) => {
        if (item.groupId === entry.id) {
          appendItemAtIndex(index);
        }
      });
      continue;
    }

    const itemIndex = items.findIndex(
      (item, index) =>
        !usedIndexes.has(index) &&
        (!item.groupId || !groups.some((group) => group.id === item.groupId)) &&
        isServiceItemLayoutKeyMatch(entry.key, item),
    );
    if (itemIndex >= 0) {
      appendItemAtIndex(itemIndex);
    }
  }

  items.forEach((_, index) => appendItemAtIndex(index));
  return orderedItems;
};

const createDefaultServiceTemplate = (): ServiceTemplate => {
  const stamp = Date.now();
  const groups = groupsFromNames(DEFAULT_SERVICE_TEMPLATE_GROUPS);
  return {
    id: "default-sunday-service",
    name: "Sunday service template",
    groups,
    items: [],
    layout: groups.map((group) => ({ type: "group", id: group.id })),
    createdAt: stamp,
    updatedAt: stamp,
  };
};

const cloneTemplateForService = (template: ServiceTemplate) => {
  const groupIdMap = new Map<string, string>();
  const itemKeyMap = new Map<string, string>();
  const groups = template.groups.map((group, index) => {
    const nextId = createId("group");
    groupIdMap.set(group.id, nextId);
    return {
      ...group,
      id: nextId,
      order: Number.isFinite(group.order) ? group.order : index,
    };
  });

  const items = template.items
    .filter((item) => item.type !== "group")
    .map((item) => {
      const groupId = item.groupId ? groupIdMap.get(item.groupId) ?? null : null;
      const refId =
        item.type === "presentation" ? createId("presentation") : item.refId;
      const nextItem = {
        ...item,
        refId,
        groupId,
        addedAt: Date.now(),
      };
      itemKeyMap.set(
        getServiceTemplateItemLayoutKey(item),
        getServiceTemplateItemLayoutKey(nextItem),
      );
      return nextItem;
    });

  const layout = normalizeServiceLayout(
    (template.layout ?? []).map((entry) => {
      if (entry.type === "group") {
        const id = groupIdMap.get(entry.id);
        return id ? { type: "group" as const, id } : null;
      }
      const key = itemKeyMap.get(entry.key);
      return key ? { type: "item" as const, key } : null;
    }),
    groups,
    items,
  );

  return { groups, items: orderServiceItemsByLayout(layout, groups, items), layout };
};

const findBibleGroupId = (groups: ServiceGroup[] | undefined): string | null =>
  groups?.find((group) => group.name.trim().toLowerCase() === "bible")?.id ?? null;

function loadServiceTemplates(): ServiceTemplate[] {
  const fallback = [createDefaultServiceTemplate()];
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(SERVICE_TEMPLATES_KEY);
    if (!stored) {
      const legacyStored = localStorage.getItem(LEGACY_SERVICE_TEMPLATE_KEY);
      if (!legacyStored) return fallback;
      const legacyParsed = JSON.parse(legacyStored);
      const names = Array.isArray(legacyParsed)
        ? legacyParsed
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : [];
      return names.length
        ? (() => {
            const groups = groupsFromNames(names);
            return [
              {
                ...createDefaultServiceTemplate(),
                groups,
                layout: groups.map((group) => ({ type: "group", id: group.id })),
              },
            ];
          })()
        : fallback;
    }
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return fallback;
    const templates = parsed
      .map((template): ServiceTemplate | null => {
        if (!template || typeof template !== "object") return null;
        const candidate = template as Partial<ServiceTemplate>;
        if (!candidate.id || !candidate.name) return null;
        const groups = Array.isArray(candidate.groups)
          ? candidate.groups.map((group, index) => ({
              id: String(group.id || createId("group")),
              name: String(group.name || "Group"),
              order: Number.isFinite(group.order) ? group.order : index,
            }))
          : [];
        const items = Array.isArray(candidate.items)
          ? candidate.items.filter((item) => item.type !== "group")
          : [];
        return {
          id: String(candidate.id),
          name: String(candidate.name),
          groups,
          items,
          layout: normalizeServiceTemplateLayout(candidate.layout, groups, items),
          createdAt: candidate.createdAt ?? Date.now(),
          updatedAt: candidate.updatedAt ?? Date.now(),
        };
      })
      .filter((template): template is ServiceTemplate => template !== null);
    return templates.length ? templates : fallback;
  } catch {
    return fallback;
  }
}

function saveServiceTemplates(templates: ServiceTemplate[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SERVICE_TEMPLATES_KEY, JSON.stringify(templates));
}

function loadDefaultTemplateId(templates: ServiceTemplate[]) {
  if (typeof window === "undefined") return templates[0]?.id ?? null;
  const stored = localStorage.getItem(DEFAULT_SERVICE_TEMPLATE_ID_KEY);
  return templates.some((template) => template.id === stored)
    ? stored
    : templates[0]?.id ?? null;
}

function saveDefaultTemplateId(templateId: string | null) {
  if (typeof window === "undefined") return;
  if (templateId) {
    localStorage.setItem(DEFAULT_SERVICE_TEMPLATE_ID_KEY, templateId);
  } else {
    localStorage.removeItem(DEFAULT_SERVICE_TEMPLATE_ID_KEY);
  }
}

function normalizeServiceGroups(service: Service): Service {
  const existingGroups = Array.isArray(service.groups) ? service.groups : [];
  const legacyGroupItems = service.items.filter((item) => item.type === "group");
  const needsLegacyMigration = existingGroups.length === 0 && legacyGroupItems.length > 0;

  if (!needsLegacyMigration) {
    const groups = existingGroups
      .map((group, index) => ({
        ...group,
        order: Number.isFinite(group.order) ? group.order : index,
      }))
      .sort((left, right) => left.order - right.order);
    const items = service.items.filter((item) => item.type !== "group");
    const layout = normalizeServiceLayout(service.layout, groups, items);
    return {
      ...service,
      groups,
      items: orderServiceItemsByLayout(layout, groups, items),
      layout,
    };
  }

  const groups: ServiceGroup[] = [];
  let currentGroupId: string | null = null;
  const items = service.items.flatMap((item) => {
    if (item.type === "group") {
      currentGroupId = item.refId || createId("group");
      groups.push({
        id: currentGroupId,
        name: item.label?.trim() || "Group",
        order: groups.length,
      });
      return [];
    }

    return [{ ...item, groupId: item.groupId ?? currentGroupId }];
  });

  const layout = normalizeServiceLayout(undefined, groups, items);
  return {
    ...service,
    groups,
    items: orderServiceItemsByLayout(layout, groups, items),
    layout,
  };
}

// Load service state from localStorage
function loadServiceState() {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(SERVICE_STATE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

// Save service state to localStorage
function saveServiceState(state: {
  selectedServiceId: string | null;
  isInsideService: boolean;
  serviceItemIndex: number | null;
  selectedServiceGroupId: string | null;
}) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SERVICE_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save service state:", e);
  }
}

export function useServices(
  input: { orgId: Id<"organizations"> | null; userId: string | null },
  libraryItems: LibraryItem[],
) {
  const workspaceId = (input.orgId as string | null) ?? "personal";
  const [services, setServices] = useState<Service[]>(() =>
    readOrgServices(workspaceId)
  );
  const [initialServiceTemplates] = useState<ServiceTemplate[]>(() =>
    loadServiceTemplates(),
  );
  const [serviceTemplates, setServiceTemplates] = useState<ServiceTemplate[]>(
    initialServiceTemplates,
  );
  const [selectedServiceTemplateId, setSelectedServiceTemplateIdState] =
    useState<string | null>(() => loadDefaultTemplateId(initialServiceTemplates));

  const [initialState] = useState(() => loadServiceState());

  const [selectedServiceId, setSelectedServiceId] = useState<Id<"services"> | null>(
    () => (initialState?.selectedServiceId as Id<"services">) || null
  );
  const [isInsideService, setIsInsideService] = useState(
    () => initialState?.isInsideService || false
  );
  const [serviceItemIndex, setServiceItemIndex] = useState<number | null>(
    () => initialState?.serviceItemIndex ?? null
  );
  const [selectedServiceGroupId, setSelectedServiceGroupId] = useState<string | null>(
    () => initialState?.selectedServiceGroupId ?? null,
  );

  useEffect(() => {
    const refresh = () => {
      setServices(readOrgServices(workspaceId));
    };
    refresh();
    window.addEventListener(LOCAL_DATA_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener(LOCAL_DATA_CHANGED_EVENT, refresh);
    };
  }, [workspaceId]);

  // Persist state changes
  useEffect(() => {
    saveServiceState({
      selectedServiceId: selectedServiceId as string | null,
      isInsideService,
      serviceItemIndex,
      selectedServiceGroupId,
    });
  }, [selectedServiceId, isInsideService, serviceItemIndex, selectedServiceGroupId]);

  // Validate restored service still exists
  useEffect(() => {
    if (selectedServiceId) {
      const exists = services.some((s) => s._id === selectedServiceId);
      if (!exists) {
        setTimeout(() => {
          setSelectedServiceId(null);
          setIsInsideService(false);
          setServiceItemIndex(null);
        }, 0);
      }
    }
  }, [services, selectedServiceId, workspaceId]);

  const selectedService = useMemo(() => {
    if (!selectedServiceId) return null;
    const service = services.find((s) => s._id === selectedServiceId) ?? null;
    return service ? normalizeServiceGroups(service) : null;
  }, [selectedServiceId, services]);

  useEffect(() => {
    if (!selectedServiceGroupId) return;
    if (selectedService?.groups?.some((group) => group.id === selectedServiceGroupId)) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setSelectedServiceGroupId(null);
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectedService, selectedServiceGroupId]);

  const getSelectedGroupIdForService = (service: Service, serviceId: Id<"services">) => {
    if (serviceId !== selectedServiceId || !selectedServiceGroupId) {
      return null;
    }
    const normalizedService = normalizeServiceGroups(service);
    return normalizedService.groups?.some((group) => group.id === selectedServiceGroupId)
      ? selectedServiceGroupId
      : null;
  };

  const appendServiceItem = (
    service: Service,
    item: Service["items"][number],
  ): Service => {
    const normalizedService = normalizeServiceGroups(service);
    const groups = normalizedService.groups ?? [];
    const nextItems = [...normalizedService.items, item];
    const currentLayout = normalizeServiceLayout(
      normalizedService.layout,
      groups,
      normalizedService.items,
    );
    const nextLayout = item.groupId
      ? currentLayout
      : [
          ...currentLayout,
          { type: "item" as const, key: getServiceTemplateItemLayoutKey(item) },
        ];

    return {
      ...normalizedService,
      items: orderServiceItemsByLayout(nextLayout, groups, nextItems),
      layout: normalizeServiceLayout(nextLayout, groups, nextItems),
    };
  };

  // Service items with resolved library items
  const serviceItems = useMemo<ServiceItem[]>(() => {
    if (!selectedService) return [];
    return selectedService.items
      .filter((item) => item.type !== "group")
      .map(
      (item: Service["items"][number], index: number): ServiceItem => {
        if (item.type === "library") {
          const libraryItem = libraryItems.find(
            (s: LibraryItem) => String(s._id) === String(item.refId),
          );
          return { ...item, libraryItem, presentation: null, index };
        }
        return { ...item, libraryItem: null, presentation: item.presentation ?? null, index };
      },
    );
  }, [selectedService, libraryItems]);

  useEffect(() => {
    if (!selectedService || libraryItems.length === 0) return;

    const libraryTitles = new Map(
      libraryItems
        .map((item) => [String(item._id), item.title.trim()] as const)
        .filter(([, title]) => title.length > 0),
    );
    let didRepairLabel = false;
    const repairedItems = selectedService.items.map((item) => {
      if (item.type !== "library") {
        return item;
      }
      const title = libraryTitles.get(String(item.refId));
      if (!title) {
        return item;
      }
      const currentLabel = item.label?.trim() ?? "";
      if (currentLabel === title) {
        return item;
      }
      if (currentLabel && currentLabel !== String(item.refId)) {
        return item;
      }
      didRepairLabel = true;
      return { ...item, label: title };
    });

    if (!didRepairLabel) return;

    const repairedService = upsertService(workspaceId, {
      ...selectedService,
      items: repairedItems,
    });
    enqueueSyncOperation(
      workspaceId,
      "service",
      String(selectedService._id),
      "update",
      repairedService,
    );
  }, [libraryItems, selectedService, workspaceId]);

  const createNewService = async (name: string, templateId?: string | null) => {
    if (!name.trim()) return null;
    const template =
      templateId === null
        ? null
        : (serviceTemplates.find(
            (item) => item.id === (templateId ?? selectedServiceTemplateId),
          ) ??
          serviceTemplates[0] ??
          createDefaultServiceTemplate());
    const templatePayload = template
      ? cloneTemplateForService(template)
      : { groups: [], items: [], layout: [] };
    const nextService = createLocalService(workspaceId, {
      name: name.trim(),
      date: undefined,
      groups: templatePayload.groups,
      layout: templatePayload.layout,
      items: templatePayload.items,
      createdAt: Date.now(),
    });
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(
      workspaceId,
      "service",
      String(nextService._id),
      "create",
      nextService
    );
    return nextService._id;
  };

  const persistServiceTemplates = (templates: ServiceTemplate[]) => {
    setServiceTemplates(templates);
    saveServiceTemplates(templates);
  };

  const selectDefaultServiceTemplate = (templateId: string | null) => {
    const nextId =
      templateId === null
        ? null
        : serviceTemplates.some((template) => template.id === templateId)
          ? templateId
          : serviceTemplates[0]?.id ?? null;
    setSelectedServiceTemplateIdState(nextId);
    saveDefaultTemplateId(nextId);
  };

  const createServiceTemplate = (name: string) => {
    const normalizedName = name.trim();
    if (!normalizedName) return null;
    const stamp = Date.now();
    const template: ServiceTemplate = {
      id: createId("template"),
      name: normalizedName,
      groups: [],
      items: [],
      layout: [],
      createdAt: stamp,
      updatedAt: stamp,
    };
    const nextTemplates = [...serviceTemplates, template];
    persistServiceTemplates(nextTemplates);
    setSelectedServiceTemplateIdState(template.id);
    saveDefaultTemplateId(template.id);
    return template.id;
  };

  const updateServiceTemplate = (
    templateId: string,
    updater: (template: ServiceTemplate) => ServiceTemplate,
  ) => {
    let found = false;
    const nextTemplates = serviceTemplates.map((template) =>
      template.id === templateId ? ((found = true), updater(template)) : template,
    );
    if (!found) return;
    persistServiceTemplates(nextTemplates);
    setSelectedServiceTemplateIdState(templateId);
    saveDefaultTemplateId(templateId);
  };

  const renameServiceTemplate = (templateId: string, name: string) => {
    const normalizedName = name.trim();
    if (!normalizedName) return;
    updateServiceTemplate(templateId, (template) => ({
      ...template,
      name: normalizedName,
      updatedAt: Date.now(),
    }));
  };

  const addGroupToServiceTemplate = (templateId: string, label: string) => {
    const normalizedLabel = label.trim();
    if (!normalizedLabel) return null;
    const groupId = createId("group");
    updateServiceTemplate(templateId, (template) => ({
      ...template,
      groups: [
        ...template.groups,
        {
          id: groupId,
          name: normalizedLabel,
          order: template.groups.length,
        },
      ],
      layout: [
        ...normalizeServiceTemplateLayout(template.layout, template.groups, template.items),
        { type: "group", id: groupId },
      ],
      updatedAt: Date.now(),
    }));
    return groupId;
  };

  const renameServiceTemplateGroup = (
    templateId: string,
    groupId: string,
    label: string,
  ) => {
    const normalizedLabel = label.trim();
    if (!normalizedLabel) return;
    updateServiceTemplate(templateId, (template) => ({
      ...template,
      groups: template.groups.map((group) =>
        group.id === groupId ? { ...group, name: normalizedLabel } : group,
      ),
      updatedAt: Date.now(),
    }));
  };

  const deleteServiceTemplateGroup = (templateId: string, groupId: string) => {
    updateServiceTemplate(templateId, (template) => {
      const nextGroups = template.groups.filter((group) => group.id !== groupId);
      const releasedItems = template.items
        .filter((item) => item.groupId === groupId)
        .map((item) => ({ ...item, groupId: null as string | null }));
      const releasedKeys = releasedItems.map((item) =>
        getServiceTemplateItemLayoutKey(item),
      );
      const nextItems = template.items.map((item) =>
        item.groupId === groupId ? { ...item, groupId: null as string | null } : item,
      );
      const currentLayout = normalizeServiceTemplateLayout(
        template.layout,
        template.groups,
        template.items,
      );
      const groupLayoutIndex = currentLayout.findIndex(
        (entry) => entry.type === "group" && entry.id === groupId,
      );
      const layoutWithoutGroup = currentLayout.filter(
        (entry) =>
          !(entry.type === "group" && entry.id === groupId) &&
          !(entry.type === "item" && releasedKeys.includes(entry.key)),
      );
      const insertIndex =
        groupLayoutIndex >= 0
          ? Math.min(groupLayoutIndex, layoutWithoutGroup.length)
          : layoutWithoutGroup.length;
      layoutWithoutGroup.splice(
        insertIndex,
        0,
        ...releasedKeys.map((key) => ({ type: "item" as const, key })),
      );
      return {
        ...template,
        groups: nextGroups,
        items: nextItems,
        layout: normalizeServiceTemplateLayout(layoutWithoutGroup, nextGroups, nextItems),
        updatedAt: Date.now(),
      };
    });
  };

  const addItemToServiceTemplate = (
    templateId: string,
    item: Omit<Service["items"][number], "addedAt"> & { addedAt?: number },
  ) => {
    updateServiceTemplate(templateId, (template) => {
      const groupId =
        item.groupId && template.groups.some((group) => group.id === item.groupId)
          ? item.groupId
          : item.type === "scripture"
          ? findBibleGroupId(template.groups)
          : null;
      const nextItem = {
        ...item,
        groupId,
        addedAt: item.addedAt ?? Date.now(),
      };
      const nextItems = [...template.items, nextItem];
      const nextLayout =
        groupId === null
          ? [
              ...normalizeServiceTemplateLayout(
                template.layout,
                template.groups,
                template.items,
              ),
              {
                type: "item" as const,
                key: getServiceTemplateItemLayoutKey(nextItem),
              },
            ]
          : normalizeServiceTemplateLayout(
              template.layout,
              template.groups,
              template.items,
            );
      return {
        ...template,
        items: nextItems,
        layout: normalizeServiceTemplateLayout(nextLayout, template.groups, nextItems),
        updatedAt: Date.now(),
      };
    });
  };

  const removeItemFromServiceTemplate = (templateId: string, index: number) => {
    updateServiceTemplate(templateId, (template) => {
      const removedItem = template.items[index];
      const nextItems = template.items.filter((_, itemIndex) => itemIndex !== index);
      const removedKey = removedItem
        ? getServiceTemplateItemLayoutKey(removedItem)
        : null;
      return {
        ...template,
        items: nextItems,
        layout: normalizeServiceTemplateLayout(
          template.layout.filter(
            (entry) => !(entry.type === "item" && entry.key === removedKey),
          ),
          template.groups,
          nextItems,
        ),
        updatedAt: Date.now(),
      };
    });
  };

  const moveServiceTemplateItemToGroup = (
    templateId: string,
    index: number,
    groupId: string | null,
    toIndex?: number,
  ) => {
    updateServiceTemplate(templateId, (template) => {
      const targetExists =
        groupId === null || template.groups.some((group) => group.id === groupId);
      if (!targetExists || !template.items[index]) {
        return template;
      }
      const sourceItem = template.items[index];
      const movedItem = {
        ...sourceItem,
        groupId,
      };
      const currentLayout = normalizeServiceTemplateLayout(
        template.layout,
        template.groups,
        template.items,
      );
      const sourceLayoutKey = getServiceTemplateItemLayoutKey(sourceItem);
      const movedLayoutKey = getServiceTemplateItemLayoutKey(movedItem);

      if (groupId === null) {
        const nextItems = template.items.map((item, itemIndex) =>
          itemIndex === index ? movedItem : item,
        );
        const layoutWithoutItem = currentLayout.filter(
          (entry) => !(entry.type === "item" && entry.key === sourceLayoutKey),
        );
        const insertIndex =
          typeof toIndex === "number" && Number.isFinite(toIndex)
            ? Math.max(0, Math.min(layoutWithoutItem.length, toIndex))
            : layoutWithoutItem.length;
        layoutWithoutItem.splice(insertIndex, 0, {
          type: "item",
          key: movedLayoutKey,
        });
        return {
          ...template,
          items: nextItems,
          layout: normalizeServiceTemplateLayout(
            layoutWithoutItem,
            template.groups,
            nextItems,
          ),
          updatedAt: Date.now(),
        };
      }

      if (typeof toIndex === "number" && Number.isFinite(toIndex)) {
        const nextItems = template.items.filter((_, itemIndex) => itemIndex !== index);
        const adjustedIndex = toIndex > index ? toIndex - 1 : toIndex;
        const boundedIndex = Math.max(0, Math.min(nextItems.length, adjustedIndex));
        nextItems.splice(boundedIndex, 0, movedItem);
        return {
          ...template,
          items: nextItems,
          layout: normalizeServiceTemplateLayout(
            currentLayout.filter(
              (entry) => !(entry.type === "item" && entry.key === sourceLayoutKey),
            ),
            template.groups,
            nextItems,
          ),
          updatedAt: Date.now(),
        };
      }
      const nextItems = template.items.map((item, itemIndex) =>
        itemIndex === index ? movedItem : item,
      );
      return {
        ...template,
        items: nextItems,
        layout: normalizeServiceTemplateLayout(
          currentLayout.filter(
            (entry) => !(entry.type === "item" && entry.key === sourceLayoutKey),
          ),
          template.groups,
          nextItems,
        ),
        updatedAt: Date.now(),
      };
    });
  };

  const reorderServiceTemplateGroup = (
    templateId: string,
    groupId: string,
    targetGroupId: string,
    position: "before" | "after",
  ) => {
    if (groupId === targetGroupId) return;
    updateServiceTemplate(templateId, (template) => {
      const orderedGroups = [...template.groups].sort(
        (left, right) => left.order - right.order,
      );
      const movingGroup = orderedGroups.find((group) => group.id === groupId);
      if (!movingGroup) return template;
      const withoutMovingGroup = orderedGroups.filter((group) => group.id !== groupId);
      const targetIndex = withoutMovingGroup.findIndex(
        (group) => group.id === targetGroupId,
      );
      if (targetIndex < 0) return template;
      const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
      withoutMovingGroup.splice(insertIndex, 0, movingGroup);
      const currentLayout = normalizeServiceTemplateLayout(
        template.layout,
        template.groups,
        template.items,
      );
      const layoutWithoutMovingGroup = currentLayout.filter(
        (entry) => !(entry.type === "group" && entry.id === groupId),
      );
      const targetLayoutIndex = layoutWithoutMovingGroup.findIndex(
        (entry) => entry.type === "group" && entry.id === targetGroupId,
      );
      const nextLayout =
        targetLayoutIndex < 0
          ? layoutWithoutMovingGroup
          : [
              ...layoutWithoutMovingGroup.slice(
                0,
                position === "after" ? targetLayoutIndex + 1 : targetLayoutIndex,
              ),
              { type: "group" as const, id: groupId },
              ...layoutWithoutMovingGroup.slice(
                position === "after" ? targetLayoutIndex + 1 : targetLayoutIndex,
              ),
            ];
      return {
        ...template,
        groups: withoutMovingGroup.map((group, order) => ({
          ...group,
          order,
        })),
        layout: normalizeServiceTemplateLayout(
          nextLayout,
          withoutMovingGroup,
          template.items,
        ),
        updatedAt: Date.now(),
      };
    });
  };

  const deleteServiceTemplate = (templateId: string) => {
    const nextTemplates = serviceTemplates.filter(
      (template) => template.id !== templateId,
    );
    const safeTemplates = nextTemplates.length
      ? nextTemplates
      : [createDefaultServiceTemplate()];
    persistServiceTemplates(safeTemplates);
    if (selectedServiceTemplateId === templateId || nextTemplates.length === 0) {
      const nextDefaultId = safeTemplates[0]?.id ?? null;
      setSelectedServiceTemplateIdState(nextDefaultId);
      saveDefaultTemplateId(nextDefaultId);
    }
  };

  const renameExistingService = async (
    serviceId: Id<"services">,
    name: string
  ) => {
    const service = services.find((item) => item._id === serviceId);
    if (!service) {
      return;
    }
    const nextService = upsertService(workspaceId, { ...service, name });
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(
      workspaceId,
      "service",
      String(serviceId),
      "update",
      nextService
    );
  };

  const deleteService = async (serviceId: Id<"services">) => {
    removeServiceLocal(workspaceId, String(serviceId));
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(
      workspaceId,
      "service",
      String(serviceId),
      "delete",
      { id: serviceId }
    );
    if (selectedServiceId === serviceId) {
      setSelectedServiceId(null);
      setIsInsideService(false);
    }
  };

  const addLibraryItemToService = async (
    serviceId: Id<"services">,
    libraryItemId: string
  ) => {
    const existingService = services.find((item) => item._id === serviceId);
    if (!existingService) {
      return;
    }
    const service = normalizeServiceGroups(existingService);
    const groupId = getSelectedGroupIdForService(service, serviceId);
    const libraryItem = libraryItems.find(
      (item) => String(item._id) === String(libraryItemId),
    );
    const label = libraryItem?.title.trim();
    const nextService = upsertService(
      workspaceId,
      appendServiceItem(service, {
        type: "library",
        refId: libraryItemId,
        ...(label ? { label } : {}),
        groupId,
        addedAt: Date.now(),
      }),
    );
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "update", nextService);
  };

  const addMediaToService = async (
    serviceId: Id<"services">,
    mediaId: string,
    mediaName: string
  ) => {
    const existingService = services.find((item) => item._id === serviceId);
    if (!existingService) {
      return;
    }
    const service = normalizeServiceGroups(existingService);
    const groupId = getSelectedGroupIdForService(service, serviceId);
    const nextService = upsertService(
      workspaceId,
      appendServiceItem(service, {
        type: "media",
        refId: mediaId,
        label: mediaName,
        groupId,
        addedAt: Date.now(),
      }),
    );
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "update", nextService);
  };

  const addScriptureToService = async (
    serviceId: Id<"services">,
    ref: string,
    text: string,
  ) => {
    const existingService = services.find((item) => item._id === serviceId);
    if (!existingService) {
      return;
    }
    const service = normalizeServiceGroups(existingService);
    const groupId =
      findBibleGroupId(service.groups) ?? getSelectedGroupIdForService(service, serviceId);
    const nextService = upsertService(
      workspaceId,
      appendServiceItem(service, {
        type: "scripture",
        refId: ref,
        label: text,
        groupId,
        addedAt: Date.now(),
      }),
    );
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "update", nextService);
  };

  const addPresentationToService = async (
    serviceId: Id<"services">,
    presentation: ServicePresentation,
  ) => {
    const existingService = services.find((item) => item._id === serviceId);
    if (!existingService) {
      return null;
    }
    const service = normalizeServiceGroups(existingService);
    const groupId = getSelectedGroupIdForService(service, serviceId);

    const refId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `presentation_${crypto.randomUUID()}`
        : `presentation_${Date.now().toString(36)}_${Math.random()
            .toString(36)
            .slice(2)}`;

    const nextService = upsertService(
      workspaceId,
      appendServiceItem(service, {
        type: "presentation",
        refId,
        label: presentation.title,
        groupId,
        addedAt: Date.now(),
        presentation,
      }),
    );
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "update", nextService);
    return refId;
  };

  const addGroupToService = async (
    serviceId: Id<"services">,
    label: string,
  ) => {
    const service = services.find((item) => item._id === serviceId);
    const normalizedLabel = label.trim();
    if (!service || !normalizedLabel) {
      return;
    }

    const normalizedService = normalizeServiceGroups(service);
    const groups = normalizedService.groups ?? [];
    const groupId = createId("group");
    const nextGroups = [
      ...groups,
      {
        id: groupId,
        name: normalizedLabel,
        order: groups.length,
      },
    ];
    const nextLayout = [
      ...normalizeServiceLayout(
        normalizedService.layout,
        groups,
        normalizedService.items,
      ),
      { type: "group" as const, id: groupId },
    ];

    const nextService = upsertService(workspaceId, {
      ...normalizedService,
      groups: nextGroups,
      layout: normalizeServiceLayout(nextLayout, nextGroups, normalizedService.items),
    });
    setServices(readOrgServices(workspaceId));
    setSelectedServiceGroupId(groupId);
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "update", nextService);
  };

  const renameServiceGroup = async (
    serviceId: Id<"services">,
    groupId: string,
    label: string,
  ) => {
    const service = services.find((item) => item._id === serviceId);
    const normalizedLabel = label.trim();
    if (!service || !normalizedLabel) {
      return;
    }

    const normalizedService = normalizeServiceGroups(service);
    const nextGroups = (normalizedService.groups ?? []).map((group) =>
      group.id === groupId ? { ...group, name: normalizedLabel } : group,
    );
    const nextService = upsertService(workspaceId, {
      ...normalizedService,
      groups: nextGroups,
    });
    setServices(readOrgServices(workspaceId));
    if (selectedServiceGroupId === groupId) {
      setSelectedServiceGroupId(null);
    }
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "update", nextService);
  };

  const deleteServiceGroup = async (
    serviceId: Id<"services">,
    groupId: string,
  ) => {
    const service = services.find((item) => item._id === serviceId);
    if (!service) {
      return;
    }

    const normalizedService = normalizeServiceGroups(service);
    const releasedItems = normalizedService.items
      .filter((item) => item.groupId === groupId)
      .map((item) => ({ ...item, groupId: null as string | null }));
    const releasedKeys = releasedItems.map((item) =>
      getServiceTemplateItemLayoutKey(item),
    );
    const nextGroups = (normalizedService.groups ?? []).filter(
      (group) => group.id !== groupId,
    );
    const nextItems = normalizedService.items.map((item) =>
      item.groupId === groupId ? { ...item, groupId: null } : item,
    );
    const currentLayout = normalizeServiceLayout(
      normalizedService.layout,
      normalizedService.groups ?? [],
      normalizedService.items,
    );
    const groupLayoutIndex = currentLayout.findIndex(
      (entry) => entry.type === "group" && entry.id === groupId,
    );
    const layoutWithoutGroup = currentLayout.filter(
      (entry) =>
        !(entry.type === "group" && entry.id === groupId) &&
        !(entry.type === "item" && releasedKeys.includes(entry.key)),
    );
    const insertIndex =
      groupLayoutIndex >= 0
        ? Math.min(groupLayoutIndex, layoutWithoutGroup.length)
        : layoutWithoutGroup.length;
    layoutWithoutGroup.splice(
      insertIndex,
      0,
      ...releasedKeys.map((key) => ({ type: "item" as const, key })),
    );
    const nextService = upsertService(workspaceId, {
      ...normalizedService,
      groups: nextGroups,
      items: orderServiceItemsByLayout(layoutWithoutGroup, nextGroups, nextItems),
      layout: normalizeServiceLayout(
        layoutWithoutGroup,
        nextGroups,
        nextItems,
      ),
    });
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "update", nextService);
  };

  const moveServiceItemToGroup = async (
    serviceId: Id<"services">,
    index: number,
    groupId: string | null,
    toIndex?: number,
  ) => {
    const service = services.find((item) => item._id === serviceId);
    if (!service) {
      return;
    }

    const normalizedService = normalizeServiceGroups(service);
    const targetExists =
      groupId === null ||
      (normalizedService.groups ?? []).some((group) => group.id === groupId);
    if (!targetExists || !normalizedService.items[index]) {
      return;
    }

    const groups = normalizedService.groups ?? [];
    const sourceItem = normalizedService.items[index];
    const movedItem = { ...sourceItem, groupId };
    const sourceLayoutKey = getServiceTemplateItemLayoutKey(sourceItem);
    const movedLayoutKey = getServiceTemplateItemLayoutKey(movedItem);
    const currentLayout = normalizeServiceLayout(
      normalizedService.layout,
      groups,
      normalizedService.items,
    );
    const nextItems = normalizedService.items.map((item, itemIndex) =>
      itemIndex === index ? movedItem : item,
    );
    const layoutWithoutSourceItem = currentLayout.filter(
      (entry) => !(entry.type === "item" && entry.key === sourceLayoutKey),
    );
    const nextLayout =
      groupId === null
        ? (() => {
            const insertIndex =
              typeof toIndex === "number" && Number.isFinite(toIndex)
                ? Math.max(0, Math.min(layoutWithoutSourceItem.length, toIndex))
                : layoutWithoutSourceItem.length;
            const layout = [...layoutWithoutSourceItem];
            layout.splice(insertIndex, 0, {
              type: "item" as const,
              key: movedLayoutKey,
            });
            return layout;
          })()
        : layoutWithoutSourceItem;

    const nextService = upsertService(workspaceId, {
      ...normalizedService,
      items: orderServiceItemsByLayout(nextLayout, groups, nextItems),
      layout: normalizeServiceLayout(nextLayout, groups, nextItems),
    });
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "update", nextService);
  };

  const renameServiceItem = async (
    serviceId: Id<"services">,
    index: number,
    label: string,
  ) => {
    const normalizedLabel = label.trim();
    const existingService = services.find((item) => item._id === serviceId);
    if (!existingService || !normalizedLabel) {
      return;
    }

    const service = normalizeServiceGroups(existingService);
    const target = service.items[index];
    if (!target) {
      return;
    }

    const nextItems = service.items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const presentation =
        item.type === "presentation" && item.presentation
          ? { ...item.presentation, title: normalizedLabel }
          : item.presentation;
      return {
        ...item,
        label: normalizedLabel,
        presentation,
      };
    });
    const nextService = upsertService(workspaceId, {
      ...service,
      items: nextItems,
    });
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "update", nextService);
  };

  const updateMediaInServices = async (
    oldMediaId: string,
    nextMedia: { id: string; name: string },
  ) => {
    const updatedServices = services
      .map((existingService) => {
        const service = normalizeServiceGroups(existingService);
        const hasMedia = service.items.some(
          (item) => item.type === "media" && item.refId === oldMediaId,
        );
        if (!hasMedia) return null;
        return upsertService(workspaceId, {
          ...service,
          items: service.items.map((item) =>
            item.type === "media" && item.refId === oldMediaId
              ? { ...item, refId: nextMedia.id, label: nextMedia.name }
              : item,
          ),
        });
      })
      .filter((service): service is Service => service !== null);

    setServices(readOrgServices(workspaceId));
    updatedServices.forEach((service) => {
      enqueueSyncOperation(workspaceId, "service", String(service._id), "update", service);
    });
  };

  const removeMediaFromServices = async (mediaId: string) => {
    const updatedServices = services
      .map((existingService) => {
        const service = normalizeServiceGroups(existingService);
        const nextItems = service.items.filter(
          (item) => !(item.type === "media" && item.refId === mediaId),
        );
        if (nextItems.length === service.items.length) {
          return null;
        }
        return upsertService(workspaceId, {
          ...service,
          items: nextItems,
        });
      })
      .filter((service): service is Service => service !== null);

    setServices(readOrgServices(workspaceId));
    updatedServices.forEach((service) => {
      enqueueSyncOperation(workspaceId, "service", String(service._id), "update", service);
    });
  };

  const updatePresentationInService = async (
    serviceId: Id<"services">,
    presentationRefId: string,
    presentation: ServicePresentation,
  ) => {
    const existingService = services.find((item) => item._id === serviceId);
    if (!existingService) {
      return;
    }
    const service = normalizeServiceGroups(existingService);

    const presentationIndex = service.items.findIndex(
      (item) => item.type === "presentation" && item.refId === presentationRefId,
    );
    if (presentationIndex < 0) {
      return;
    }

    const nextItems = service.items.map((item, index) =>
      index === presentationIndex
        ? {
            ...item,
            label: presentation.title,
            presentation,
          }
        : item,
    );

    const nextService = upsertService(workspaceId, {
      ...service,
      items: nextItems,
    });
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "update", nextService);
  };

  const removeFromService = async (
    serviceId: Id<"services">,
    index: number
  ) => {
    const existingService = services.find((item) => item._id === serviceId);
    if (!existingService) {
      return;
    }
    const service = normalizeServiceGroups(existingService);
    const nextItems = service.items.filter((_, itemIndex) => itemIndex !== index);
    const nextService = upsertService(workspaceId, { ...service, items: nextItems });
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "update", nextService);
  };

  const enterService = (serviceId: Id<"services">) => {
    setSelectedServiceId(serviceId);
    setIsInsideService(true);
    setServiceItemIndex(null);
    setSelectedServiceGroupId(null);
  };

  const exitService = () => {
    setIsInsideService(false);
    setServiceItemIndex(null);
    setSelectedServiceGroupId(null);
  };

  const reorderServiceItems = async (
    serviceId: Id<"services">,
    fromIndex: number,
    toIndex: number
  ) => {
    if (fromIndex === toIndex) return;
    const existingService = services.find((item) => item._id === serviceId);
    if (!existingService) {
      return;
    }
    const service = normalizeServiceGroups(existingService);
    const reordered = [...service.items];
    const [moved] = reordered.splice(fromIndex, 1);
    if (!moved) {
      return;
    }
    reordered.splice(toIndex, 0, moved);
    const groups = service.groups ?? [];
    const layout = normalizeServiceLayout(service.layout, groups, reordered);
    const nextService = upsertService(workspaceId, {
      ...service,
      items: orderServiceItemsByLayout(layout, groups, reordered),
      layout,
    });
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "reorder", nextService);
  };

  const reorderServices = async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const reordered = [...services];
    const [moved] = reordered.splice(fromIndex, 1);
    if (!moved) {
      return;
    }
    reordered.splice(toIndex, 0, moved);
    replaceOrgServices(workspaceId, reordered);
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(workspaceId, "service", "services", "reorder", reordered);
  };

  return {
    services,
    isLoading: false,
    selectedService,
    selectedServiceId,
    isInsideService,
    serviceItemIndex,
    selectedServiceGroupId,
    serviceItems,
    serviceTemplates,
    selectedServiceTemplateId,
    setSelectedServiceId,
    setServiceItemIndex,
    setSelectedServiceGroupId,
    createNewService,
    selectDefaultServiceTemplate,
    createServiceTemplate,
    renameServiceTemplate,
    addGroupToServiceTemplate,
    renameServiceTemplateGroup,
    deleteServiceTemplateGroup,
    addItemToServiceTemplate,
    removeItemFromServiceTemplate,
    moveServiceTemplateItemToGroup,
    reorderServiceTemplateGroup,
    deleteServiceTemplate,
    renameExistingService,
    deleteService,
    addLibraryItemToService,
    addMediaToService,
    addScriptureToService,
    addPresentationToService,
    addGroupToService,
    renameServiceGroup,
    deleteServiceGroup,
    moveServiceItemToGroup,
    renameServiceItem,
    updateMediaInServices,
    removeMediaFromServices,
    updatePresentationInService,
    removeFromService,
    reorderServiceItems,
    reorderServices,
    enterService,
    exitService,
  };
}
