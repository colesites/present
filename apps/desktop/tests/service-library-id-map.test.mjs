import assert from "node:assert/strict";
import test from "node:test";

import { remapServiceLibraryItemIds } from "../src/renderer/shared/offline/service-library-id-map.mjs";

test("remaps library service references and every supported layout key", () => {
  const libraryItem = {
    type: "library",
    refId: "local-library-id",
    label: "Song title",
    groupId: "worship",
    addedAt: 42,
  };
  const service = {
    items: [libraryItem, { type: "media", refId: "media-id", addedAt: 43 }],
    layout: [
      { type: "item", key: "library:local-library-id:42:worship" },
      { type: "item", key: "library:local-library-id:42:worship:Song title" },
      { type: "item", key: "library:local-library-id:42:Song title" },
      { type: "item", key: "media:media-id:43:standalone" },
    ],
  };

  const result = remapServiceLibraryItemIds(service, {
    "local-library-id": "remote-library-id",
  });

  assert.equal(result.items[0].refId, "remote-library-id");
  assert.equal(result.items[1].refId, "media-id");
  assert.deepEqual(
    result.layout.map((entry) => entry.key),
    [
      "library:remote-library-id:42:worship",
      "library:remote-library-id:42:worship:Song title",
      "library:remote-library-id:42:Song title",
      "media:media-id:43:standalone",
    ],
  );
  assert.equal(service.items[0].refId, "local-library-id");
});

test("leaves unmapped library references unchanged", () => {
  const service = {
    items: [{ type: "library", refId: "server-owned-id", addedAt: 1 }],
    layout: [{ type: "item", key: "library:server-owned-id:1:standalone" }],
  };

  assert.equal(remapServiceLibraryItemIds(service, {}), service);
});
