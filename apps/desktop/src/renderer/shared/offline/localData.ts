"use client";

import type { Category, LibraryItem, SavedMessage, Service } from "../../../shared/types";

export type OfflineEntityType = "library" | "service" | "message";
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
  categories: Category[];
  libraryItems: LibraryItem[];
  messages: SavedMessage[];
  services: Service[];
}

const LOCAL_DATA_KEY = "present-local-data-v1";
const SYNC_QUEUE_KEY = "present-sync-queue-v1";
const MAX_SYNC_QUEUE_ITEMS = 150;
export const LOCAL_DATA_CHANGED_EVENT = "present-local-data-changed";
let inMemoryLocalState: PersistedLocalState | null = null;

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

const isQuotaExceededError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { name?: string; message?: string };
  return (
    maybeError.name === "QuotaExceededError" ||
    maybeError.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    (maybeError.message ?? "").toLowerCase().includes("quota")
  );
};

const compactSyncPayload = (
  entityType: OfflineEntityType,
  operation: OfflineOperation,
  payload: unknown,
) => {
  if (payload == null || typeof payload !== "object") {
    return payload;
  }

  const data = payload as Record<string, unknown>;

  if (entityType === "service") {
    const service = data;
    const items = Array.isArray(service.items) ? service.items : [];
    return {
      _id: service._id,
      name: service.name,
      groups: service.groups,
      layout: service.layout,
      updatedAt: service.updatedAt,
      version: service.version,
      operation,
      items: items.map((item) => {
        const entry = item as Record<string, unknown>;
        const presentation = (entry.presentation ?? null) as
          | Record<string, unknown>
          | null;
        return {
          type: entry.type,
          refId: entry.refId,
          label: entry.label,
          groupId: entry.groupId ?? null,
          addedAt: entry.addedAt,
          presentation:
            presentation == null
              ? null
              : {
                  title: presentation.title,
                  sourceType: presentation.sourceType,
                  slideCount: Array.isArray(presentation.slides)
                    ? presentation.slides.length
                    : undefined,
                },
        };
      }),
    };
  }

  if (entityType === "message") {
    return {
      _id: data._id,
      title: data.title,
      body: data.body,
      themeKey: data.themeKey,
      position: data.position,
      dismissMode: data.dismissMode,
      animation: data.animation,
      speedSeconds: data.speedSeconds,
      fontScale: data.fontScale,
      order: data.order,
      updatedAt: data.updatedAt,
      version: data.version,
      operation,
    };
  }

  if (entityType === "library") {
    return {
      _id: data._id,
      title: data.title,
      updatedAt: data.updatedAt,
      version: data.version,
      operation,
      slideCount: Array.isArray(data.slides) ? data.slides.length : undefined,
    };
  }

  return payload;
};

const writeJson = (key: string, value: unknown) => {
  if (typeof window === "undefined") {
    return;
  }

  const serialize = (candidate: unknown) => JSON.stringify(candidate);
  const persist = (candidate: unknown) => window.localStorage.setItem(key, serialize(candidate));

  try {
    persist(value);
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      console.error(`Failed to persist local data for key "${key}"`, error);
      return;
    }

    if (key !== SYNC_QUEUE_KEY || !Array.isArray(value)) {
      console.warn(`Storage quota exceeded while writing "${key}". Skipping persist.`);
      return;
    }

    // For sync queue, keep the newest small subset so writes never crash the UI.
    try {
      const queue = value as SyncQueueItem[];
      const compactQueue = queue
        .slice(-MAX_SYNC_QUEUE_ITEMS)
        .map((item) => ({
          ...item,
          payload: compactSyncPayload(item.entityType, item.operation, item.payload),
        }));
      persist(compactQueue);
    } catch (retryError) {
      console.warn("Storage quota still exceeded after compacting sync queue.", retryError);
      try {
        persist([]);
      } catch {
        // Ignore final failure to avoid runtime crashes.
      }
    }
  }
};

const readLocalState = (): PersistedLocalState => {
  if (inMemoryLocalState) {
    return inMemoryLocalState;
  }

  const stored = readJson<Partial<PersistedLocalState>>(LOCAL_DATA_KEY, {
    categories: [],
    libraryItems: [],
    messages: [],
    services: [],
  });
  inMemoryLocalState = {
    categories: Array.isArray(stored.categories) ? stored.categories : [],
    libraryItems: Array.isArray(stored.libraryItems) ? stored.libraryItems : [],
    messages: Array.isArray(stored.messages) ? stored.messages : [],
    services: Array.isArray(stored.services) ? stored.services : [],
  };
  return inMemoryLocalState;
};

