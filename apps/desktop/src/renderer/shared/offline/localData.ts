"use client";

/**
 * The library on this machine: categories, library items, services, messages.
 *
 * Every read here is synchronous because the screens are — a slide list asks
 * for its items while it renders — so the workspace's entities are kept in
 * memory and read from there. What changed is where that memory comes from
 * and goes to: SQLite in Rust (`services/store`), read once when the app
 * starts and written after every change.
 *
 * It used to be localStorage with an IndexedDB copy behind it. Both are per
 * origin, so the operator window and the audience window could not see each
 * other's writes; both go when the webview's data is cleared; and localStorage
 * throws once a library outgrows its quota, which is why the queue of unsent
 * changes used to be thinned and then dropped to make room. A change made in a
 * hall with no signal is the one thing this must never lose. SQLite has none
 * of those limits, and one file on the machine is one file for every window.
 *
 * The one thing that is not instant: the first read of a run can be empty
 * while the database is opened. Anything showing this data listens for
 * `LOCAL_DATA_CHANGED_EVENT`, which fires when it arrives.
 */

import type { Category, LibraryItem, SavedMessage, Service } from "../../../shared/types";
import {
  offlineDequeue,
  offlineEnqueue,
  offlineList,
  offlinePut,
  offlineQueued,
  offlineRemove,
  offlineReplace,
  offlineWorkspaces,
  type OfflineKind,
} from "../../tauri/offline";
import {
  changedRows,
  fromQueuedChange,
  KINDS,
  rowKey,
  rowsOf,
  toQueuedChange,
} from "./offline-rows.mjs";
import { remapServiceLibraryItemIds } from "./service-library-id-map.mjs";

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

export const LOCAL_DATA_CHANGED_EVENT = "present-local-data-changed";

/**
 * How long a burst of edits is gathered before it is written.
 *
 * Long enough that dragging an item through a list is one write and not
 * thirty, short enough that quitting straight after an edit keeps it.
 */
const PERSIST_AFTER_MS = 60;

/** How much of the queue is read back at startup. Far more than a Sunday. */
const QUEUE_READ_LIMIT = 5_000;

/** The browser storage the library used to live in, read once and left alone. */
const LEGACY_DATA_KEY = "present-local-data-v1";
const LEGACY_QUEUE_KEY = "present-sync-queue-v1";
const LEGACY_DB_NAME = "present-offline-data";
const LEGACY_STORE_NAME = "keyval";
const LEGACY_IMPORTED_KEY = "present-offline-imported-v1";

/** Anything the store holds a row for: it has an id and a workspace. */
type StoredEntity = { _id?: unknown; orgId?: unknown };

const emptyLocalState = (): PersistedLocalState => ({
  categories: [],
  libraryItems: [],
  messages: [],
  services: [],
});

let inMemoryLocalState: PersistedLocalState = emptyLocalState();
let inMemorySyncQueue: SyncQueueItem[] = [];

const now = () => Date.now();

