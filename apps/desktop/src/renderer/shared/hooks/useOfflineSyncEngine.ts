"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useConvex } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { LibrarySlide, Service } from "../../../shared/types";
import type { SyncQueueItem } from "../offline/localData";
import {
  readOrgLibraryItems,
  readOrgServices,
  readSyncQueue,
  removeSyncQueueItems,
} from "../offline/localData";
import { ensureFreshDesktopAccessToken } from "../store/desktopSession";

const ID_MAP_STORAGE_KEY = "present-sync-id-map-v1";
const MAX_BATCH_SIZE = 20;
const RETRY_MIN_DELAY_MS = 1_500;
const RETRY_MAX_DELAY_MS = 30_000;

type IdMapByOrg = Record<string, Record<string, string>>;
type SyncIdMap = {
  library: IdMapByOrg;
  service: IdMapByOrg;
};

type SyncEntityType = "library" | "service";

const EMPTY_ID_MAP: SyncIdMap = {
  library: {},
  service: {},
};

const normalizeWorkspaceId = (orgId: string): string | undefined => {
  return orgId === "personal" ? undefined : orgId;
};

const readIdMap = (): SyncIdMap => {
  if (typeof window === "undefined") {
    return EMPTY_ID_MAP;
  }

  try {
    const raw = window.localStorage.getItem(ID_MAP_STORAGE_KEY);
    if (!raw) {
      return { ...EMPTY_ID_MAP, library: {}, service: {} };
    }
    const parsed = JSON.parse(raw) as Partial<SyncIdMap>;
    return {
      library: parsed.library ?? {},
      service: parsed.service ?? {},
    };
  } catch {
    return { ...EMPTY_ID_MAP, library: {}, service: {} };
  }
};

const writeIdMap = (value: SyncIdMap) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(ID_MAP_STORAGE_KEY, JSON.stringify(value));
  } catch (error) {
    console.error("[SyncEngine] failed to persist ID map", error);
  }
};

const resolveMappedId = (
  idMap: SyncIdMap,
  entityType: SyncEntityType,
  orgId: string,
  localId: string,
): string => {
  return idMap[entityType]?.[orgId]?.[localId] ?? localId;
};

const getMappedId = (
  idMap: SyncIdMap,
  entityType: SyncEntityType,
  orgId: string,
  localId: string,
): string | null => {
  return idMap[entityType]?.[orgId]?.[localId] ?? null;
};

const setMappedId = (
  idMap: SyncIdMap,
  entityType: SyncEntityType,
  orgId: string,
  localId: string,
  remoteId: string,
) => {
  if (!idMap[entityType][orgId]) {
    idMap[entityType][orgId] = {};
  }
  idMap[entityType][orgId][localId] = remoteId;
};

const removeMappedId = (
  idMap: SyncIdMap,
  entityType: SyncEntityType,
  orgId: string,
  localId: string,
) => {
  const orgMap = idMap[entityType][orgId];
  if (!orgMap) {
    return;
  }
  delete orgMap[localId];
  if (Object.keys(orgMap).length === 0) {
    delete idMap[entityType][orgId];
  }
};

const toBackendSlides = (slides: LibrarySlide[]) =>
  slides.map((slide) => ({
    text: slide.text ?? "",
    label: slide.label || undefined,
    modifier: slide.modifier || undefined,
    backgroundId: slide.backgroundId || undefined,
  }));

const toSyncableServiceItems = (
  service: Service,
  idMap: SyncIdMap,
  orgId: string,
) => {
  return service.items
    .filter(
      (item): item is Service["items"][number] & {
        type: "library" | "media" | "scripture" | "presentation";
      } =>
        item.type === "library" ||
        item.type === "media" ||
        item.type === "scripture" ||
        item.type === "presentation",
    )
    .map((item) => ({
      ...item,
      refId:
        item.type === "library"
          ? resolveMappedId(idMap, "library", orgId, item.refId)
          : item.refId,
      presentation:
        item.type === "presentation" && item.presentation
          ? {
              title: item.presentation.title,
              sourceType: item.presentation.sourceType,
            }
          : item.presentation,
    }));
};

const getLocalLibrary = (orgId: string, entityId: string) =>
  readOrgLibraryItems(orgId).find((item) => String(item._id) === entityId) ?? null;

const getLocalService = (orgId: string, entityId: string) =>
  readOrgServices(orgId).find((item) => String(item._id) === entityId) ?? null;

type SyncEngineParams = {
  enabled: boolean;
};

