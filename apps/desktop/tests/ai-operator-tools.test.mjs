import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// `ai-operator:list-tools` returns this file under Electron and under Tauri.
// It is the operator's command surface (audit §11), so its shape is pinned.
const tools = JSON.parse(
  readFileSync(new URL("../src/shared/ai-operator/present-tools.json", import.meta.url), "utf8"),
);

test("the operator exposes 46 present tools, each named once", () => {
  assert.equal(tools.length, 46);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 46);
  assert.deepEqual([...new Set(tools.map((tool) => tool.namespace))], ["present"]);
  assert.deepEqual(tools.slice(0, 3).map((tool) => tool.name), ["open_song", "search_song", "queue_song"]);
  assert.equal(tools.at(-1).name, "open_settings");
});

test("every tool has a description and a closed object schema whose required keys exist", () => {
  for (const tool of tools) {
    assert.match(tool.name, /^[a-z][a-z_]*$/, tool.name);
    assert.ok(tool.description.length > 0, tool.name);
    assert.equal(tool.inputSchema.type, "object", tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    for (const key of tool.inputSchema.required ?? []) {
      assert.ok(key in (tool.inputSchema.properties ?? {}), `${tool.name} requires ${key}`);
    }
  }
});
