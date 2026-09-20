//! The offline library, in SQLite.
//!
//! What a church has on the machine when the internet is not there: the
//! library, its categories, the services and the saved messages, and the queue
//! of changes made offline that Convex has not been told about yet.
//!
//! **Why it moved out of the browser** (owner, 2026-09-15). It lived in
//! localStorage with an IndexedDB mirror, which means it lived in one window's
//! web storage — a different store per origin, lost with the profile, and only
//! reachable from React. A service's content should outlive the window it was
//! typed into, and the sync engine that will carry it to Convex belongs beside
//! the rest of the core.
//!
//! **The rows are documents.** Each row is one entity as the app already
//! writes it, as JSON, keyed by workspace, kind and id. The React types stay
//! where they are and the store does not have to be migrated every time a
//! slide gains a field; what it does own is the identity, the workspace, and
//! when it changed — which is all the sync needs to reason about.
//!
//! WAL, because a write while the compositor reads must not block it, and
//! `synchronous = NORMAL`, which is the usual pairing: a power cut can lose
//! the last transaction, not the database.

pub mod schema;

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};

/// The kinds of thing the offline library holds, as the React tree names them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Category,
    Library,
    Service,
    Message,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Category => "category",
            Kind::Library => "library",
            Kind::Service => "service",
            Kind::Message => "message",
        }
    }
}

/// One entity, as the app wrote it.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    /// The entity itself, untouched.
    pub body: serde_json::Value,
    /// When it last changed here, in milliseconds.
    pub updated_at: i64,
    /// Bumped on every write, so a sync can tell which copy is newer.
    pub version: i64,
}

/// A change made here that Convex has not been told about.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedChange {
    pub id: String,
    pub workspace: String,
    pub kind: Kind,
    pub entity_id: String,
    /// "create", "update", "delete" or "reorder", as the sync engine names them.
    pub operation: String,
    pub payload: serde_json::Value,
    pub queued_at: i64,
    pub version: i64,
}

/// The library on this machine.
pub struct Store {
    connection: Connection,
}

impl Store {
    /// Open the database beside the app's other settings, making it if needed.
    pub fn open(config_dir: &Path) -> AppResult<Self> {
        let path = config_dir.join("library.sqlite3");
        let connection = Connection::open(&path).map_err(sql_error)?;
        Self::prepare(connection)
    }

    /// A store in memory, for tests.
    #[cfg(test)]
    pub fn in_memory() -> AppResult<Self> {
        Self::prepare(Connection::open_in_memory().map_err(sql_error)?)
    }

    fn prepare(connection: Connection) -> AppResult<Self> {
        // A reader must never wait on a writer: the operator's window reads
        // this while a sync writes to it.
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(sql_error)?;
        // The pairing WAL is meant for: a power cut can cost the last
        // transaction, never the file.
        connection
            .pragma_update(None, "synchronous", "NORMAL")
            .map_err(sql_error)?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(sql_error)?;
        // Rather than failing a write because something else holds the file.
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(sql_error)?;

        let mut connection = connection;
        schema::migrations()
            .to_latest(&mut connection)
            .map_err(|error| AppError::Invalid(format!("the library could not be prepared: {error}")))?;
        Ok(Self { connection })
    }