const writeLocalState = (state: PersistedLocalState) => {
  inMemoryLocalState = state;
  writeJson(LOCAL_DATA_KEY, state);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LOCAL_DATA_CHANGED_EVENT));
  }
};

const nextVersion = (currentVersion?: number) => {
  if (!Number.isFinite(currentVersion)) {
    return 1;
  }
  return (currentVersion as number) + 1;
};

const getItemTimestamp = (item: {
  updatedAt?: number;
  createdAt?: number;
  _creationTime?: number;
}) => {
  return item.updatedAt ?? item.createdAt ?? item._creationTime ?? 0;
};

const normalizeRemoteLibraryItem = (
  orgId: string,
  item: LibraryItem,
): LibraryItem => ({
  ...item,
  orgId,
  deleted: item.deleted ?? false,
  version: item.version ?? 1,
  updatedAt: item.updatedAt ?? item.createdAt ?? item._creationTime ?? now(),
  _creationTime: item._creationTime ?? item.createdAt ?? now(),
  type: item.type ?? "song",
  content: item.content ?? {},
});

export const readOrgLibraryItems = (orgId: string): LibraryItem[] => {
  const state = readLocalState();
  return state.libraryItems.filter(
    (item) =>
      (item.orgId as string | undefined) === orgId &&
      !(item.deleted ?? false),
  );
};

