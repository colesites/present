//! The library's schema, one migration at a time.
//!
//! Migrations are forward-only and never edited once they have shipped: an
//! operator's machine may be several versions behind, and the only way it can
//! catch up is by running what the last version ran. A change to the shape
//! goes in a new migration, even a small one.

use rusqlite_migration::{Migrations, M};

pub fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        // 1: the library itself, and the changes waiting for Convex.
        M::up(
            "CREATE TABLE documents (
                workspace  TEXT    NOT NULL,
                kind       TEXT    NOT NULL,
                id         TEXT    NOT NULL,
                body       TEXT    NOT NULL,
                updated_at INTEGER NOT NULL,
                version    INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (workspace, kind, id)
            );
            -- Reading a panel is 'everything of this kind, in this workspace,
            -- as it was last changed'.
            CREATE INDEX documents_by_kind
                ON documents (workspace, kind, updated_at);

            CREATE TABLE sync_queue (
                id         TEXT    PRIMARY KEY,
                workspace  TEXT    NOT NULL,
                kind       TEXT    NOT NULL,
                entity_id  TEXT    NOT NULL,
                operation  TEXT    NOT NULL,
                payload    TEXT    NOT NULL,
                queued_at  INTEGER NOT NULL,
                version    INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX sync_queue_by_workspace
                ON sync_queue (workspace, queued_at);",
        ),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn the_migrations_are_valid_and_reach_the_latest_version() {
        migrations().validate().expect("they are valid");

        let mut connection = Connection::open_in_memory().expect("a database");
        migrations()
            .to_latest(&mut connection)
            .expect("they apply to an empty database");

        // Applying again is what happens on every launch.
        migrations()
            .to_latest(&mut connection)
            .expect("they apply to a database that is already current");

        let tables: Vec<String> = connection
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(tables.iter().any(|name| name == "documents"));
        assert!(tables.iter().any(|name| name == "sync_queue"));
    }
}
