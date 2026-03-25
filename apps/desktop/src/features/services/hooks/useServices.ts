"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { Song, Service } from "../../../types";

export type ServiceItemType = "song" | "media" | "scripture";

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
  songs: Song[],
) {
  const { orgId, userId } = input;
  // Use plain Convex query - no caching to avoid data conflicts
  const services = useQuery(
    orgId ? api.services.listByOrg : api.personalServices.listByUser,
    orgId ? { orgId } : userId ? { userId } : "skip",
  ) as Service[] | undefined;
  const createService = useMutation(orgId ? api.services.create : api.personalServices.create);
  const renameService = useMutation(orgId ? api.services.rename : api.personalServices.rename);
  const removeService = useMutation(orgId ? api.services.remove : api.personalServices.remove);
  const addItemToService = useMutation(orgId ? api.services.addItem : api.personalServices.addItem);
  const removeItemFromService = useMutation(
    orgId ? api.services.removeItem : api.personalServices.removeItem,
  );
  const reorderItemsMutation = useMutation(
    orgId ? api.services.reorderItems : api.personalServices.reorderItems,
  );
  const reorderServicesMutation = useMutation(
    orgId ? api.services.reorderServices : api.personalServices.reorderServices,
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

  // Service items with resolved songs
  const serviceItems = useMemo(() => {
    if (!selectedService || !songs) return [];
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
        if (item.type === "song") {
          const song = songs.find((s: Song) => s._id === item.refId);
          return { ...item, song, index };
        }
        return { ...item, song: null, index };
      },
    );
  }, [selectedService, songs]);

  const createNewService = async (name: string) => {
    if (!name.trim()) return null;
    if (!orgId && !userId) {
      throw new Error("Account not ready yet. Please wait a moment and try again.");
    }
    const id = await createService(
      orgId
        ? ({ orgId, name: name.trim() } as any)
        : ({ userId, name: name.trim() } as any),
    );
    return id;
  };

  const renameExistingService = async (
    serviceId: Id<"services">,
    name: string
  ) => {
    await renameService({ serviceId, name } as any);
  };

  const deleteService = async (serviceId: Id<"services">) => {
    await removeService({ serviceId } as any);
    if (selectedServiceId === serviceId) {
      setSelectedServiceId(null);
      setIsInsideService(false);
    }
  };

  const addSongToService = async (
    serviceId: Id<"services">,
    songId: Id<"songs">
  ) => {
    await addItemToService({ serviceId, type: "song", refId: songId } as any);
  };

  const addMediaToService = async (
    serviceId: Id<"services">,
    mediaId: string,
    mediaName: string
  ) => {
    await addItemToService({
      serviceId,
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
      serviceId,
      type: "scripture",
      refId: ref,
      label: text,
    } as any);
  };

  const removeFromService = async (
    serviceId: Id<"services">,
    index: number
  ) => {
    await removeItemFromService({ serviceId, itemIndex: index } as any);
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
    await reorderItemsMutation({ serviceId, fromIndex, toIndex } as any);
  };

  const reorderServices = async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    if (orgId) {
      await reorderServicesMutation({ orgId, fromIndex, toIndex } as any);
      return;
    }
    if (!userId) {
      throw new Error("Account not ready yet. Please wait a moment and try again.");
    }
    await reorderServicesMutation({ userId, fromIndex, toIndex } as any);
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
    addSongToService,
    addMediaToService,
    addScriptureToService,
    removeFromService,
    reorderServiceItems,
    reorderServices,
    enterService,
    exitService,
  };
}
