"use client";

import type { LibraryItem, Service } from "../../../shared/types";

export type OfflineEntityType = "library" | "service";
export type OfflineOperation = "create" | "update" | "delete" | "reorder";

export interface SyncQueueItem {
  id: string;
  orgId: string;
  entityType: OfflineEntityType;
  entityId: string;
  operation: OfflineOperation;
  payload: unknown;
  updatedAt: number;
  version: number;
}

interface PersistedLocalState {
  libraryItems: LibraryItem[];
  services: Service[];
}

const LOCAL_DATA_KEY = "present-local-data-v1";
const SYNC_QUEUE_KEY = "present-sync-queue-v1";

const now = () => Date.now();

const uid = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(36).slice(2)}_${now().toString(36)}`;
};

const readJson = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
};

const readLocalState = (): PersistedLocalState =>
  readJson<PersistedLocalState>(LOCAL_DATA_KEY, { libraryItems: [], services: [] });

const writeLocalState = (state: PersistedLocalState) => {
  writeJson(LOCAL_DATA_KEY, state);
};

const nextVersion = (currentVersion?: number) => {
  if (!Number.isFinite(currentVersion)) {
    return 1;
  }
  return (currentVersion as number) + 1;
};

export const readOrgLibraryItems = (orgId: string): LibraryItem[] => {
  const state = readLocalState();
  return state.libraryItems.filter(
    (item) =>
      (item.orgId as string | undefined) === orgId &&
      !(item.deleted ?? false),
  );
};

export const readOrgServices = (orgId: string): Service[] => {
  const state = readLocalState();
  return state.services.filter(
    (service) =>
      (service.orgId as string | undefined) === orgId &&
      !(service.deleted ?? false),
  );
};

export const upsertLibraryItem = (orgId: string, input: LibraryItem): LibraryItem => {
  const state = readLocalState();
  const existingIndex = state.libraryItems.findIndex((item) => item._id === input._id);
  const stamp = now();
  const existing = existingIndex >= 0 ? state.libraryItems[existingIndex] : null;
  const nextItem: LibraryItem = {
    ...input,
    orgId,
    updatedAt: input.updatedAt ?? stamp,
    version: input.version ?? nextVersion(existing?.version),
    deleted: input.deleted ?? false,
    _creationTime: input._creationTime ?? stamp,
    type: input.type ?? "song",
    content: input.content ?? {},
  };
  if (existingIndex >= 0) {
    state.libraryItems[existingIndex] = nextItem;
  } else {
    state.libraryItems.push(nextItem);
  }
  writeLocalState(state);
  return nextItem;
};

export const removeLibraryItemLocal = (orgId: string, itemId: string) => {
  const state = readLocalState();
  const index = state.libraryItems.findIndex(
    (item) =>
      (item.orgId as string | undefined) === orgId && item._id === itemId,
  );
  if (index >= 0) {
    const existing = state.libraryItems[index];
    state.libraryItems[index] = {
      ...existing,
      deleted: true,
      updatedAt: now(),
      version: nextVersion(existing.version),
    };
  }
  writeLocalState(state);
};

export const upsertService = (orgId: string, input: Service): Service => {
  const state = readLocalState();
  const existingIndex = state.services.findIndex((service) => service._id === input._id);
  const existing = existingIndex >= 0 ? state.services[existingIndex] : null;
  const stamp = now();
  const nextService: Service = {
    ...input,
    orgId: orgId as Service["orgId"],
    updatedAt: input.updatedAt ?? stamp,
    version: input.version ?? nextVersion(existing?.version),
    deleted: input.deleted ?? false,
  };
  if (existingIndex >= 0) {
    state.services[existingIndex] = nextService;
  } else {
    state.services.push(nextService);
  }
  writeLocalState(state);
  return nextService;
};

export const removeServiceLocal = (orgId: string, serviceId: string) => {
  const state = readLocalState();
  const index = state.services.findIndex(
    (service) =>
      (service.orgId as string | undefined) === orgId &&
      service._id === (serviceId as Service["_id"]),
  );
  if (index >= 0) {
    const existing = state.services[index];
    state.services[index] = {
      ...existing,
      deleted: true,
      updatedAt: now(),
      version: nextVersion(existing.version),
    };
  }
  writeLocalState(state);
};

export const replaceOrgServices = (orgId: string, services: Service[]) => {
  const state = readLocalState();
  const withoutOrg = state.services.filter((service) => (service.orgId as string | undefined) !== orgId);
  state.services = [
    ...withoutOrg,
    ...services.map((service) => ({
      ...service,
      orgId: orgId as Service["orgId"],
      deleted: service.deleted ?? false,
      version: service.version ?? 1,
      updatedAt: service.updatedAt ?? now(),
    })),
  ];
  writeLocalState(state);
};

export const createLocalLibraryItem = (
  orgId: string,
  input: Omit<
    LibraryItem,
    "_id" | "_creationTime" | "orgId" | "updatedAt" | "version" | "deleted"
  >,
) => {
  const stamp = now();
  return upsertLibraryItem(orgId, {
    ...input,
    _id: uid(),
    _creationTime: stamp,
    orgId,
    updatedAt: stamp,
    version: 1,
    deleted: false,
    type: input.type ?? "song",
    content: input.content ?? {},
  });
};

export const createLocalService = (
  orgId: string,
  input: Omit<
    Service,
    "_id" | "_creationTime" | "orgId" | "updatedAt" | "version" | "deleted"
  >,
) => {
  const stamp = now();
  return upsertService(orgId, {
    ...input,
    _id: uid() as Service["_id"],
    _creationTime: stamp,
    orgId: orgId as Service["orgId"],
    updatedAt: stamp,
    version: 1,
    deleted: false,
  });
};

export const enqueueSyncOperation = (
  orgId: string,
  entityType: OfflineEntityType,
  entityId: string,
  operation: OfflineOperation,
  payload: unknown
) => {
  const queue = readJson<SyncQueueItem[]>(SYNC_QUEUE_KEY, []);
  queue.push({
    id: uid(),
    orgId,
    entityType,
    entityId,
    operation,
    payload,
    updatedAt: now(),
    version: now(),
  });
  writeJson(SYNC_QUEUE_KEY, queue);
};

export const readSyncQueue = () => readJson<SyncQueueItem[]>(SYNC_QUEUE_KEY, []);

export const listSyncQueueByOrg = (orgId: string, limit = 100): SyncQueueItem[] =>
  readSyncQueue()
    .filter((item) => item.orgId === orgId)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, limit);

export const removeSyncQueueItems = (ids: string[]) => {
  if (!ids.length) {
    return;
  }
  const idSet = new Set(ids);
  const next = readSyncQueue().filter((item) => !idSet.has(item.id));
  writeJson(SYNC_QUEUE_KEY, next);
};
