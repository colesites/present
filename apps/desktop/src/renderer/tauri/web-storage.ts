/**
 * The app's browser storage, kept durable in Rust (known-issues §2).
 *
 * Every component reads `localStorage` synchronously, so it stays the cache
 * they read. What changes is where the truth is: `web-storage.json`, owned by
 * the Rust core and shared by every build on the machine, where localStorage is
 * partitioned by origin and the dev and packaged builds each had their own.
 *
 * Before React starts, the first window of a run brings localStorage up to the
 * store — creating the store on a first run, from this build's localStorage or
 * else once from the Electron build's. From then on every window's writes to a
 * mirrored key go to Rust as well. Which keys, and the start plan, are
 * `shared/lib/web-storage.mjs`.
 *
 * Failing here never stops the app: after a timeout, or on any error, React
 * starts with localStorage as it was.
 */

import { invoke } from "@tauri-apps/api/core";

import { isMirroredStorageKey, planStorageStart } from "../../shared/lib/web-storage.mjs";

/** Reading the store and bringing localStorage up to it: milliseconds. */
const START_TIMEOUT_MS = 2000;
/**
 * The one-time import from the Electron build copies and reads its LevelDB —
 * 2.5 s in a debug build on a large one. It happens once, on a first launch,
 * so it is given far longer than a normal start.
 */
const IMPORT_TIMEOUT_MS = 20000;

type StorageStart = {
  initialized: boolean;
  firstWindow: boolean;
  items: Record<string, string>;
};

type StorageChange = { key: string; value: string | null };

const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const report = (message: string): void => {
  void invoke("report_diagnostic", { message: `webStorage ${message}` }).catch(
    (): undefined => undefined,
  );
};

// The unpatched methods, for applying the store without echoing it back.
const originalSetItem = Storage.prototype.setItem;
const originalRemoveItem = Storage.prototype.removeItem;
const originalClear = Storage.prototype.clear;

const mirroredItems = (): Record<string, string> => {
  const items: Record<string, string> = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key !== null && isMirroredStorageKey(key)) {
      items[key] = window.localStorage.getItem(key) ?? "";
    }
  }
  return items;
};

let pending: StorageChange[] = [];
let flushQueued = false;

const flush = (): void => {
  flushQueued = false;
  const changes = pending;
  pending = [];
  void invoke("set_web_storage_items", { changes }).catch((error: unknown) => {
    console.error("[Storage] a write did not reach the Rust core", error);
  });
};

const queue = (change: StorageChange): void => {
  pending.push(change);
  if (!flushQueued) {
    flushQueued = true;
    // One call per task's worth of writes, in the order they were made.
    queueMicrotask(flush);
  }
};

/**
 * Send this window's writes to Rust. Patched on the prototype: assigning
 * `localStorage.setItem` would store an item called "setItem".
 */
const mirrorWrites = (): void => {
  Storage.prototype.setItem = function setItem(this: Storage, key: string, value: string) {
    originalSetItem.call(this, key, value);
    if (this === window.localStorage && isMirroredStorageKey(String(key))) {
      queue({ key: String(key), value: String(value) });
    }
  };
  Storage.prototype.removeItem = function removeItem(this: Storage, key: string) {
    originalRemoveItem.call(this, key);
    if (this === window.localStorage && isMirroredStorageKey(String(key))) {
      queue({ key: String(key), value: null });
    }
  };
  Storage.prototype.clear = function clear(this: Storage) {
    const removed = this === window.localStorage ? Object.keys(mirroredItems()) : [];
    originalClear.call(this);
    for (const key of removed) {
      queue({ key, value: null });
    }
  };
};

const applyToLocalStorage = (set: Array<[string, string]>, remove: string[]): void => {
  const refused: string[] = [];
  for (const [key, value] of set) {
    try {
      originalSetItem.call(window.localStorage, key, value);
    } catch {
      // A quota error on one key must not stop the rest arriving.
      refused.push(key);
    }
  }
  for (const key of remove) {
    originalRemoveItem.call(window.localStorage, key);
  }
  if (refused.length > 0) {
    report(`localStorage refused ${refused.length} key(s): ${refused.join(", ")}`);
  }
};

const TIMED_OUT = Symbol("timed out");

const within = <T>(promise: Promise<T>, milliseconds: number): Promise<T | typeof TIMED_OUT> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
};

/**
 * Bring localStorage up to the store. Resolves to whether this window's
 * writes should be mirrored.
 *
 * They are not when a first-run import outlives its timeout: React has started
 * on defaults by then, and mirroring its first writes would overwrite the
 * operator's imported settings the moment the import lands. That session's
 * changes are lost instead; the import is there on the next launch.
 */
const start = async (): Promise<boolean> => {
  const state = await within(invoke<StorageStart>("get_web_storage"), START_TIMEOUT_MS);
  if (state === TIMED_OUT) {
    report(`reading the store took over ${START_TIMEOUT_MS} ms; continuing with localStorage as it is`);
    return true;
  }

  const plan = planStorageStart({
    initialized: state.initialized,
    firstWindow: state.firstWindow,
    storeItems: state.items,
    localItems: mirroredItems(),
  });

  if (plan.importItems !== null || plan.importFromElectron) {
    const created = await within(
      invoke<Record<string, string>>("initialize_web_storage", { items: plan.importItems }),
      plan.importFromElectron ? IMPORT_TIMEOUT_MS : START_TIMEOUT_MS,
    );
    if (created === TIMED_OUT) {
      report("creating the store timed out; this window's changes will not be kept");
      return false;
    }
    if (plan.importFromElectron) {
      applyToLocalStorage(Object.entries(created), []);
      report(`created from the Electron build: ${Object.keys(created).length} key(s)`);
    } else {
      report(`created from this build's localStorage: ${Object.keys(created).length} key(s)`);
    }
    return true;
  }

  applyToLocalStorage(plan.set, plan.remove);
  return true;
};

/** Resolves when React may read localStorage. Never rejects. */
export const webStorageReady: Promise<void> = (async () => {
  if (!isTauri()) return;

  let mirror = true;
  try {
    mirror = await start();
  } catch (error) {
    report(`could not start: ${String(error)}`);
  } finally {
    if (mirror) mirrorWrites();
  }
})();