const uid = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(36).slice(2)}_${now().toString(36)}`;
};

/** Outside the app — `vite` opened in a browser — this is memory only. */
const hasStore = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const warn = (message: string, error: unknown) => {
  console.warn(`[OfflineData] ${message}`, error);
};

const announce = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LOCAL_DATA_CHANGED_EVENT));
  }
};

/** `KINDS`, as this file reads it. */
const kinds = KINDS as unknown as ReadonlyArray<
  readonly [keyof PersistedLocalState, OfflineKind]
>;

const entitiesOf = (state: PersistedLocalState, field: keyof PersistedLocalState) =>
  state[field] as unknown as StoredEntity[];

const normalizePersistedLocalState = (
  stored: Partial<PersistedLocalState>,
): PersistedLocalState => ({
  categories: Array.isArray(stored.categories) ? stored.categories : [],
  libraryItems: Array.isArray(stored.libraryItems) ? stored.libraryItems : [],
  messages: Array.isArray(stored.messages) ? stored.messages : [],
  services: Array.isArray(stored.services) ? stored.services : [],
});

// ---------------------------------------------------------------------------
// Writing what changed
// ---------------------------------------------------------------------------

/**
 * What the database is known to hold: a row's key against the very object
 * that was written there. `changedRows` reads it; see `offline-rows.mjs`.
 */
const written = new Map<string, StoredEntity>();

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persisting: Promise<void> = Promise.resolve();

const schedulePersist = () => {
  if (!hasStore() || persistTimer) {
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistChanges();
  }, PERSIST_AFTER_MS);
};

/** Write the rows that changed, in order, one write at a time. */
const persistChanges = (): Promise<void> => {
  persisting = persisting.then(async () => {
    await whenOfflineDataReady();
    const { puts, removals } = changedRows(
      written,
      rowsOf(inMemoryLocalState as unknown as Record<string, StoredEntity[]>),
    );
    try {
      for (const row of puts) {
        await offlinePut(row.workspace, row.kind as OfflineKind, row.id, row.body);
        written.set(row.key, row.body as StoredEntity);
      }
      for (const row of removals) {
        await offlineRemove(row.workspace, row.kind as OfflineKind, row.id);
        written.delete(row.key);
      }
    } catch (error) {
      // Nothing is marked written until it is, so the next attempt writes it
      // again. The operator keeps working from memory meanwhile.
      warn("the library could not be written; trying again shortly", error);
      schedulePersist();
    }
  });
  return persisting;
};

/** Everything written so far is on disk. For tests and for shutting down. */
export const flushOfflineData = async (): Promise<void> => {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persistChanges();
};

// ---------------------------------------------------------------------------
// Reading it back
// ---------------------------------------------------------------------------

let hydration: Promise<void> | null = null;

/**
 * Resolves once this machine's library has been read into memory.
 *
 * The sync waits for this: a queue that looks empty because the database has
 * not answered yet would let a pull overwrite work done offline.
 */
export const whenOfflineDataReady = (): Promise<void> => {
  hydration ??= hydrate();
  return hydration;
};

const hydrate = async (): Promise<void> => {
  if (!hasStore()) {
    return;
  }
  try {
    await carryOverBrowserStorage();

    const arrived = emptyLocalState();
    for (const workspace of await offlineWorkspaces()) {
      for (const [field, kind] of kinds) {
        for (const document of await offlineList<StoredEntity>(workspace, kind)) {
          entitiesOf(arrived, field).push(document.body);
          written.set(rowKey(kind, workspace, String(document.id)), document.body);
        }
      }
    }

    // Anything made before the database answered is newer than the database,
    // so it stays and the stored copy of it is dropped.
    for (const [field] of kinds) {
      const madeMeanwhile = entitiesOf(inMemoryLocalState, field);
      const ids = new Set(madeMeanwhile.map((entity) => String(entity._id)));
      const stored = entitiesOf(arrived, field).filter(
        (entity) => !ids.has(String(entity._id)),
      );
      (inMemoryLocalState as unknown as Record<string, StoredEntity[]>)[field] = [
        ...stored,
        ...madeMeanwhile,
      ];
    }

    const waiting = await offlineQueued(undefined, QUEUE_READ_LIMIT);
    const queuedMeanwhile = new Set(inMemorySyncQueue.map((item) => item.id));
    inMemorySyncQueue = [
      ...waiting
        .filter((change) => !queuedMeanwhile.has(change.id))
        .map((change) => fromQueuedChange(change) as SyncQueueItem),
      ...inMemorySyncQueue,
    ].sort((left, right) => left.updatedAt - right.updatedAt);

    announce();
    schedulePersist();
  } catch (error) {
    // The app still works: it starts with an empty library and fills from
    // Convex when there is a network, as it would on a new machine.
    warn("the library on this machine could not be read", error);
  }
};

// ---------------------------------------------------------------------------
// The library the browser used to hold
// ---------------------------------------------------------------------------

const readLegacyJson = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** The IndexedDB copy, which held what localStorage had no room for. */
const readLegacyIndexedDb = (): Promise<{
  value: PersistedLocalState;
  updatedAt: number;
} | null> =>
  new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      resolve(null);
      return;
    }
    const request = window.indexedDB.open(LEGACY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      // A database this app never made: there is nothing to carry over.
      request.transaction?.abort();
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        database.close();
        resolve(null);
        return;
      }
      const read = database
        .transaction(LEGACY_STORE_NAME, "readonly")
        .objectStore(LEGACY_STORE_NAME)
        .get(LEGACY_DATA_KEY);
      read.onerror = () => {
        database.close();
        reject(read.error ?? new Error("the older library could not be read"));
      };
      read.onsuccess = () => {
        const record = read.result as
          | { value?: Partial<PersistedLocalState>; updatedAt?: number }
          | undefined;
        database.close();
        resolve(
          record?.value
            ? {
                value: normalizePersistedLocalState(record.value),
                updatedAt: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : 0,
              }
            : null,
        );
      };
    };
  });

/**
 * Move what the browser held into the store, once.
 *
 * Only ever into an empty store: a second run of this would undo everything
 * done since the first.
 */
const carryOverBrowserStorage = async (): Promise<void> => {
  if (typeof window === "undefined" || window.localStorage.getItem(LEGACY_IMPORTED_KEY)) {
    return;
  }
  try {
    if ((await offlineWorkspaces()).length > 0) {
      window.localStorage.setItem(LEGACY_IMPORTED_KEY, String(now()));
      return;
    }

    const fromLocalStorage = readLegacyJson<Partial<PersistedLocalState> | null>(
      LEGACY_DATA_KEY,
      null,
    );
    const fromIndexedDb = await readLegacyIndexedDb().catch((): null => null);
    const meta = readLegacyJson<{ updatedAt?: number }>("present-local-data-meta-v1", {});
    const localStorageAt = Number.isFinite(meta.updatedAt) ? Number(meta.updatedAt) : 0;
    const carried =
      fromIndexedDb && (!fromLocalStorage || fromIndexedDb.updatedAt > localStorageAt)
        ? fromIndexedDb.value
        : fromLocalStorage
          ? normalizePersistedLocalState(fromLocalStorage)
          : null;

    if (carried) {
      for (const [field, kind] of kinds) {
        const byWorkspace = new Map<string, Array<[string, StoredEntity]>>();
        for (const entity of entitiesOf(carried, field)) {
          const workspace = String(entity.orgId ?? "");
          const id = String(entity._id ?? "");
          if (!workspace || !id) {
            continue;
          }
          const rows = byWorkspace.get(workspace) ?? [];
          rows.push([id, entity]);
          byWorkspace.set(workspace, rows);
        }
        for (const [workspace, rows] of byWorkspace) {
          await offlineReplace(workspace, kind, rows);
        }
      }
    }

    // The unsent changes matter more than the library: the library can be
    // fetched again, these are somebody's Sunday.
    for (const item of readLegacyJson<SyncQueueItem[]>(LEGACY_QUEUE_KEY, [])) {
      if (item?.id && item.orgId) {
        await offlineEnqueue(toQueuedChange(item));
      }
    }

    window.localStorage.setItem(LEGACY_IMPORTED_KEY, String(now()));
  } catch (error) {
    // Left un-marked on purpose: the next start tries again.
    warn("the library the browser held could not be carried over", error);
  }
};

// ---------------------------------------------------------------------------
// The queue of changes the server has not been told about
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// What the rest of the app calls
// ---------------------------------------------------------------------------

const readLocalState = (): PersistedLocalState => {
  void whenOfflineDataReady();
  return inMemoryLocalState;
};

const writeLocalState = (state: PersistedLocalState) => {
  inMemoryLocalState = state;
  schedulePersist();
  announce();
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

const normalizeRemoteService = (orgId: string, service: Service): Service => ({
  ...service,
  orgId: orgId as Service["orgId"],
  groups: Array.isArray(service.groups) ? service.groups : [],
  layout: Array.isArray(service.layout) ? service.layout : [],
  items: Array.isArray(service.items) ? service.items : [],
  deleted: service.deleted ?? false,
  version: service.version ?? 1,
  updatedAt: service.updatedAt ?? service.createdAt ?? service._creationTime ?? now(),
  createdAt: service.createdAt ?? service._creationTime ?? now(),
  _creationTime: service._creationTime ?? service.createdAt ?? now(),
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
  const existingIndex = state.libraryItems.findIndex(
    (item) => String(item._id) === String(input._id),
  );
  const stamp = now();
  const existing = existingIndex >= 0 ? state.libraryItems[existingIndex] : null;
  const nextItem: LibraryItem = {
    ...input,
    orgId,
    // Stamped on every write for the same reason as services: the only caller
    // spreads the item it just read, so an incoming stamp would pin this to
    // creation time and the remote merge would drop the edit.
    updatedAt: stamp,
    version: nextVersion(existing?.version),
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
      (item.orgId as string | undefined) === orgId &&
      String(item._id) === String(itemId),
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
    // Every caller is a local edit, and they all build their payload by
    // spreading the service they just read — so honouring an incoming
    // `updatedAt`/`version` would freeze both at creation time. The remote
    // merge keeps a local service only while it is strictly newer than the
    // server's copy, so a stale stamp means the edit is silently discarded on
    // the next sync. Stamp the write here instead.
    updatedAt: stamp,
    version: nextVersion(existing?.version),
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
      String(service._id) === String(serviceId),
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

export const replaceOrgServices = (
  orgId: string,
  services: Service[],
  localToRemoteServiceIds: Record<string, string> = {},
  localToRemoteLibraryIds: Record<string, string> = {},
) => {
  const state = readLocalState();
  const orgLibraryIds = new Set(
    state.libraryItems
      .filter((item) => (item.orgId as string | undefined) === orgId)
      .map((item) => String(item._id)),
  );
  const localLibraryIdByRemoteId = Object.fromEntries(
    Object.entries(localToRemoteLibraryIds)
      .filter(([localId]) => orgLibraryIds.has(localId))
      .map(([localId, remoteId]) => [remoteId, localId]),
  );
  const normalizeLibraryReferences = (service: Service) =>
    remapServiceLibraryItemIds(service, localLibraryIdByRemoteId) as Service;
  const orgServices = state.services
    .filter((service) => (service.orgId as string | undefined) === orgId)
    .map(normalizeLibraryReferences);
  const withoutOrg = state.services.filter(
    (service) => (service.orgId as string | undefined) !== orgId,
  );
  const localById = new Map(
    orgServices.map((service) => [String(service._id), service]),
  );
  const localIdByRemoteId = new Map(
    Object.entries(localToRemoteServiceIds).map(([localId, remoteId]) => [
      remoteId,
      localId,
    ]),
  );
  const pendingServices = readSyncQueue().filter(
    (item) => item.orgId === orgId && item.entityType === "service",
  );
  const pendingIds = new Set(
    pendingServices.map((item) => String(item.entityId)),
  );
  const pendingDeleteIds = new Set(
    pendingServices
      .filter((item) => item.operation === "delete")
      .map((item) => String(item.entityId)),
  );
  const coveredLocalIds = new Set<string>();
  const seenRemoteIds = new Set<string>();
  const mergedServices: Service[] = [];

  for (const remoteService of services) {
    const normalizedRemote = normalizeLibraryReferences(
      normalizeRemoteService(orgId, remoteService),
    );
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
    const localService =
      sameIdLocal && mappedLocal
        ? getItemTimestamp(sameIdLocal) >= getItemTimestamp(mappedLocal)
          ? sameIdLocal
          : mappedLocal
        : sameIdLocal ?? mappedLocal;
    const remoteForLocal = mappedLocal
      ? ({
          ...normalizedRemote,
          _id: mappedLocal._id,
        } as Service)
      : normalizedRemote;

    if (sameIdLocal) {
      coveredLocalIds.add(String(sameIdLocal._id));
    }
    if (mappedLocal) {
      coveredLocalIds.add(String(mappedLocal._id));
    }

    const localId = localService ? String(localService._id) : null;
    if (
      localService &&
      localId &&
      (pendingDeleteIds.has(localId) || pendingDeleteIds.has(remoteId))
    ) {
      mergedServices.push(localService);
      continue;
    }

    if (
      localService &&
      localId &&
      (pendingIds.has(localId) || pendingIds.has(remoteId))
    ) {
      mergedServices.push(localService);
      continue;
    }

    if (
      localService &&
      getItemTimestamp(localService) > getItemTimestamp(normalizedRemote)
    ) {
      mergedServices.push(localService);
      continue;
    }

    mergedServices.push(remoteForLocal);
  }

  for (const localService of orgServices) {
    const localId = String(localService._id);
    if (coveredLocalIds.has(localId)) {
      continue;
    }
    if (pendingIds.has(localId) || pendingDeleteIds.has(localId)) {
      mergedServices.push(localService);
    }
  }

  state.services = [...withoutOrg, ...mergedServices];
  writeLocalState(state);
};

export const repairOrgServiceLibraryReferences = (
  orgId: string,
  localToRemoteLibraryIds: Record<string, string> = {},
) => {
  const state = readLocalState();
  const orgLibraryIds = new Set(
    state.libraryItems
      .filter((item) => (item.orgId as string | undefined) === orgId)
      .map((item) => String(item._id)),
  );
  const localLibraryIdByRemoteId = Object.fromEntries(
    Object.entries(localToRemoteLibraryIds)
      .filter(([localId]) => orgLibraryIds.has(localId))
      .map(([localId, remoteId]) => [remoteId, localId]),
  );
  let didRepair = false;

  state.services = state.services.map((service) => {
    if ((service.orgId as string | undefined) !== orgId) {
      return service;
    }
    const repaired = remapServiceLibraryItemIds(
      service,
      localLibraryIdByRemoteId,
    ) as Service;
    didRepair ||= repaired !== service;
    return repaired;
  });

  if (didRepair) {
    writeLocalState(state);
  }
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
    const remoteForLocal = mappedLocal
      ? ({
          ...normalizedRemote,
          _id: mappedLocal._id,
        } as LibraryItem)
      : normalizedRemote;

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

    mergedItems.push(remoteForLocal);
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
  payload: unknown,
) => {
  const item: SyncQueueItem = {
    id: uid(),
    orgId,
    entityType,
    entityId,
    operation,
    payload,
    updatedAt: now(),
    version: now(),
  };
  inMemorySyncQueue = [...inMemorySyncQueue, item];
  if (!hasStore()) {
    return;
  }
  void whenOfflineDataReady()
    .then(() => offlineEnqueue(toQueuedChange(item)))
    .catch((error) => warn("a change could not be queued for the server", error));
};

/** A copy, because the sync sorts what it is given. */
export const readSyncQueue = (): SyncQueueItem[] => {
  void whenOfflineDataReady();
  return [...inMemorySyncQueue];
};

export const listSyncQueueByOrg = (orgId: string, limit = 100): SyncQueueItem[] =>
  readSyncQueue()
    .filter((item) => item.orgId === orgId)
    .sort((left, right) => left.updatedAt - right.updatedAt)
    .slice(0, limit);

export const removeSyncQueueItems = (ids: string[]) => {
  if (!ids.length) {
    return;
  }
  const taken = new Set(ids);
  inMemorySyncQueue = inMemorySyncQueue.filter((item) => !taken.has(item.id));
  if (!hasStore()) {
    return;
  }
  void whenOfflineDataReady()
    .then(() => offlineDequeue(ids))
    .catch((error) => warn("changes the server took could not be forgotten", error));
};
