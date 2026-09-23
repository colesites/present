import assert from "node:assert/strict";
import test from "node:test";

import { isMirroredStorageKey, planStorageStart } from "../src/shared/lib/web-storage.mjs";

// Known-issues §2 under Tauri. `src-tauri/src/services/web_storage.rs` carries
// the key cases.

test("present- and present: keys are mirrored; others and the excluded ones are not", () => {
  for (const key of [
    "present-settings",
    "present-timer-state-v1",
    "present:resizable:present-main-layout-v13",
    "present-props-cache-v1:j974y6jtddmkntznebptvfy70986qr3s",
  ]) {
    assert.equal(isMirroredStorageKey(key), true, key);
  }
  for (const key of [
    "present-looks-config",
    "present-service-state",
    "present-desktop-session",
    "present-local-data-v1",
    "present-local-data-meta-v1",
    "present-sync-queue-v1",
    "present-sync-id-map-v1",
    "__clerk_environment",
    "presentation",
    "Present-settings",
  ]) {
    assert.equal(isMirroredStorageKey(key), false, key);
  }
});

test("a build used before creates the store from its own storage", () => {
  assert.deepEqual(
    planStorageStart({
      initialized: false,
      firstWindow: true,
      storeItems: {},
      localItems: { "present-settings": "{}" },
    }),
    { importItems: { "present-settings": "{}" }, importFromElectron: false, set: [], remove: [] },
  );
});

test("a first launch anywhere creates the store from the Electron build", () => {
  assert.deepEqual(
    planStorageStart({ initialized: false, firstWindow: true, storeItems: {}, localItems: {} }),
    { importItems: null, importFromElectron: true, set: [], remove: [] },
  );
});

test("the first window brings localStorage up to the store: changed and missing set, extra removed", () => {
  assert.deepEqual(
    planStorageStart({
      initialized: true,
      firstWindow: true,
      storeItems: { "present-settings": "new", "present-ui-state": "same", "present-timer-state-v1": "t" },
      localItems: { "present-settings": "old", "present-ui-state": "same", "present-media-filters": "gone" },
    }),
    {
      importItems: null,
      importFromElectron: false,
      set: [
        ["present-settings", "new"],
        ["present-timer-state-v1", "t"],
      ],
      remove: ["present-media-filters"],
    },
  );
});

test("a later window leaves the shared localStorage alone", () => {
  assert.deepEqual(
    planStorageStart({
      initialized: true,
      firstWindow: false,
      storeItems: { "present-settings": "stale" },
      localItems: { "present-settings": "written a moment ago" },
    }),
    { importItems: null, importFromElectron: false, set: [], remove: [] },
  );
});