    /// Every document of one kind in a workspace, oldest change first.
    pub fn list(&self, workspace: &str, kind: Kind) -> AppResult<Vec<Document>> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, body, updated_at, version FROM documents \
                 WHERE workspace = ?1 AND kind = ?2 ORDER BY updated_at, id",
            )
            .map_err(sql_error)?;
        let rows = statement
            .query_map(params![workspace, kind.as_str()], |row| {
                Ok(Document {
                    id: row.get(0)?,
                    body: serde_json::from_str(&row.get::<_, String>(1)?)
                        .unwrap_or(serde_json::Value::Null),
                    updated_at: row.get(2)?,
                    version: row.get(3)?,
                })
            })
            .map_err(sql_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)
    }

    /// Write one document, replacing what was there.
    ///
    /// The version goes up every time, so whatever carries this to Convex can
    /// tell which copy is newer without trusting two clocks.
    pub fn put(
        &self,
        workspace: &str,
        kind: Kind,
        id: &str,
        body: &serde_json::Value,
        now_ms: i64,
    ) -> AppResult<Document> {
        let body_text = serde_json::to_string(body)
            .map_err(|error| AppError::Invalid(format!("this cannot be stored: {error}")))?;
        self.connection
            .execute(
                "INSERT INTO documents (workspace, kind, id, body, updated_at, version) \
                 VALUES (?1, ?2, ?3, ?4, ?5, 1) \
                 ON CONFLICT (workspace, kind, id) DO UPDATE SET \
                 body = excluded.body, updated_at = excluded.updated_at, \
                 version = documents.version + 1",
                params![workspace, kind.as_str(), id, body_text, now_ms],
            )
            .map_err(sql_error)?;
        self.get(workspace, kind, id)?
            .ok_or_else(|| AppError::Invalid("the document went missing as it was written".to_owned()))
    }

    pub fn get(&self, workspace: &str, kind: Kind, id: &str) -> AppResult<Option<Document>> {
        self.connection
            .query_row(
                "SELECT id, body, updated_at, version FROM documents \
                 WHERE workspace = ?1 AND kind = ?2 AND id = ?3",
                params![workspace, kind.as_str(), id],
                |row| {
                    Ok(Document {
                        id: row.get(0)?,
                        body: serde_json::from_str(&row.get::<_, String>(1)?)
                            .unwrap_or(serde_json::Value::Null),
                        updated_at: row.get(2)?,
                        version: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(sql_error)
    }

    /// Remove one document. `true` when there was one.
    pub fn remove(&self, workspace: &str, kind: Kind, id: &str) -> AppResult<bool> {
        let removed = self
            .connection
            .execute(
                "DELETE FROM documents WHERE workspace = ?1 AND kind = ?2 AND id = ?3",
                params![workspace, kind.as_str(), id],
            )
            .map_err(sql_error)?;
        Ok(removed > 0)
    }

    /// Make a workspace's documents of one kind exactly these.
    ///
    /// What arrives from Convex: in one transaction, so a reader never sees
    /// half a library, and anything no longer there goes.
    pub fn replace(
        &mut self,
        workspace: &str,
        kind: Kind,
        documents: &[(String, serde_json::Value)],
        now_ms: i64,
    ) -> AppResult<usize> {
        let transaction = self.connection.transaction().map_err(sql_error)?;
        transaction
            .execute(
                "DELETE FROM documents WHERE workspace = ?1 AND kind = ?2",
                params![workspace, kind.as_str()],
            )
            .map_err(sql_error)?;
        {
            let mut insert = transaction
                .prepare(
                    "INSERT INTO documents (workspace, kind, id, body, updated_at, version) \
                     VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                )
                .map_err(sql_error)?;
            for (id, body) in documents {
                let body_text = serde_json::to_string(body).map_err(|error| {
                    AppError::Invalid(format!("this cannot be stored: {error}"))
                })?;
                insert
                    .execute(params![workspace, kind.as_str(), id, body_text, now_ms])
                    .map_err(sql_error)?;
            }
        }
        transaction.commit().map_err(sql_error)?;
        Ok(documents.len())
    }

    /// Remember a change to send to Convex when there is a network.
    pub fn enqueue(&self, change: &QueuedChange) -> AppResult<()> {
        let payload = serde_json::to_string(&change.payload)
            .map_err(|error| AppError::Invalid(format!("this cannot be queued: {error}")))?;
        self.connection
            .execute(
                "INSERT INTO sync_queue \
                 (id, workspace, kind, entity_id, operation, payload, queued_at, version) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
                 ON CONFLICT (id) DO UPDATE SET \
                 payload = excluded.payload, queued_at = excluded.queued_at, \
                 version = excluded.version, operation = excluded.operation",
                params![
                    change.id,
                    change.workspace,
                    change.kind.as_str(),
                    change.entity_id,
                    change.operation,
                    payload,
                    change.queued_at,
                    change.version,
                ],
            )
            .map_err(sql_error)?;
        Ok(())
    }

    /// Every workspace this machine holds anything for.
    ///
    /// What the app reads at startup: it has no list of its own until the
    /// network answers, and the point of this store is that it does not wait
    /// for the network.
    pub fn workspaces(&self) -> AppResult<Vec<String>> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT workspace FROM documents \
                 UNION SELECT workspace FROM sync_queue ORDER BY workspace",
            )
            .map_err(sql_error)?;
        let rows = statement.query_map([], |row| row.get(0)).map_err(sql_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)
    }

    /// The changes waiting, oldest first — for one workspace, or all of them.
    pub fn queued(&self, workspace: Option<&str>, limit: usize) -> AppResult<Vec<QueuedChange>> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, workspace, kind, entity_id, operation, payload, queued_at, version \
                 FROM sync_queue WHERE (?1 IS NULL OR workspace = ?1) \
                 ORDER BY queued_at, rowid LIMIT ?2",
            )
            .map_err(sql_error)?;
        let rows = statement
            .query_map(params![workspace, limit as i64], |row| {
                Ok(QueuedChange {
                    id: row.get(0)?,
                    workspace: row.get(1)?,
                    kind: kind_from(&row.get::<_, String>(2)?),
                    entity_id: row.get(3)?,
                    operation: row.get(4)?,
                    payload: serde_json::from_str(&row.get::<_, String>(5)?)
                        .unwrap_or(serde_json::Value::Null),
                    queued_at: row.get(6)?,
                    version: row.get(7)?,
                })
            })
            .map_err(sql_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)
    }

    /// Forget changes that reached Convex.
    pub fn dequeue(&mut self, ids: &[String]) -> AppResult<usize> {
        let transaction = self.connection.transaction().map_err(sql_error)?;
        let mut removed = 0;
        {
            let mut delete = transaction
                .prepare("DELETE FROM sync_queue WHERE id = ?1")
                .map_err(sql_error)?;
            for id in ids {
                removed += delete.execute(params![id]).map_err(sql_error)?;
            }
        }
        transaction.commit().map_err(sql_error)?;
        Ok(removed)
    }

    /// How many changes are waiting, for the whole machine.
    pub fn queue_depth(&self) -> AppResult<i64> {
        self.connection
            .query_row("SELECT COUNT(*) FROM sync_queue", [], |row| row.get(0))
            .map_err(sql_error)
    }
}

