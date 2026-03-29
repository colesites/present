"use client";

import { useMemo, useState, useEffect } from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { LibraryItem, Service } from "../../../shared/types";
import {
  createLocalService,
  enqueueSyncOperation,
  readOrgServices,
  removeServiceLocal,
  replaceOrgServices,
  upsertService,
} from "../../../renderer/shared/offline/localData";

export type ServiceItemType = "library" | "media" | "scripture";

const SERVICE_STATE_KEY = "present-service-state";

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

  useEffect(() => {
    setServices(readOrgServices(workspaceId));
  }, [workspaceId]);

  // Persist state changes
  useEffect(() => {
    saveServiceState({
      selectedServiceId: selectedServiceId as string | null,
      isInsideService,
      serviceItemIndex,
    });
  }, [selectedServiceId, isInsideService, serviceItemIndex]);

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
    return services.find((s) => s._id === selectedServiceId) ?? null;
  }, [selectedServiceId, services]);

  // Service items with resolved library items
  const serviceItems = useMemo(() => {
    if (!selectedService) return [];
    return selectedService.items.map(
      (
        item: {
          type: ServiceItemType;
          refId: string;
          label?: string;
          addedAt: number;
        },
        index: number,
      ) => {
        if (item.type === "library") {
          const libraryItem = libraryItems.find((s: LibraryItem) => s._id === item.refId);
          return { ...item, libraryItem, index };
        }
        return { ...item, libraryItem: null, index };
      },
    );
  }, [selectedService, libraryItems]);

  const createNewService = async (name: string) => {
    if (!name.trim()) return null;
    const nextService = createLocalService(workspaceId, {
      name: name.trim(),
      date: undefined,
      items: [],
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
    const service = services.find((item) => item._id === serviceId);
    if (!service) {
      return;
    }
    const nextService = upsertService(workspaceId, {
      ...service,
      items: [...service.items, { type: "library", refId: libraryItemId, addedAt: Date.now() }],
    });
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "update", nextService);
  };

  const addMediaToService = async (
    serviceId: Id<"services">,
    mediaId: string,
    mediaName: string
  ) => {
    const service = services.find((item) => item._id === serviceId);
    if (!service) {
      return;
    }
    const nextService = upsertService(workspaceId, {
      ...service,
      items: [
        ...service.items,
        { type: "media", refId: mediaId, label: mediaName, addedAt: Date.now() },
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
    const service = services.find((item) => item._id === serviceId);
    if (!service) {
      return;
    }
    const nextService = upsertService(workspaceId, {
      ...service,
      items: [
        ...service.items,
        { type: "scripture", refId: ref, label: text, addedAt: Date.now() },
      ],
    });
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "update", nextService);
  };

  const removeFromService = async (
    serviceId: Id<"services">,
    index: number
  ) => {
    const service = services.find((item) => item._id === serviceId);
    if (!service) {
      return;
    }
    const nextItems = service.items.filter((_, itemIndex) => itemIndex !== index);
    const nextService = upsertService(workspaceId, { ...service, items: nextItems });
    setServices(readOrgServices(workspaceId));
    enqueueSyncOperation(workspaceId, "service", String(serviceId), "update", nextService);
  };

  const enterService = (serviceId: Id<"services">) => {
    setSelectedServiceId(serviceId);
    setIsInsideService(true);
    setServiceItemIndex(null);
  };

  const exitService = () => {
    setIsInsideService(false);
    setServiceItemIndex(null);
  };

  const reorderServiceItems = async (
    serviceId: Id<"services">,
    fromIndex: number,
    toIndex: number
  ) => {
    if (fromIndex === toIndex) return;
    const service = services.find((item) => item._id === serviceId);
    if (!service) {
      return;
    }
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
    services: services as any,
    isLoading: false,
    selectedService,
    selectedServiceId,
    isInsideService,
    serviceItemIndex,
    serviceItems,
    setSelectedServiceId,
    setServiceItemIndex,
    createNewService,
    renameExistingService,
    deleteService,
    addLibraryItemToService,
    addMediaToService,
    addScriptureToService,
    removeFromService,
    reorderServiceItems,
    reorderServices,
    enterService,
    exitService,
  };
}
