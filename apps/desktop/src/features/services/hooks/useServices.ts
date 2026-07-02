"use client";

import { useMemo, useState, useEffect } from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type {
  LibraryItem,
  Service,
  ServiceGroup,
  ServiceItem,
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
  createdAt: number;
  updatedAt: number;
};

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

const createDefaultServiceTemplate = (): ServiceTemplate => {
  const stamp = Date.now();
  return {
    id: "default-sunday-service",
    name: "Sunday service template",
    groups: groupsFromNames(DEFAULT_SERVICE_TEMPLATE_GROUPS),
    items: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
};

const cloneTemplateForService = (template: ServiceTemplate) => {
  const groupIdMap = new Map<string, string>();
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
      return {
        ...item,
        refId,
        groupId,
        addedAt: Date.now(),
      };
    });

  return { groups, items };
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
        ? [
            {
              ...createDefaultServiceTemplate(),
              groups: groupsFromNames(names),
            },
          ]
        : fallback;
    }
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return fallback;
    const templates = parsed
      .map((template): ServiceTemplate | null => {
        if (!template || typeof template !== "object") return null;
        const candidate = template as Partial<ServiceTemplate>;
        if (!candidate.id || !candidate.name) return null;
        return {
          id: String(candidate.id),
          name: String(candidate.name),
          groups: Array.isArray(candidate.groups)
            ? candidate.groups.map((group, index) => ({
                id: String(group.id || createId("group")),
                name: String(group.name || "Group"),
                order: Number.isFinite(group.order) ? group.order : index,
              }))
            : [],
          items: Array.isArray(candidate.items)
            ? candidate.items.filter((item) => item.type !== "group")
            : [],
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
    return {
      ...service,
      groups: existingGroups
        .map((group, index) => ({
          ...group,
          order: Number.isFinite(group.order) ? group.order : index,
        }))
        .sort((left, right) => left.order - right.order),
      items: service.items.filter((item) => item.type !== "group"),
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

  return { ...service, groups, items };
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
    if (!selectedService?.groups?.some((group) => group.id === selectedServiceGroupId)) {
      setSelectedServiceGroupId(null);
    }
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

  // Service items with resolved library items
  const serviceItems = useMemo<ServiceItem[]>(() => {
    if (!selectedService) return [];
    return selectedService.items
      .filter((item) => item.type !== "group")
      .map(
      (item: Service["items"][number], index: number): ServiceItem => {
        if (item.type === "library") {
          const libraryItem = libraryItems.find((s: LibraryItem) => s._id === item.refId);
          return { ...item, libraryItem, presentation: null, index };
        }
        return { ...item, libraryItem: null, presentation: item.presentation ?? null, index };
      },
    );
  }, [selectedService, libraryItems]);

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
      : { groups: [], items: [] };
    const nextService = createLocalService(workspaceId, {
      name: name.trim(),
      date: undefined,
      groups: templatePayload.groups,
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
    updateServiceTemplate(templateId, (template) => ({
      ...template,
      groups: template.groups.filter((group) => group.id !== groupId),
      items: template.items.map((item) =>
        item.groupId === groupId ? { ...item, groupId: null } : item,
      ),
      updatedAt: Date.now(),
    }));
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
      return {
        ...template,
        items: [
          ...template.items,
          {
            ...item,
            groupId,
            addedAt: item.addedAt ?? Date.now(),
          },
        ],
        updatedAt: Date.now(),
      };
    });
  };

  const removeItemFromServiceTemplate = (templateId: string, index: number) => {
    updateServiceTemplate(templateId, (template) => ({
      ...template,
      items: template.items.filter((_, itemIndex) => itemIndex !== index),
      updatedAt: Date.now(),
    }));
  };

  const moveServiceTemplateItemToGroup = (
    templateId: string,
    index: number,
    groupId: string | null,
  ) => {
    updateServiceTemplate(templateId, (template) => {
      const targetExists =
        groupId === null || template.groups.some((group) => group.id === groupId);
      if (!targetExists || !template.items[index]) {
        return template;
      }
      return {
        ...template,
        items: template.items.map((item, itemIndex) =>
          itemIndex === index ? { ...item, groupId } : item,
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
    const groupId =
      findBibleGroupId(service.groups) ?? getSelectedGroupIdForService(service, serviceId);
    const nextService = upsertService(workspaceId, {
      ...service,
      items: [
        ...service.items,
        { type: "library", refId: libraryItemId, groupId, addedAt: Date.now() },
      ],
    });
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
    const nextService = upsertService(workspaceId, {
      ...service,
      items: [
        ...service.items,
        { type: "media", refId: mediaId, label: mediaName, groupId, addedAt: Date.now() },
      ],
    });
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
    const groupId = getSelectedGroupIdForService(service, serviceId);
    const nextService = upsertService(workspaceId, {
      ...service,
      items: [
        ...service.items,
        { type: "scripture", refId: ref, label: text, groupId, addedAt: Date.now() },
      ],
    });
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

    const nextService = upsertService(workspaceId, {
      ...service,
      items: [
        ...service.items,
        {
          type: "presentation",
          refId,
          label: presentation.title,
          groupId,
          addedAt: Date.now(),
          presentation,
        },
      ],
    });
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

    const nextService = upsertService(workspaceId, {
      ...normalizedService,
      groups: [
        ...groups,
        {
          id: createId("group"),
          name: normalizedLabel,
          order: groups.length,
        },
      ],
    });
    setServices(readOrgServices(workspaceId));
    setSelectedServiceGroupId(nextService.groups?.at(-1)?.id ?? null);
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
    const nextService = upsertService(workspaceId, {
      ...normalizedService,
      groups: (normalizedService.groups ?? []).filter((group) => group.id !== groupId),
      items: normalizedService.items.map((item) =>
        item.groupId === groupId ? { ...item, groupId: null } : item,
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

    const nextItems = normalizedService.items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, groupId } : item,
    );
    if (typeof toIndex === "number" && Number.isFinite(toIndex)) {
      const [moved] = nextItems.splice(index, 1);
      if (!moved) {
        return;
      }
      const adjustedIndex = index < toIndex ? toIndex - 1 : toIndex;
      const clampedIndex = Math.max(0, Math.min(adjustedIndex, nextItems.length));
      nextItems.splice(clampedIndex, 0, moved);
    }
    const nextService = upsertService(workspaceId, {
      ...normalizedService,
      items: nextItems,
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
    const nextService = upsertService(workspaceId, { ...service, items: reordered });
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
