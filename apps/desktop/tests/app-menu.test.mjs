import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The application menu is built in Rust (`services/app_menu.rs`) and carried
 * out by the operator window (`renderer/tauri/menu-commands.ts`). The two only
 * meet at run time, by id — so an item added on one side and forgotten on the
 * other is a menu entry that does nothing, found by an operator mid-service.
 * These pin the two sides to each other.
 */

const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(DESKTOP_DIR, relative), "utf8");

const menu = read("src-tauri/src/services/app_menu.rs");
const commands = read("src/renderer/tauri/menu-commands.ts");

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
const renderer = walk(path.join(DESKTOP_DIR, "src")).map((file) => fs.readFileSync(file, "utf8")).join("\n");

/** Every item id the Rust menu builds. */
const menuItems = () => {
  const built = menu.slice(0, menu.indexOf("#[cfg(test)]"));
  return new Set(
    [...built.matchAll(/"((?:file|edit|view|presentation|screens|help|window)\.[a-z.-]+)"/g)].map(
      (match) => match[1],
    ),
  );
};

/** The ones Rust carries out itself: the live controls, and Minimize. */
const handledInRust = () => {
  const controls = [...menu.matchAll(/"(presentation\.[a-z-]+)" => Action::/g)].map((match) => match[1]);
  return new Set([...controls, "window.minimize"]);
};

const registered = new Set(
  [...renderer.matchAll(/useMenuCommand\(\s*"([a-z.-]+)"/g)].map((match) => match[1]),
);
const throughTheOperator = new Set(
  [...commands.matchAll(/^\s*"([a-z.-]+)": \{ name: "/gm)].map((match) => match[1]),
);

test("every menu item the window carries out has something to carry it out", () => {
  const items = menuItems();
  assert.ok(items.size > 20, `expected the whole menu, found ${items.size} items`);

  const rust = handledInRust();
  for (const id of items) {
    if (rust.has(id)) continue;
    assert.ok(
      registered.has(id) || throughTheOperator.has(id),
      `"${id}" is in the menu but nothing in the window handles it — it would do nothing`,
    );
  }
});

test("every command a menu item hands on has a component that takes it", () => {
  const forwarded = [...renderer.matchAll(/runMenuCommand\(\s*"([a-z.-]+)"\s*\)/g)].map((match) => match[1]);
  assert.ok(forwarded.length > 0, "the File items hand over to the panels");
  for (const id of forwarded) {
    assert.ok(registered.has(id), `"${id}" is handed on, but no component registers for it`);
  }
});

test("the operator commands the menu borrows exist", () => {
  const tools = JSON.parse(read("src/shared/ai-operator/present-tools.json")).map((tool) => tool.name);
  for (const match of commands.matchAll(/\{ name: "([a-z_]+)"/g)) {
    assert.ok(tools.includes(match[1]), `the menu asks the operator for "${match[1]}", which it does not have`);
  }
});

test("the window reports every tick the menu has, under the same name", () => {
  const ticks = new Set([...menu.matchAll(/check\(\s*"([a-zA-Z]+)",/g)].map((match) => match[1]));
  const union = commands.slice(commands.indexOf("export type MenuCheck"), commands.indexOf(";", commands.indexOf("export type MenuCheck")));
  const known = new Set([...union.matchAll(/"([a-zA-Z]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...ticks].sort(), [...known].sort(), "the Rust ticks and MenuCheck have drifted");

  const reported = new Set(
    [...renderer.matchAll(/useMenuChecks\(\s*\{([^}]*)\}/g)].flatMap((match) =>
      [...match[1].matchAll(/([a-zA-Z]+):/g)].map((key) => key[1]),
    ),
  );
  for (const tick of ticks) {
    assert.ok(reported.has(tick), `the "${tick}" tick is never set, so it would always read off`);
  }
});

test("menu shortcuts leave typing alone", () => {
  // Arrows and a bare letter would be taken from text fields; ⌘T and ⌘M the
  // window owns, and ignores while typing or uses for the media panel.
  const accelerators = [
    ...menu.matchAll(/keyed\(\s*(?:"[^"]+"|[A-Z_]+),\s*"[^"]*",\s*"([^"]+)"/g),
  ].map((match) => match[1]);
  assert.ok(accelerators.length >= 6, `expected the menu's shortcuts, found ${accelerators.join(", ")}`);
  for (const keys of accelerators) {
    assert.ok(keys.startsWith("CmdOrCtrl+"), `"${keys}" is a shortcut without a modifier`);
    assert.ok(!/^CmdOrCtrl\+[TM]$/.test(keys), `${keys} belongs to the window`);
  }
});

test("only the operator window carries out the menu", () => {
  // Tauri sends the menu's events to every window, and the Settings window is
  // the same App. Listening there too did each command twice: a stage screen
  // turned off from the menu came straight back on.
  const app = read("src/renderer/main/App.tsx");
  assert.match(app, /useMenuCommandListener\(!isSettingsWindow\)/);
  assert.match(commands, /if \(!enabled \|\| !isTauriShell\(\)\) return;/);
  assert.match(app, /useMenuChecks\(\{ mediaStage: [^}]*\}, !isSettingsWindow\)/);
});