export function useOfflineSyncEngine({ enabled }: SyncEngineParams) {
  const convex = useConvex();
  const runningRef = useRef(false);
  const retryDelayRef = useRef(RETRY_MIN_DELAY_MS);
  const retryTimerRef = useRef<number | null>(null);
  const idMapRef = useRef<SyncIdMap>(readIdMap());

  const persistIdMap = useCallback(() => {
    writeIdMap(idMapRef.current);
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback(
    (runner: () => void) => {
      clearRetryTimer();
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        runner();
      }, retryDelayRef.current);
      retryDelayRef.current = Math.min(
        RETRY_MAX_DELAY_MS,
        retryDelayRef.current * 2,
      );
    },
    [clearRetryTimer],
  );

  const resetBackoff = useCallback(() => {
    retryDelayRef.current = RETRY_MIN_DELAY_MS;
  }, []);

  const syncServiceItems = useCallback(
    async (orgId: string, remoteServiceId: string, desiredService: Service) => {
      const workspaceId = normalizeWorkspaceId(orgId);
      const remoteService = await convex.query(api.services.get, {
        workspaceId,
        serviceId: remoteServiceId,
      });

      const remoteItemCount = Array.isArray(remoteService?.items)
        ? remoteService.items.length
        : 0;

      for (let index = remoteItemCount - 1; index >= 0; index -= 1) {
        await convex.mutation(api.services.removeItem, {
          workspaceId,
          serviceId: remoteServiceId,
          itemIndex: index,
        });
      }

      const desiredItems = toSyncableServiceItems(
        desiredService,
        idMapRef.current,
        orgId,
      );

      for (const item of desiredItems) {
        await convex.mutation(api.services.addItem, {
          workspaceId,
          serviceId: remoteServiceId,
          type: item.type as "library" | "media" | "scripture",
          refId: item.refId,
          label: item.label,
          presentation:
            item.type === "presentation" ? item.presentation ?? null : undefined,
        } as never);
      }
    },
    [convex],
  );

  const syncServiceOrder = useCallback(
    async (orgId: string, desiredServiceLocalIds: string[]) => {
      if (desiredServiceLocalIds.length === 0) {
        return;
      }

      const workspaceId = normalizeWorkspaceId(orgId);
      const remoteServices = await convex.query(api.services.list, {
        workspaceId,
      });
      const currentIds = remoteServices.map((service) => String(service._id));
      const desiredRemoteIds = desiredServiceLocalIds
        .map((id) => resolveMappedId(idMapRef.current, "service", orgId, id))
        .filter((id) => currentIds.includes(id));

      for (let targetIndex = 0; targetIndex < desiredRemoteIds.length; targetIndex += 1) {
        const targetId = desiredRemoteIds[targetIndex];
        const currentIndex = currentIds.indexOf(targetId);
        if (currentIndex < 0 || currentIndex === targetIndex) {
          continue;
        }

        await convex.mutation(api.services.reorderServices, {
          workspaceId,
          fromIndex: currentIndex,
          toIndex: targetIndex,
        });

        currentIds.splice(currentIndex, 1);
        currentIds.splice(targetIndex, 0, targetId);
      }
    },
    [convex],
  );

  const processItem = useCallback(
    async (item: SyncQueueItem): Promise<"ok" | "retry"> => {
      const workspaceId = normalizeWorkspaceId(item.orgId);
      const entityId = item.entityId;

      try {
        if (item.entityType === "library") {
          if (item.operation === "delete") {
            const remoteId = getMappedId(
              idMapRef.current,
              "library",
              item.orgId,
              entityId,
            );
            if (!remoteId) {
              return "ok";
            }
            await convex.mutation(api.libraries.remove, {
              workspaceId,
              libraryId: remoteId,
            });
            removeMappedId(idMapRef.current, "library", item.orgId, entityId);
            persistIdMap();
            return "ok";
          }

          const localItem = getLocalLibrary(item.orgId, entityId);
          if (!localItem) {
            return "ok";
          }

          const mappedRemoteId = idMapRef.current.library?.[item.orgId]?.[entityId];
          const payload = {
            workspaceId,
            categoryId: localItem.categoryId
              ? String(localItem.categoryId)
              : undefined,
            title: localItem.title,
            body: localItem.body,
            slides: toBackendSlides(localItem.slides),
          };

          if (mappedRemoteId) {
            await convex.mutation(api.libraries.update, {
              ...payload,
              libraryId: mappedRemoteId,
            });
          } else if (item.operation === "create") {
            const createdId = await convex.mutation(api.libraries.create, payload);
            if (typeof createdId === "string") {
              setMappedId(
                idMapRef.current,
                "library",
                item.orgId,
                entityId,
                createdId,
              );
              persistIdMap();
            }
          } else {
            const createdId = await convex.mutation(api.libraries.create, payload);
            if (typeof createdId === "string") {
              setMappedId(
                idMapRef.current,
                "library",
                item.orgId,
                entityId,
                createdId,
              );
              persistIdMap();
            }
          }

          return "ok";
        }

        if (item.entityType === "service") {
          if (item.operation === "reorder" && item.entityId === "services") {
            const desiredLocalServices = readOrgServices(item.orgId).map((service) =>
              String(service._id),
            );
            await syncServiceOrder(item.orgId, desiredLocalServices);
            return "ok";
          }

          if (item.operation === "delete") {
            const remoteId = getMappedId(
              idMapRef.current,
              "service",
              item.orgId,
              entityId,
            );
            if (!remoteId) {
              return "ok";
            }
            await convex.mutation(api.services.remove, {
              workspaceId,
              serviceId: remoteId,
            });
            removeMappedId(idMapRef.current, "service", item.orgId, entityId);
            persistIdMap();
            return "ok";
          }

          const localService = getLocalService(item.orgId, entityId);
          if (!localService) {
            return "ok";
          }

          let remoteServiceId =
            idMapRef.current.service?.[item.orgId]?.[entityId] ?? null;

          if (!remoteServiceId) {
            const createdId = await convex.mutation(api.services.create, {
              workspaceId,
              name: localService.name,
              date: localService.date,
            });
            remoteServiceId = String(createdId);
            setMappedId(
              idMapRef.current,
              "service",
              item.orgId,
              entityId,
              remoteServiceId,
            );
            persistIdMap();
          } else {
            await convex.mutation(api.services.update, {
              workspaceId,
              serviceId: remoteServiceId,
              name: localService.name,
              date: localService.date,
            });
          }

          await syncServiceItems(item.orgId, remoteServiceId, localService);
          return "ok";
        }

        return "ok";
      } catch (error) {
        console.error("[SyncEngine] queue item sync failed", {
          itemId: item.id,
          entityType: item.entityType,
          entityId: item.entityId,
          operation: item.operation,
          error,
        });
        return "retry";
      }
    },
    [convex, persistIdMap, syncServiceItems, syncServiceOrder],
  );

  const runSync = useCallback(async () => {
    if (!enabled || runningRef.current) {
      return;
    }

    runningRef.current = true;
    clearRetryTimer();

    try {
      const token = await ensureFreshDesktopAccessToken();
      if (!token) {
        scheduleRetry(() => {
          void runSync();
        });
        return;
      }
      let hasPendingItems = readSyncQueue().length > 0;
      while (hasPendingItems) {
        const queue = readSyncQueue().sort(
          (left, right) => left.updatedAt - right.updatedAt,
        );
        if (queue.length === 0) {
          resetBackoff();
          return;
        }

        const batch = queue.slice(0, MAX_BATCH_SIZE);
        const successfulIds: string[] = [];

        for (const item of batch) {
          const result = await processItem(item);
          if (result !== "ok") {
            break;
          }
          successfulIds.push(item.id);
        }

        if (successfulIds.length > 0) {
          removeSyncQueueItems(successfulIds);
        }

        const batchFullySucceeded = successfulIds.length === batch.length;
        if (!batchFullySucceeded) {
          scheduleRetry(() => {
            void runSync();
          });
          return;
        }

        hasPendingItems = readSyncQueue().length > 0;
      }

      resetBackoff();
      return;
    } finally {
      runningRef.current = false;
    }
  }, [
    clearRetryTimer,
    enabled,
    processItem,
    resetBackoff,
    scheduleRetry,
  ]);

  const onlineListener = useMemo(
    () => () => {
      void runSync();
    },
    [runSync],
  );

  useEffect(() => {
    if (!enabled) {
      clearRetryTimer();
      return;
    }

    void runSync();

    window.addEventListener("online", onlineListener);
    const intervalId = window.setInterval(() => {
      void runSync();
    }, 20_000);

    return () => {
      window.removeEventListener("online", onlineListener);
      window.clearInterval(intervalId);
      clearRetryTimer();
    };
  }, [clearRetryTimer, enabled, onlineListener, runSync]);
}
