// @ts-check

/**
 * Which browser-storage keys the Tauri build keeps in Rust, and what a window
 * does with them when it starts.
 *
 * Known-issues §2: `localStorage` is partitioned by origin, and every build has
 * its own — Electron's packaged `app://app`, its dev server, Tauri's
 * `tauri://localhost`, Tauri's dev server. So an operator's settings, layout,
 * timers and templates vanish between builds. Under Tauri the durable copy is
 * `web-storage.json` in the app's data folder; `localStorage` stays the
 * synchronous cache every component already reads.
 *
 * Mirrored in `src-tauri/src/services/web_storage.rs`; pinned by
 * `tests/web-storage.test.mjs`.
 */

/** The prefixes the app writes under: `present-…`, and `present:resizable:…`. */
export const MIRRORED_PREFIXES = ["present-", "present:"];

/**
 * Keys with the prefix that are not mirrored, and why.
 *
 * - `present-looks-config`, `present-service-state`: Rust owns these slices
 *   under Tauri (Stage 4); a stale browser copy must not come back.
 * - `present-desktop-session`: the auth session is in the OS keychain.
 * - the offline library and its sync queue: several megabytes, rewritten on
 *   every change. They live in SQLite now (`services::store`), which is where
 *   a library belongs; a settings file is not the place for one.
 */
export const EXCLUDED_KEYS = new Set([
  "present-looks-config",
  "present-service-state",
  "present-desktop-session",
  "present-local-data-v1",
  "present-local-data-meta-v1",
  "present-sync-queue-v1",
  "present-sync-id-map-v1",
]);

/** @param {string} key */
export function isMirroredStorageKey(key) {
  return MIRRORED_PREFIXES.some((prefix) => key.startsWith(prefix)) && !EXCLUDED_KEYS.has(key);
}

/**
 * What a window does with storage when it starts.
 *
 * @param {{
 *   initialized: boolean,
 *   firstWindow: boolean,
 *   storeItems: Record<string, string>,
 *   localItems: Record<string, string>,
 * }} state
 *   `initialized`: the Rust store has been created. `firstWindow`: no other
 *   window has started this run. `localItems`: the mirrored keys this origin's
 *   localStorage holds now.
 * @returns {{
 *   importItems: Record<string, string> | null,
 *   importFromElectron: boolean,
 *   set: Array<[string, string]>,
 *   remove: string[],
 * }}
 *   `importItems`: what to create the store from, if it must be created from
 *   this origin. `importFromElectron`: create it from the Electron build instead.
 *   `set` and `remove`: what to change in localStorage before the app reads it.
 */
export function planStorageStart({ initialized, firstWindow, storeItems, localItems }) {
  if (!initialized) {
    const own = Object.keys(localItems).length > 0;
    return {
      // This build has been used already: its own settings are the newest.
      importItems: own ? localItems : null,
      // A first launch: carry the Electron build's settings over, once.
      importFromElectron: !own,
      set: [],
      remove: [],
    };
  }

  // A later window shares this run's localStorage, which the first window
  // already brought up to date and every window's writes keep current.
  if (!firstWindow) {
    return { importItems: null, importFromElectron: false, set: [], remove: [] };
  }

  const set = /** @type {Array<[string, string]>} */ (
    Object.entries(storeItems).filter(([key, value]) => localItems[key] !== value)
  );
  const remove = Object.keys(localItems).filter((key) => !(key in storeItems));
  return { importItems: null, importFromElectron: false, set, remove };
}
