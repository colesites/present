//! The offline library's database, for the whole app.
//!
//! One connection behind a lock. SQLite in WAL mode allows many readers and
//! one writer, and the writes here are small and rare — a slide saved, a
//! service reordered — so a second connection would buy nothing but a way for
//! two writers to meet.

use std::path::Path;
use std::sync::Mutex;

use crate::errors::AppResult;
use crate::services::store::Store;

pub struct StoreState {
    store: Mutex<Store>,
}

impl StoreState {
    /// Open the library, or say why it could not be opened.
    pub fn load(config_dir: &Path) -> AppResult<Self> {
        Ok(Self {
            store: Mutex::new(Store::open(config_dir)?),
        })
    }

    /// Do something with the library.
    ///
    /// A poisoned lock is taken anyway: a panic in one caller is no reason to
    /// stop an operator reaching their own songs.
    pub fn with<T>(&self, action: impl FnOnce(&mut Store) -> AppResult<T>) -> AppResult<T> {
        let mut store = self.store.lock().unwrap_or_else(|error| error.into_inner());
        action(&mut store)
    }
}
