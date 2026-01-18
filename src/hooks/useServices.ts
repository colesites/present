"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import type { Song } from "@/types";

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
  );
  const createService = useMutation(api.services.create);
  const renameService = useMutation(api.services.rename);
  const removeService = useMutation(api.services.remove);
  const addItemToService = useMutation(api.services.addItem);
  const removeItemFromService = useMutation(api.services.removeItem);

  // Initialize with defaults (matches server render)
  const [selectedServiceId, setSelectedServiceId] =
    useState<Id<"services"> | null>(null);
  const [isInsideService, setIsInsideService] = useState(false);
  const [serviceItemIndex, setServiceItemIndex] = useState<number | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Restore persisted state after hydration
  useEffect(() => {
    const stored = loadServiceState();
    if (stored) {
      if (stored.selectedServiceId) {
        setSelectedServiceId(stored.selectedServiceId as Id<"services">);
      }
      if (stored.isInsideService) {
        setIsInsideService(stored.isInsideService);
      }
      if (stored.serviceItemIndex !== null) {
        setServiceItemIndex(stored.serviceItemIndex);
      }
    }
    setIsHydrated(true);
  }, []);

  // Persist state changes (only after hydration to avoid overwriting with defaults)
  useEffect(() => {
    if (!isHydrated) return;
    saveServiceState({
      selectedServiceId: selectedServiceId as string | null,
      isInsideService,
      serviceItemIndex,
    });
  }, [isHydrated, selectedServiceId, isInsideService, serviceItemIndex]);

  // Validate restored service still exists
  useEffect(() => {
    if (services && selectedServiceId) {
      const exists = services.some((s) => s._id === selectedServiceId);
      if (!exists) {
        setSelectedServiceId(null);
        setIsInsideService(false);
        setServiceItemIndex(null);
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
    return selectedService.items.map((item, index) => {
      if (item.type === "song") {
        const song = songs.find((s) => s._id === item.refId);
        return { ...item, song, index };
      }
      return { ...item, song: null, index };
    });
  }, [selectedService, songs]);

  const createNewService = async (name: string) => {
    if (!orgId || !name.trim()) return null;
    const id = await createService({ orgId, name: name.trim() });
    return id;
  };

  const renameExistingService = async (
    serviceId: Id<"services">,
    name: string,
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
    songId: Id<"songs">,
  ) => {
    await addItemToService({ serviceId, type: "song", refId: songId });
  };

  const addMediaToService = async (
    serviceId: Id<"services">,
    mediaId: string,
    mediaName: string,
  ) => {
    await addItemToService({
      serviceId,
      type: "media",
      refId: mediaId,
      label: mediaName,
    });
  };

  const removeFromService = async (
    serviceId: Id<"services">,
    index: number,
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

  return {
    services: services ?? [],
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
    removeFromService,
    enterService,
    exitService,
  };
}