export const readOrgCategories = (orgId: string): Category[] => {
  const state = readLocalState();
  return state.categories
    .filter(
      (category) =>
        (category.orgId as string | undefined) === orgId &&
        !(category as Category & { deleted?: boolean }).deleted,
    )
    .sort(
      (left, right) =>
        (left.order ?? 0) - (right.order ?? 0) ||
        left.name.localeCompare(right.name),
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

export const readOrgMessages = (orgId: string): SavedMessage[] => {
  const state = readLocalState();
  return state.messages.filter(
    (message) =>
      (message.orgId as string | undefined) === orgId &&
      !(message.deleted ?? false),
  );
};

export const upsertCategory = (orgId: string, input: Category): Category => {
  const state = readLocalState();
  const existingIndex = state.categories.findIndex(
    (category) => String(category._id) === String(input._id),
  );
  const stamp = now();
  const existing = existingIndex >= 0 ? state.categories[existingIndex] : null;
  const nextCategory: Category = {
    ...input,
    orgId: orgId as Category["orgId"],
    _creationTime: input._creationTime ?? existing?._creationTime ?? stamp,
    createdAt: input.createdAt ?? existing?.createdAt ?? stamp,
    isDefault: input.isDefault ?? false,
    order: input.order ?? existing?.order ?? state.categories.length,
  };

  if (existingIndex >= 0) {
    state.categories[existingIndex] = nextCategory;
  } else {
    state.categories.push(nextCategory);
  }

  writeLocalState(state);
  return nextCategory;
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

export const removeCategoryLocal = (orgId: string, categoryId: string) => {
  const state = readLocalState();
  state.categories = state.categories.filter(
    (category) =>
      !(
        (category.orgId as string | undefined) === orgId &&
        String(category._id) === categoryId
      ),
  );
  state.libraryItems = state.libraryItems.map((item) =>
    (item.orgId as string | undefined) === orgId &&
    String(item.categoryId) === categoryId
      ? { ...item, categoryId: undefined }
      : item,
  );
  writeLocalState(state);
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
  const existingIndex = state.services.findIndex(
    (service) => String(service._id) === String(input._id),
  );
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

export const upsertMessage = (
  orgId: string,
  input: SavedMessage,
): SavedMessage => {
  const state = readLocalState();
  const existingIndex = state.messages.findIndex((message) => message._id === input._id);
  const existing = existingIndex >= 0 ? state.messages[existingIndex] : null;
  const stamp = now();
  const nextMessage: SavedMessage = {
    ...input,
    orgId,
    updatedAt: input.updatedAt ?? stamp,
    version: input.version ?? nextVersion(existing?.version),
    deleted: input.deleted ?? false,
    _creationTime: input._creationTime ?? stamp,
    allowWebNotifications: input.allowWebNotifications ?? false,
    animation: input.animation ?? "static",
    speedSeconds: input.speedSeconds ?? 12,
    fontScale: input.fontScale ?? 1,
  };

  if (existingIndex >= 0) {
    state.messages[existingIndex] = nextMessage;
  } else {
    state.messages.push(nextMessage);
  }
  writeLocalState(state);
  return nextMessage;
};

export const removeMessageLocal = (orgId: string, messageId: string) => {
  const state = readLocalState();
  const index = state.messages.findIndex(
    (message) =>
      (message.orgId as string | undefined) === orgId &&
      message._id === messageId,
  );
  if (index >= 0) {
    const existing = state.messages[index];
    state.messages[index] = {
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
  const deletedOrgServices = state.services.filter(
    (service) =>
      (service.orgId as string | undefined) === orgId &&
      (service.deleted ?? false),
  );
  const deletedIds = new Set(
    deletedOrgServices.map((service) => String(service._id)),
  );
  const withoutOrg = state.services.filter(
    (service) => (service.orgId as string | undefined) !== orgId,
  );
  const seenIds = new Set<string>();
  const incomingServices = services.filter((service) => {
    const id = String(service._id);
    if (deletedIds.has(id) || seenIds.has(id)) {
      return false;
    }
    seenIds.add(id);
    return true;
  });
  state.services = [
    ...withoutOrg,
    ...deletedOrgServices,
    ...incomingServices.map((service) => ({
      ...service,
      orgId: orgId as Service["orgId"],
      deleted: service.deleted ?? false,
      version: service.version ?? 1,
      updatedAt: service.updatedAt ?? now(),
    })),
  ];
  writeLocalState(state);
};

export const replaceOrgLibraryItems = (
  orgId: string,
  libraryItems: LibraryItem[],
  localToRemoteIds: Record<string, string> = {},
) => {
  const state = readLocalState();
  const orgItems = state.libraryItems.filter(
    (item) => (item.orgId as string | undefined) === orgId,
  );
  const withoutOrg = state.libraryItems.filter(
    (item) => (item.orgId as string | undefined) !== orgId,
  );
  const localById = new Map(orgItems.map((item) => [String(item._id), item]));
  const localIdByRemoteId = new Map(
    Object.entries(localToRemoteIds).map(([localId, remoteId]) => [
      remoteId,
      localId,
    ]),
  );
  const pendingLibraryItems = readSyncQueue().filter(
    (item) => item.orgId === orgId && item.entityType === "library",
  );
  const pendingIds = new Set(
    pendingLibraryItems.map((item) => String(item.entityId)),
  );
  const pendingDeleteIds = new Set(
    pendingLibraryItems
      .filter((item) => item.operation === "delete")
      .map((item) => String(item.entityId)),
  );
  const coveredLocalIds = new Set<string>();
  const seenRemoteIds = new Set<string>();
  const mergedItems: LibraryItem[] = [];

  for (const remoteItem of libraryItems) {
    const normalizedRemote = normalizeRemoteLibraryItem(orgId, remoteItem);
    const remoteId = String(normalizedRemote._id);
    if (seenRemoteIds.has(remoteId)) {
      continue;
    }
    seenRemoteIds.add(remoteId);

    const mappedLocalId = localIdByRemoteId.get(remoteId);
    const sameIdLocal = localById.get(remoteId) ?? null;
    const mappedLocal = mappedLocalId
      ? localById.get(mappedLocalId) ?? null
      : null;
    const localItem =
      sameIdLocal && mappedLocal
        ? getItemTimestamp(sameIdLocal) >= getItemTimestamp(mappedLocal)
          ? sameIdLocal
          : mappedLocal
        : sameIdLocal ?? mappedLocal;

    if (sameIdLocal) {
      coveredLocalIds.add(String(sameIdLocal._id));
    }
    if (mappedLocal) {
      coveredLocalIds.add(String(mappedLocal._id));
    }

    const localId = localItem ? String(localItem._id) : null;
    if (
      localItem &&
      localId &&
      (pendingDeleteIds.has(localId) || pendingDeleteIds.has(remoteId))
    ) {
      mergedItems.push(localItem);
      continue;
    }

    if (
      localItem &&
      localId &&
      (pendingIds.has(localId) || pendingIds.has(remoteId))
    ) {
      mergedItems.push(localItem);
      continue;
    }

    if (
      localItem &&
      getItemTimestamp(localItem) > getItemTimestamp(normalizedRemote)
    ) {
      mergedItems.push(localItem);
      continue;
    }

    mergedItems.push(normalizedRemote);
  }

  for (const localItem of orgItems) {
    const localId = String(localItem._id);
    if (coveredLocalIds.has(localId)) {
      continue;
    }
    if (pendingIds.has(localId) || pendingDeleteIds.has(localId)) {
      mergedItems.push(localItem);
    }
  }

  state.libraryItems = [...withoutOrg, ...mergedItems];
  writeLocalState(state);
};

export const replaceOrgCategories = (orgId: string, categories: Category[]) => {
  const state = readLocalState();
  const remoteIds = new Set(categories.map((category) => String(category._id)));
  const withoutOrg = state.categories.filter(
    (category) => (category.orgId as string | undefined) !== orgId,
  );
  const localOnlyCategories = state.categories.filter(
    (category) =>
      (category.orgId as string | undefined) === orgId &&
      String(category._id).startsWith("category_") &&
      !remoteIds.has(String(category._id)),
  );
  state.categories = [
    ...withoutOrg,
    ...categories.map((category, index) => ({
      ...category,
      orgId: orgId as Category["orgId"],
      isDefault: category.isDefault ?? false,
      order: Number.isFinite(category.order) ? category.order : index,
      createdAt: category.createdAt ?? category._creationTime ?? now(),
      _creationTime: category._creationTime ?? category.createdAt ?? now(),
    })),
    ...localOnlyCategories,
  ];
  writeLocalState(state);
};

export const replaceOrgMessages = (orgId: string, messages: SavedMessage[]) => {
  const state = readLocalState();
  const withoutOrg = state.messages.filter(
    (message) => (message.orgId as string | undefined) !== orgId,
  );
  state.messages = [
    ...withoutOrg,
    ...messages.map((message, index) => ({
      ...message,
      orgId,
      deleted: message.deleted ?? false,
      version: message.version ?? 1,
      order: Number.isFinite(message.order) ? message.order : index,
      updatedAt: message.updatedAt ?? now(),
      _creationTime: message._creationTime ?? message.createdAt ?? now(),
      allowWebNotifications: message.allowWebNotifications ?? false,
      animation: message.animation ?? "static",
      speedSeconds: message.speedSeconds ?? 12,
      fontScale: message.fontScale ?? 1,
    })),
  ];
  writeLocalState(state);
};

export const createLocalCategory = (
  orgId: string,
  input: Pick<Category, "name"> & Partial<Omit<Category, "_id" | "orgId" | "name">>,
) => {
  const stamp = now();
  const existing = readOrgCategories(orgId);
  const nextOrder =
    existing.length > 0
      ? Math.max(...existing.map((category) => category.order ?? 0)) + 1
      : 0;

  return upsertCategory(orgId, {
    ...input,
    _id: `category_${uid()}` as Category["_id"],
    _creationTime: stamp,
    orgId: orgId as Category["orgId"],
    name: input.name,
    isDefault: input.isDefault ?? false,
    order: input.order ?? nextOrder,
    createdAt: input.createdAt ?? stamp,
  });
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

export const createLocalMessage = (
  orgId: string,
  input: Omit<
    SavedMessage,
    "_id" | "_creationTime" | "orgId" | "updatedAt" | "version" | "deleted"
  >,
) => {
  const stamp = now();
  return upsertMessage(orgId, {
    ...input,
    _id: `message_${uid()}`,
    _creationTime: stamp,
    orgId,
    updatedAt: stamp,
    version: 1,
    deleted: false,
    createdAt: input.createdAt ?? stamp,
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

  const compactPayload = compactSyncPayload(entityType, operation, payload);
  queue.push({
    id: uid(),
    orgId,
    entityType,
    entityId,
    operation,
    payload: compactPayload,
    updatedAt: now(),
    version: now(),
  });
  writeJson(
    SYNC_QUEUE_KEY,
    queue.slice(-MAX_SYNC_QUEUE_ITEMS),
  );
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
