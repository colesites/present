"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { LibraryItem, Service } from "../../../types";

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
  input: { orgId: Id<"organizations"> | null; userId: Id<"users"> | null },
  libraryItems: LibraryItem[],
) {
  const { orgId } = input;
  // Use unified service API which handles workspace routing and authorization
  const services = useQuery(
    api.services.list,
    { workspaceId: orgId ?? undefined }
  ) as Service[] | undefined;

  const createService = useMutation(api.services.create);
  const renameService = useMutation(api.services.update); // Unified update handles rename
  const removeService = useMutation(api.services.remove);
  const addItemToService = useMutation(api.services.addItem);
  const removeItemFromService = useMutation(api.services.removeItem);
  const reorderItemsMutation = useMutation(api.services.reorderItems);
  const reorderServicesMutation = useMutation(api.services.reorderServices);

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
    if (services && selectedServiceId) {
      const exists = services.some((s) => s._id === selectedServiceId);
      if (!exists) {
        // Run asynchronously to avoid state update strictly during the effect commit phase
        setTimeout(() => {
          setSelectedServiceId(null);
          setIsInsideService(false);
          setServiceItemIndex(null);
        }, 0);
      }
    }
  }, [services, selectedServiceId]);

  const selectedService = useMemo(() => {
    if (!selectedServiceId || !services) return null;
    return services.find((s) => s._id === selectedServiceId) ?? null;
  }, [selectedServiceId, services]);

  // Service items with resolved library items
  const serviceItems = useMemo(() => {
    if (!selectedService || !libraryItems) return [];
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
    const id = await createService({
      workspaceId: orgId ?? undefined,
      name: name.trim(),
    } as any);
    return id;
  };

  const renameExistingService = async (
    serviceId: Id<"services">,
    name: string
  ) => {
    await renameService({ 
      workspaceId: orgId ?? undefined,
      serviceId: serviceId as any, 
      name 
    } as any);
  };

  const deleteService = async (serviceId: Id<"services">) => {
    await removeService({ 
      workspaceId: orgId ?? undefined,
      serviceId: serviceId as any 
    } as any);
    if (selectedServiceId === serviceId) {
      setSelectedServiceId(null);
      setIsInsideService(false);
    }
  };

  const addLibraryItemToService = async (
    serviceId: Id<"services">,
    libraryItemId: string
  ) => {
    await addItemToService({ 
      workspaceId: orgId ?? undefined,
      serviceId: serviceId as any, 
      type: "library", 
      refId: libraryItemId 
    } as any);
  };

  const addMediaToService = async (
    serviceId: Id<"services">,
    mediaId: string,
    mediaName: string
  ) => {
    await addItemToService({
      workspaceId: orgId ?? undefined,
      serviceId: serviceId as any,
      type: "media",
      refId: mediaId,
      label: mediaName,
    } as any);
  };

  const addScriptureToService = async (
    serviceId: Id<"services">,
    ref: string,
    text: string,
  ) => {
    await addItemToService({
      workspaceId: orgId ?? undefined,
      serviceId: serviceId as any,
      type: "scripture",
      refId: ref,
      label: text,
    } as any);
  };

  const removeFromService = async (
    serviceId: Id<"services">,
    index: number
  ) => {
    await removeItemFromService({ 
      workspaceId: orgId ?? undefined,
      serviceId: serviceId as any, 
      itemIndex: index 
    } as any);
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
    await reorderItemsMutation({ 
      workspaceId: orgId ?? undefined,
      serviceId: serviceId as any, 
      fromIndex, 
      toIndex 
    } as any);
  };

  const reorderServices = async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    await reorderServicesMutation({ 
      workspaceId: orgId ?? undefined,
      fromIndex, 
      toIndex 
    } as any);
  };

  return {
    services: (services ?? []) as any,
    isLoading: Boolean(orgId) && services === undefined,
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
