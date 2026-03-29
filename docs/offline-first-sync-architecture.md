# Offline-First Sync Architecture

## 1) Architecture

```
┌─────────────────────────── Electron Desktop App ────────────────────────────┐
│ Renderer (React)                                                             │
│  - Zustand stores (session, workspace, sync status, entities)               │
│  - Local-first repositories (SQLite + filesystem media index)               │
│  - UI reads local DB only                                                    │
│                                                                              │
│ Main Process                                                                 │
│  - Deep link token handler: present://auth?token=...                        │
│  - Background sync scheduler (timer + online event + manual trigger)        │
│  - Media upload/download worker                                              │
│                                                                              │
│ Local persistence                                                            │
│  - SQLite (better-sqlite3): entities + sync queue + conflict log            │
│  - Filesystem: media blobs                                                   │
└──────────────────────────────────────────────────────────────────────────────┘
                                  │ HTTPS (token + X-Org-Id)
                                  ▼
┌──────────────────────────────── Backend API ────────────────────────────────┐
│ Auth: verify Clerk-issued bearer token                                      │
│ Org ACL: validate user belongs to org before every query/mutation           │
│ Sync APIs: /sync/push and /sync/pull (incremental by cursor/version)        │
│ Media APIs: signed upload/download endpoints + hash dedupe                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 2) SQLite Schema

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('personal','organization')),
  updatedAt INTEGER NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE libraries (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_libraries_orgId ON libraries(orgId);

CREATE TABLE library_items (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL,
  libraryId TEXT NOT NULL,
  type TEXT NOT NULL,
  contentJson TEXT NOT NULL,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  updatedAt INTEGER NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_library_items_orgId ON library_items(orgId);
CREATE INDEX idx_library_items_libraryId ON library_items(libraryId);

CREATE TABLE presentations (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL,
  title TEXT NOT NULL,
  structureJson TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_presentations_orgId ON presentations(orgId);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  byteSize INTEGER NOT NULL,
  uploadState TEXT NOT NULL DEFAULT 'pending',
  updatedAt INTEGER NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_media_orgId ON media(orgId);
CREATE INDEX idx_media_sha256 ON media(sha256);

CREATE TABLE sync_state (
  orgId TEXT PRIMARY KEY,
  pullCursor TEXT,
  lastSyncAt INTEGER,
  deviceId TEXT NOT NULL
);

CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL,
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL,
  operation TEXT NOT NULL,
  payloadJson TEXT NOT NULL,
  attemptCount INTEGER NOT NULL DEFAULT 0,
  nextRetryAt INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_sync_queue_orgId_nextRetryAt ON sync_queue(orgId, nextRetryAt);

CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL,
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL,
  localJson TEXT NOT NULL,
  remoteJson TEXT NOT NULL,
  resolvedStrategy TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
```

## 3) Sync Algorithm

1. UI writes to local DB only.
2. Every write appends an item to `sync_queue`.
3. Background scheduler triggers on:
   - app start
   - network online
   - interval (15-30s)
   - org switch
4. PUSH phase:
   - load due queue items (`nextRetryAt <= now`)
   - batch by orgId and entity type
   - POST `/sync/push`
   - on success remove queue item or mark reconciled version
   - on failure increment `attemptCount`, compute exponential backoff, set `nextRetryAt`
5. PULL phase:
   - GET `/sync/pull?orgId=...&cursor=...`
   - apply remote changes transactionally in SQLite
   - update pull cursor
6. Conflict resolution:
   - compare versions/updatedAt
   - deterministic winner
   - write conflict log row
7. Emit sync status store updates (`idle` | `syncing` | `error`) for UI badge.

## 4) API Contracts

### POST /sync/push

Request:

```json
{
  "orgId": "org_1",
  "deviceId": "device_abc",
  "changes": [
    {
      "queueId": "q_1",
      "entityType": "library_items",
      "entityId": "li_1",
      "operation": "upsert",
      "version": 12,
      "updatedAt": 1738451222000,
      "payload": { "id": "li_1", "libraryId": "lib_1", "contentJson": { "slides": [] } }
    }
  ]
}
```

Response:

```json
{
  "acked": [{ "queueId": "q_1", "serverVersion": 13 }],
  "rejected": [],
  "conflicts": []
}
```

### GET /sync/pull

`GET /sync/pull?orgId=org_1&cursor=cursor_123&limit=500`

Response:

```json
{
  "cursor": "cursor_124",
  "changes": [
    {
      "entityType": "libraries",
      "entityId": "lib_1",
      "operation": "upsert",
      "version": 8,
      "updatedAt": 1738451229000,
      "payload": { "id": "lib_1", "orgId": "org_1", "name": "Sunday Set" }
    }
  ]
}
```

## 5) Electron Integration

- Main process owns sync scheduler and online/offline detection.
- Renderer reads local DB and never blocks on network.
- On org switch:
  - update active `orgId` in store
  - reload org-scoped queries from local DB
  - trigger sync for the selected org

## 6) Zustand Stores

```ts
type SyncStatus = "idle" | "syncing" | "error";

type SessionStore = {
  token: string | null;
  user: { id: string; name: string; email: string } | null;
  organizations: { id: string; name: string; type: "personal" | "organization" }[];
  orgId: string | null;
  setToken: (token: string | null) => void;
  setOrgId: (orgId: string) => void;
};

type SyncStore = {
  statusByOrg: Record<string, SyncStatus>;
  lastSyncAtByOrg: Record<string, number | null>;
  queueSizeByOrg: Record<string, number>;
  setStatus: (orgId: string, status: SyncStatus) => void;
};
```

## 7) Code Snippets

### Queue

```ts
export async function enqueueChange(db: Database, input: {
  orgId: string;
  entityType: string;
  entityId: string;
  operation: string;
  payload: unknown;
}) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO sync_queue (id, orgId, entityType, entityId, operation, payloadJson, attemptCount, nextRetryAt, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
  `).run(crypto.randomUUID(), input.orgId, input.entityType, input.entityId, input.operation, JSON.stringify(input.payload), now, now);
}
```

### Sync Loop

```ts
export async function syncOrg(orgId: string, token: string) {
  setSyncStatus(orgId, "syncing");
  try {
    const due = queueRepo.listDue(orgId, Date.now(), 200);
    if (due.length > 0) {
      const pushRes = await api.push(orgId, due, token);
      queueRepo.applyPushResult(pushRes);
    }
    const cursor = syncStateRepo.getCursor(orgId);
    const pullRes = await api.pull(orgId, cursor, token);
    localApplyRepo.applyChanges(orgId, pullRes.changes);
    syncStateRepo.setCursor(orgId, pullRes.cursor);
    setSyncStatus(orgId, "idle");
  } catch (error) {
    queueRepo.bumpRetry(orgId, Date.now());
    setSyncStatus(orgId, "error");
  }
}
```

### Conflict Handling

```ts
export function resolveConflict(local: { version: number; updatedAt: number }, remote: { version: number; updatedAt: number }) {
  if (remote.version > local.version) return "remote";
  if (remote.version < local.version) return "local";
  if (remote.updatedAt > local.updatedAt) return "remote";
  if (remote.updatedAt < local.updatedAt) return "local";
  return "local";
}
```
