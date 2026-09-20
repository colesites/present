/**
 * What a row in the offline store is, and which rows an edit changed.
 *
 * Kept apart from `localData.ts` because this is the part that has to be
 * right: one edit must write one row, a thing that went must leave no row
 * behind, and a change waiting for the server must survive the trip through
 * SQLite unchanged. None of that needs a window, so it can be tested.
 */

/**
 * Which array of the in-memory library holds a kind of thing, and what
 * `services::store::Kind` calls it.
 */
export const KINDS = [
  ["categories", "category"],
  ["libraryItems", "library"],
  ["services", "service"],
  ["messages", "message"],
];

/**
 * A row's name: its kind, its workspace and its id.
 *
 * Written as JSON so that no id, however punctuated, can spell another row's
 * name.
 */
export function rowKey(kind, workspace, id) {
  return JSON.stringify([kind, workspace, id]);
}

/** @param {string} key */
export function readRowKey(key) {
  const [kind, workspace, id] = JSON.parse(key);
  return { kind, workspace, id };
}

/**
 * Every row the library would have if it were written now.
 *
 * Anything without both a workspace and an id is left out: it is half-made,
 * and belongs to whoever is making it rather than to the store.
 *
 * @param {Record<string, Array<{ _id?: unknown, orgId?: unknown }>>} state
 */
export function rowsOf(state) {
  const rows = new Map();
  for (const [field, kind] of KINDS) {
    for (const body of Array.isArray(state[field]) ? state[field] : []) {
      const workspace = String(body.orgId ?? "");
      const id = String(body._id ?? "");
      if (!workspace || !id) {
        continue;
      }
      rows.set(rowKey(kind, workspace, id), { kind, workspace, id, body });
    }
  }
  return rows;
}

/**
 * Which rows to write, and which to drop.
 *
 * Compared by identity, not by value: every edit builds a new object for the
 * thing it changed and leaves everything else alone, so identity says exactly
 * what changed — one row written for one edit, whatever else the library
 * holds. Comparing by value would mean serialising all of it on every
 * keystroke.
 *
 * @param {Map<string, unknown>} written what the store is known to hold
 * @param {Map<string, { kind: string, workspace: string, id: string, body: unknown }>} rows
 */
export function changedRows(written, rows) {
  const puts = [];
  for (const [key, row] of rows) {
    if (written.get(key) !== row.body) {
      puts.push({ key, ...row });
    }
  }
  const removals = [];
  for (const key of written.keys()) {
    if (!rows.has(key)) {
      removals.push({ key, ...readRowKey(key) });
    }
  }
  return { puts, removals };
}

/**
 * A queued change as the store holds it. The names differ because the store
 * speaks of workspaces and kinds where the React tree speaks of orgs and
 * entity types; nothing else about it changes.
 */
export function toQueuedChange(item) {
  return {
    id: item.id,
    workspace: item.orgId,
    kind: item.entityType,
    entityId: item.entityId,
    operation: item.operation,
    payload: item.payload,
    queuedAt: item.updatedAt,
    version: item.version,
  };
}

/** The same change, as the sync reads it. */
export function fromQueuedChange(change) {
  return {
    id: change.id,
    orgId: change.workspace,
    entityType: change.kind,
    entityId: change.entityId,
    operation: change.operation,
    payload: change.payload,
    updatedAt: change.queuedAt,
    version: change.version,
  };
}
