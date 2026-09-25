/**
 * The library on this machine, as the React tree reaches it.
 *
 * Everything the operator can open on a Sunday lives in SQLite beside the
 * app's settings (`services::store`), whether or not there is a network. A
 * change made here is written locally first and queued; the sync sends the
 * queue when it can. Nothing in here waits on Convex, so nothing in here can
 * be stopped by a bad line in a church hall.
 */

import { invoke } from "@tauri-apps/api/core";

/** The kinds of thing the library holds. Mirrors `services::store::Kind`. */
export type OfflineKind = "category" | "library" | "service" | "message" | "theme";

/** One entity, as this machine last wrote it. */
export type OfflineDocument<Body = unknown> = {
  id: string;
  /** The entity itself, untouched. */
  body: Body;
  /** When it last changed here, in milliseconds. */
  updatedAt: number;
  /** Bumped on every write, so a sync can tell which copy is newer. */
  version: number;
};

/** What a queued change did, as the sync engine names it. */
export type OfflineOperation = "create" | "update" | "delete" | "reorder";

/** A change made here that Convex has not been told about. */
export type OfflineQueuedChange<Payload = unknown> = {
  id: string;
  workspace: string;
  kind: OfflineKind;
  entityId: string;
  operation: OfflineOperation;
  payload: Payload;
  queuedAt: number;
  version: number;
};

/** Everything of one kind in a workspace, newest first. */
export const offlineList = <Body = unknown>(
  workspace: string,
  kind: OfflineKind,
): Promise<OfflineDocument<Body>[]> =>
  invoke<OfflineDocument<Body>[]>("offline_list", { workspace, kind });

/** Write one entity, making it if it is new. */
export const offlinePut = <Body = unknown>(
  workspace: string,
  kind: OfflineKind,
  id: string,
  body: Body,
): Promise<OfflineDocument<Body>> =>
  invoke<OfflineDocument<Body>>("offline_put", { workspace, kind, id, body });

/** Forget one entity. `false` when it was not there. */
export const offlineRemove = (
  workspace: string,
  kind: OfflineKind,
  id: string,
): Promise<boolean> => invoke<boolean>("offline_remove", { workspace, kind, id });

/**
 * Make a workspace's documents of one kind exactly these, in one transaction.
 *
 * What a sync does when Convex answers: the server's list wins whole, so an
 * entity deleted elsewhere goes here too.
 */
export const offlineReplace = <Body = unknown>(
  workspace: string,
  kind: OfflineKind,
  documents: Array<[string, Body]>,
): Promise<number> => invoke<number>("offline_replace", { workspace, kind, documents });

/** Remember a change for the sync to send. */
export const offlineEnqueue = <Payload = unknown>(
  change: OfflineQueuedChange<Payload>,
): Promise<void> => invoke<void>("offline_enqueue", { change });

/**
 * The changes waiting to reach Convex, oldest first — for one workspace, or
 * without one, for every workspace this machine holds.
 */
export const offlineQueued = <Payload = unknown>(
  workspace?: string,
  limit?: number,
): Promise<OfflineQueuedChange<Payload>[]> =>
  invoke<OfflineQueuedChange<Payload>[]>("offline_queued", {
    workspace: workspace ?? null,
    limit,
  });

/**
 * Every workspace this machine holds anything for.
 *
 * The app reads its library back before anything has told it which workspaces
 * exist — that is the whole point of the store — so the store is asked.
 */
export const offlineWorkspaces = (): Promise<string[]> => invoke<string[]>("offline_workspaces");

/** Forget changes the server has taken. */
export const offlineDequeue = (ids: string[]): Promise<number> =>
  invoke<number>("offline_dequeue", { ids });

/** How many changes are waiting, for the whole machine. */
export const offlineQueueDepth = (): Promise<number> => invoke<number>("offline_queue_depth");

/**
 * An id for something made on this machine: unique without asking anybody,
 * and sortable by when it was made, so an offline service keeps its order.
 */
export const offlineNewId = (): Promise<string> => invoke<string>("offline_new_id");
