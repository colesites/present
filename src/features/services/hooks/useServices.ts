"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
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

export function useServices(orgId: Id<"organizations"> | null, songs: Song[]) {
  // Use plain Convex query - no caching to avoid data conflicts
  const services = useQuery(
    api.services.listByOrg,
    orgId ? { orgId } : "skip",
  ) as Service[] | undefined;
  const createService = useMutation(api.services.create);
  const renameService = useMutation(api.services.rename);
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
    if (!orgId || !name.trim()) return null;
    const id = await createService({ orgId, name: name.trim() });
    return id;
  };

  const renameExistingService = async (
    serviceId: Id<"services">,
    name: string
  ) => {
    await renameService({ serviceId, name });
  };

  const deleteService = async (serviceId: Id<"services">) => {
    await removeService({ serviceId });
    if (selectedServiceId === serviceId) {
      setSelectedServiceId(null);
      setIsInsideService(false);
    }
  };

  const addSongToService = async (
    serviceId: Id<"services">,
    songId: Id<"songs">
  ) => {
    await addItemToService({ serviceId, type: "song", refId: songId });
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
    });
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
    });
  };

  const removeFromService = async (
    serviceId: Id<"services">,
    index: number
  ) => {
    await removeItemFromService({ serviceId, itemIndex: index });
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
    await reorderItemsMutation({ serviceId, fromIndex, toIndex });
  };

  const reorderServices = async (fromIndex: number, toIndex: number) => {
    if (!orgId || fromIndex === toIndex) return;
    await reorderServicesMutation({ orgId, fromIndex, toIndex });
  };

  return {
    services: services ?? [],
    isLoading: services === undefined,
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