fn kind_from(value: &str) -> Kind {
    match value {
        "category" => Kind::Category,
        "service" => Kind::Service,
        "message" => Kind::Message,
        _ => Kind::Library,
    }
}

/// An id for something made on this machine.
///
/// A ULID: unique without asking anybody, and sortable by when it was made, so
/// rows come back in the order they were created without a separate sequence.
pub fn new_id() -> String {
    ulid::Ulid::new().to_string()
}

fn sql_error(error: rusqlite::Error) -> AppError {
    AppError::Invalid(format!("the library store failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store() -> Store {
        Store::in_memory().expect("a store")
    }

    #[test]
    fn a_document_comes_back_as_it_went_in() {
        let store = store();
        let body = json!({ "name": "Amazing grace", "slides": [{ "text": "Amazing grace" }] });
        let written = store
            .put("personal", Kind::Library, "item-1", &body, 1_000)
            .expect("it writes");
        assert_eq!(written.body, body, "the entity is not touched");
        assert_eq!(written.version, 1);

        let read = store
            .get("personal", Kind::Library, "item-1")
            .expect("it reads")
            .expect("it is there");
        assert_eq!(read, written);
    }

    #[test]
    fn writing_again_bumps_the_version_so_a_sync_knows_which_is_newer() {
        let store = store();
        store
            .put("personal", Kind::Library, "item-1", &json!({ "name": "First" }), 1_000)
            .expect("it writes");
        let second = store
            .put("personal", Kind::Library, "item-1", &json!({ "name": "Second" }), 2_000)
            .expect("it writes again");
        assert_eq!(second.version, 2);
        assert_eq!(second.updated_at, 2_000);
        assert_eq!(second.body["name"], "Second");
        assert_eq!(
            store.list("personal", Kind::Library).expect("it lists").len(),
            1,
            "the same id is one row"
        );
    }

    #[test]
    fn workspaces_and_kinds_do_not_see_each_other() {
        let store = store();
        store.put("personal", Kind::Library, "a", &json!({}), 1).unwrap();
        store.put("org_2", Kind::Library, "a", &json!({}), 1).unwrap();
        store.put("personal", Kind::Service, "a", &json!({}), 1).unwrap();

        assert_eq!(store.list("personal", Kind::Library).unwrap().len(), 1);
        assert_eq!(store.list("org_2", Kind::Library).unwrap().len(), 1);
        assert_eq!(store.list("personal", Kind::Service).unwrap().len(), 1);
        assert_eq!(store.list("org_2", Kind::Message).unwrap().len(), 0);
    }

    #[test]
    fn replacing_a_workspace_leaves_exactly_what_arrived() {
        let mut store = store();
        store.put("personal", Kind::Category, "old", &json!({ "name": "Old" }), 1).unwrap();
        store.put("org_2", Kind::Category, "keep", &json!({ "name": "Other" }), 1).unwrap();

        let arriving = vec![
            ("one".to_owned(), json!({ "name": "Songs" })),
            ("two".to_owned(), json!({ "name": "Hymns" })),
        ];
        let written = store
            .replace("personal", Kind::Category, &arriving, 5_000)
            .expect("it replaces");
        assert_eq!(written, 2);

        let ids: Vec<String> = store
            .list("personal", Kind::Category)
            .unwrap()
            .into_iter()
            .map(|document| document.id)
            .collect();
        assert_eq!(ids, vec!["one", "two"], "the old one is gone");
        assert_eq!(
            store.list("org_2", Kind::Category).unwrap().len(),
            1,
            "another workspace is untouched"
        );
    }

    #[test]
    fn removing_says_whether_there_was_anything_to_remove() {
        let store = store();
        store.put("personal", Kind::Service, "s1", &json!({}), 1).unwrap();
        assert!(store.remove("personal", Kind::Service, "s1").unwrap());
        assert!(!store.remove("personal", Kind::Service, "s1").unwrap());
        assert!(store.get("personal", Kind::Service, "s1").unwrap().is_none());
    }

    fn change(id: &str, at: i64) -> QueuedChange {
        QueuedChange {
            id: id.to_owned(),
            workspace: "personal".to_owned(),
            kind: Kind::Library,
            entity_id: "item-1".to_owned(),
            operation: "update".to_owned(),
            payload: json!({ "name": "Amazing grace" }),
            queued_at: at,
            version: 1,
        }
    }

    #[test]
    fn changes_wait_in_the_order_they_were_made_and_go_when_they_land() {
        let mut store = store();
        store.enqueue(&change("c2", 2_000)).unwrap();
        store.enqueue(&change("c1", 1_000)).unwrap();
        store.enqueue(&change("c3", 3_000)).unwrap();

        let waiting = store.queued(Some("personal"), 10).unwrap();
        assert_eq!(
            waiting.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            vec!["c1", "c2", "c3"],
            "oldest first"
        );
        assert_eq!(waiting[0].payload["name"], "Amazing grace");

        assert_eq!(store.dequeue(&["c1".to_owned(), "c3".to_owned()]).unwrap(), 2);
        assert_eq!(store.queue_depth().unwrap(), 1);
        assert_eq!(store.queued(Some("personal"), 10).unwrap()[0].id, "c2");
    }

    #[test]
    fn the_same_change_queued_twice_is_one_change() {
        let store = store();
        store.enqueue(&change("c1", 1_000)).unwrap();
        let mut later = change("c1", 5_000);
        later.payload = json!({ "name": "Renamed" });
        later.version = 2;
        store.enqueue(&later).unwrap();

        let waiting = store.queued(Some("personal"), 10).unwrap();
        assert_eq!(waiting.len(), 1, "one row for one change");
        assert_eq!(waiting[0].payload["name"], "Renamed");
        assert_eq!(waiting[0].version, 2);
    }

    #[test]
    fn a_queue_is_read_per_workspace() {
        let store = store();
        store.enqueue(&change("c1", 1)).unwrap();
        let mut other = change("c2", 2);
        other.workspace = "org_2".to_owned();
        store.enqueue(&other).unwrap();

        assert_eq!(store.queued(Some("personal"), 10).unwrap().len(), 1);
        assert_eq!(store.queued(Some("org_2"), 10).unwrap().len(), 1);
        assert_eq!(store.queue_depth().unwrap(), 2);
    }

    /// What the app asks for at startup, before the network has told it
    /// anything: which workspaces this machine holds, and everything waiting.
    #[test]
    fn the_machine_can_say_what_it_holds_without_being_told() {
        let mut store = store();
        store
            .put("personal", Kind::Service, "s1", &json!({}), 1_000)
            .unwrap();
        store
            .put("org_2", Kind::Library, "l1", &json!({}), 1_000)
            .unwrap();
        let mut waiting = change("c1", 1_000);
        waiting.workspace = "org_3".to_owned();
        store.enqueue(&waiting).unwrap();

        assert_eq!(
            store.workspaces().unwrap(),
            vec!["org_2", "org_3", "personal"],
            "documents and the queue, each workspace once"
        );

        store.enqueue(&change("c2", 2_000)).unwrap();
        let all = store.queued(None, 10).unwrap();
        assert_eq!(
            all.iter().map(|change| change.id.as_str()).collect::<Vec<_>>(),
            vec!["c1", "c2"],
            "every workspace, oldest first"
        );
    }

    #[test]
    fn ids_made_here_sort_by_when_they_were_made() {
        let first = new_id();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let second = new_id();
        assert_ne!(first, second);
        assert!(first < second, "{first} should sort before {second}");
        assert_eq!(first.len(), 26, "a ULID");
    }

    /// The names the React tree reads, written down.
    ///
    /// `renderer/tauri/offline.ts` declares these fields by hand; a rename
    /// here that was not made there would leave the library looking empty,
    /// with nothing on screen to say why. This fails first instead.
    #[test]
    fn the_wire_names_are_the_ones_the_react_tree_expects() {
        let document = Document {
            id: "01J".to_owned(),
            body: json!({ "title": "Amazing grace" }),
            updated_at: 1_700_000_000_000,
            version: 3,
        };
        assert_eq!(
            serde_json::to_value(&document).unwrap(),
            json!({
                "id": "01J",
                "body": { "title": "Amazing grace" },
                "updatedAt": 1_700_000_000_000_i64,
                "version": 3,
            })
        );

        assert_eq!(
            serde_json::to_value(change("01J", 1_700_000_000_000)).unwrap(),
            json!({
                "id": "01J",
                "workspace": "personal",
                "kind": "library",
                "entityId": "item-1",
                "operation": "update",
                "payload": { "name": "Amazing grace" },
                "queuedAt": 1_700_000_000_000_i64,
                "version": 1,
            })
        );

        for (kind, name) in [
            (Kind::Category, "category"),
            (Kind::Library, "library"),
            (Kind::Service, "service"),
            (Kind::Message, "message"),
        ] {
            assert_eq!(serde_json::to_value(kind).unwrap(), json!(name));
            assert_eq!(
                serde_json::from_value::<Kind>(json!(name)).unwrap(),
                kind,
                "the React tree sends {name}"
            );
            assert_eq!(kind.as_str(), name, "and the column holds the same word");
        }
    }
}
