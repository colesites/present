import assert from "node:assert/strict";
import test from "node:test";

import {
  LOOK_LAYER_ORDER,
  createDefaultLookPreset,
  createDefaultLooksConfig,
  normalizeLooksConfig,
  withAddedLook,
  withLayerEnabled,
  withLookName,
  withSelectedLook,
  withSelectedTarget,
  withTextPosition,
  lookColumn,
  lookTargetForScreen,
  parseLookTarget,
} from "../src/shared/lib/looks-config.mjs";

/**
 * Characterisation suite: this pins the CURRENT behaviour of the output layer
 * flags, extracted verbatim from `useLooksConfig.ts`, so the Rust port in
 * Stage 4 can be checked against the same cases. If an assertion here changes,
 * that is a product decision, not a refactor.
 *
 * These flags decide what the congregation sees. A layer that silently flips
 * is a slide appearing on the audience screen when the operator did not ask
 * for one.
 */

const CLOCK = { now: 1_700_000_000_000, newId: () => "look-fixed" };

test("no stored config yields the defaults", () => {
  const config = normalizeLooksConfig(null, CLOCK);

  assert.equal(config.version, 2);
  assert.equal(config.selectedTarget, "program");
  assert.equal(config.selectedLookId, "default");
  assert.equal(config.liveLookId, "default");
  assert.equal(config.looks.length, 1);
  assert.equal(config.updatedAt, CLOCK.now);
});

test("the default program look shows presentation, slide, media and props", () => {
  const { layers } = createDefaultLookPreset().targets.program;

  assert.deepEqual(layers, {
    mask: false,
    messages: false,
    props: true,
    announcements: false,
    presentation: true,
    slide: true,
    media: true,
    videoInput: true,
  });
});

test("the default stage look shows messages but not media", () => {
  // The stage display is the one the worship team looks at: they need the
  // words and the message banner, not the background video.
  const { layers } = createDefaultLookPreset().targets.stage;

  assert.equal(layers.messages, true);
  assert.equal(layers.media, false);
  assert.equal(layers.videoInput, false);
  assert.equal(layers.slide, true);
});

test("a v1 config is migrated rather than discarded", () => {
  // Version 1 held one unnamed preset. It is the operator's own setup and
  // throwing it away means rebuilding it before a service.
  const migrated = normalizeLooksConfig(
    {
      version: 1,
      presetName: "Sunday Morning",
      targets: {
        program: { layers: { media: false }, textPosition: {} },
        stage: { layers: {}, textPosition: {} },
        ndi: { layers: {}, textPosition: {} },
      },
    },
    CLOCK,
  );

  assert.equal(migrated.version, 2);
  assert.equal(migrated.looks.length, 1);
  assert.equal(migrated.looks[0].name, "Sunday Morning");
  assert.equal(migrated.looks[0].id, "default");
  assert.equal(migrated.looks[0].targets.program.layers.media, false);
  // Layers the v1 config did not mention keep the default.
  assert.equal(migrated.looks[0].targets.program.layers.slide, true);
  assert.equal(migrated.selectedLookId, "default");
  assert.equal(migrated.liveLookId, "default");
});

test("a v1 config with no preset name gets the default name", () => {
  const migrated = normalizeLooksConfig(
    { version: 1, presetName: "   ", targets: { program: {}, stage: {}, ndi: {} } },
    CLOCK,
  );

  assert.equal(migrated.looks[0].name, "Default");
});

test("an unrecognised version falls back to the defaults", () => {
  const config = normalizeLooksConfig({ version: 99, looks: [] }, CLOCK);

  assert.equal(config.version, 2);
  assert.equal(config.looks.length, 1);
  assert.equal(config.looks[0].id, "default");
});

test("a v2 config with an empty look list falls back to the defaults", () => {
  const config = normalizeLooksConfig({ version: 2, looks: [] }, CLOCK);

  assert.equal(config.looks.length, 1);
  assert.equal(config.looks[0].id, "default");
});

test("a non-boolean layer value takes the default, never becomes visible by accident", () => {
  const config = normalizeLooksConfig(
    {
      version: 2,
      looks: [
        {
          id: "default",
          name: "Default",
          targets: {
            program: {
              layers: { mask: "yes", messages: 1, props: null, slide: undefined },
              textPosition: {},
            },
            stage: { layers: {}, textPosition: {} },
            ndi: { layers: {}, textPosition: {} },
          },
        },
      ],
    },
    CLOCK,
  );

  const { layers } = config.looks[0].targets.program;
  assert.equal(layers.mask, false, "a truthy string must not enable the mask");
  assert.equal(layers.messages, false, "a truthy number must not enable messages");
  assert.equal(layers.props, true, "null falls back to the default, which is true");
  assert.equal(layers.slide, true);
});

test("every layer key is present after normalisation", () => {
  const config = normalizeLooksConfig(
    {
      version: 2,
      looks: [{ id: "a", name: "A", targets: { program: {}, stage: {}, ndi: {} } }],
    },
    CLOCK,
  );

  for (const target of ["program", "stage", "ndi"]) {
    const keys = Object.keys(config.looks[0].targets[target].layers).sort();
    const expected = LOOK_LAYER_ORDER.map((layer) => layer.key).sort();
    assert.deepEqual(keys, expected, `${target} is missing a layer`);
  }
});

test("text position percentages are clamped to 0-100", () => {
  const config = normalizeLooksConfig(
    {
      version: 2,
      looks: [
        {
          id: "a",
          name: "A",
          targets: {
            program: {
              layers: {},
              textPosition: { xPercent: -40, yPercent: 300, widthPercent: 150, heightPercent: -1 },
            },
            stage: {},
            ndi: {},
          },
        },
      ],
    },
    CLOCK,
  );

  const position = config.looks[0].targets.program.textPosition;
  assert.equal(position.xPercent, 0);
  assert.equal(position.yPercent, 100);
  assert.equal(position.widthPercent, 100);
  assert.equal(position.heightPercent, 0);
});

test("a selected look id that names no look falls back to the first", () => {
  const config = normalizeLooksConfig(
    {
      version: 2,
      selectedLookId: "deleted",
      liveLookId: "also-deleted",
      looks: [{ id: "first", name: "First", targets: { program: {}, stage: {}, ndi: {} } }],
    },
    CLOCK,
  );

  assert.equal(config.selectedLookId, "first");
  assert.equal(config.liveLookId, "first");
});

test("an unrecognised target falls back to program", () => {
  // Not a word, and not what an added screen's id can be.
  const config = normalizeLooksConfig({ version: 2, selectedTarget: "holo gram" }, CLOCK);

  assert.equal(config.selectedTarget, "program");
});

test("the first look is always called default even when unnamed", () => {
  const config = normalizeLooksConfig(
    { version: 2, looks: [{ targets: { program: {}, stage: {}, ndi: {} } }] },
    CLOCK,
  );

  assert.equal(config.looks[0].id, "default");
  assert.equal(config.looks[0].name, "Default");
});

test("later unnamed looks are numbered by position", () => {
  const config = normalizeLooksConfig(
    {
      version: 2,
      looks: [
        { targets: { program: {}, stage: {}, ndi: {} } },
        { targets: { program: {}, stage: {}, ndi: {} } },
      ],
    },
    CLOCK,
  );

  assert.equal(config.looks[1].name, "Look 2");
  assert.equal(config.looks[1].id, "look-fixed");
});

// --- transitions ---------------------------------------------------------

test("selecting a look also takes it live", () => {
  // Not a preview: the Looks list is a "what is on screen now" control.
  const base = withAddedLook(createDefaultLooksConfig(CLOCK.now), "Second", CLOCK);
  const next = withSelectedLook(base, "look-fixed", CLOCK.now);

  assert.equal(next.selectedLookId, "look-fixed");
  assert.equal(next.liveLookId, "look-fixed");
});

test("selecting a look that does not exist changes nothing", () => {
  const base = createDefaultLooksConfig(CLOCK.now);
  const next = withSelectedLook(base, "missing", CLOCK.now);

  assert.equal(next, base, "the same object is returned, so React does not re-render");
});

test("adding a look copies the one that is live, not the one selected", () => {
  const base = createDefaultLooksConfig(CLOCK.now);
  const edited = withLayerEnabled(base, "default", "program", "media", false, CLOCK.now);
  const added = withAddedLook(edited, "Copy", CLOCK);

  assert.equal(added.looks.length, 2);
  assert.equal(added.looks[1].targets.program.layers.media, false, "the copy inherits the edit");
});

test("adding a look selects it but does not take it live", () => {
  // The operator gets to set the new look up before it reaches the audience.
  const added = withAddedLook(createDefaultLooksConfig(CLOCK.now), "Copy", CLOCK);

  assert.equal(added.selectedLookId, "look-fixed");
  assert.equal(added.liveLookId, "default", "a new look must not go live on creation");
});

test("a copied look does not share layer objects with its source", () => {
  const added = withAddedLook(createDefaultLooksConfig(CLOCK.now), "Copy", CLOCK);
  const changed = withLayerEnabled(added, "look-fixed", "program", "slide", false, CLOCK.now);

  assert.equal(changed.looks[0].targets.program.layers.slide, true, "the source is untouched");
  assert.equal(changed.looks[1].targets.program.layers.slide, false);
});

test("an unnamed added look is numbered by the list length", () => {
  const added = withAddedLook(createDefaultLooksConfig(CLOCK.now), undefined, CLOCK);

  assert.equal(added.looks[1].name, "Look 2");
});

test("a blank look name becomes Untitled Look rather than empty", () => {
  const base = createDefaultLooksConfig(CLOCK.now);

  assert.equal(withLookName(base, "default", "   ", CLOCK.now).looks[0].name, "Untitled Look");
  assert.equal(withLookName(base, "default", " Evening ", CLOCK.now).looks[0].name, "Evening");
});

test("toggling a layer affects one look and one target only", () => {
  const base = withAddedLook(createDefaultLooksConfig(CLOCK.now), "Second", CLOCK);
  const next = withLayerEnabled(base, "default", "program", "slide", false, CLOCK.now);

  assert.equal(next.looks[0].targets.program.layers.slide, false);
  assert.equal(next.looks[0].targets.stage.layers.slide, true, "the stage target is untouched");
  assert.equal(next.looks[1].targets.program.layers.slide, true, "the other look is untouched");
});

test("text position updates are patched and clamped", () => {
  const base = createDefaultLooksConfig(CLOCK.now);
  const next = withTextPosition(base, "default", "program", { yPercent: 250 }, CLOCK.now);

  const position = next.looks[0].targets.program.textPosition;
  assert.equal(position.yPercent, 100, "clamped");
  assert.equal(position.xPercent, 50, "unpatched fields keep their value");
  assert.equal(position.textAlign, "center");
});

test("every transition stamps updatedAt", () => {
  const base = createDefaultLooksConfig(1);
  const stamp = 999;

  assert.equal(withSelectedTarget(base, "stage", stamp).updatedAt, stamp);
  assert.equal(withLookName(base, "default", "x", stamp).updatedAt, stamp);
  assert.equal(
    withLayerEnabled(base, "default", "program", "slide", false, stamp).updatedAt,
    stamp,
  );
  assert.equal(withTextPosition(base, "default", "program", {}, stamp).updatedAt, stamp);
});

test("a normalised config survives a round trip through JSON unchanged", () => {
  // This is how it reaches the other window today, and how it will reach Rust.
  const config = normalizeLooksConfig(null, CLOCK);
  const round = normalizeLooksConfig(JSON.parse(JSON.stringify(config)), CLOCK);

  assert.deepEqual(round, config);
});

// --- a column for each audience screen added in Screen Configuration -------
// Twins of the same-named tests in `services/looks.rs`.

const LOBBY = "a1b2c3d4e5";

test("an added screen with no column shows what the Screen shows", () => {
  const base = withTextPosition(createDefaultLooksConfig(CLOCK.now), "default", "program", { yPercent: 70 }, CLOCK.now);
  const lobby = lookColumn(base.looks[0], LOBBY);

  assert.equal(lobby.layers.mask, false);
  for (const { key } of LOOK_LAYER_ORDER.filter((layer) => layer.key !== "mask")) {
    assert.equal(lobby.layers[key], true, `${key} is left to the operator`);
  }
  assert.equal(lobby.textPosition.yPercent, 70, "the words where the Screen has them");
  assert.deepEqual(base.looks[0].targets.screens, {}, "nothing is stored until it changes");
});

test("a layer changed on an added screen is that screen's alone", () => {
  const next = withLayerEnabled(createDefaultLooksConfig(CLOCK.now), "default", LOBBY, "media", false, CLOCK.now);
  const look = next.looks[0];

  assert.equal(lookColumn(look, LOBBY).layers.media, false);
  assert.equal(lookColumn(look, LOBBY).layers.slide, true, "the rest of its column stays");
  assert.equal(look.targets.program.layers.media, true, "the Screen is untouched");
  assert.equal(lookColumn(look, "f0f0f0f0f0").layers.media, true, "and so is every other screen");
});

test("added screens' columns survive a round trip and a bad id is dropped", () => {
  const config = withSelectedTarget(
    withLayerEnabled(createDefaultLooksConfig(CLOCK.now), "default", LOBBY, "slide", false, CLOCK.now),
    LOBBY,
    CLOCK.now,
  );
  const encoded = JSON.parse(JSON.stringify(config));
  encoded.looks[0].targets.screens["not a screen"] = encoded.looks[0].targets.screens[LOBBY];

  const read = normalizeLooksConfig(encoded, CLOCK);
  assert.deepEqual(read, config);
  assert.equal(read.selectedTarget, LOBBY);
});

test("a column is named by a word or an audience screen's id", () => {
  assert.equal(parseLookTarget("program"), "program");
  assert.equal(parseLookTarget("audience"), "program");
  assert.equal(parseLookTarget("ndi"), "ndi");
  assert.equal(parseLookTarget(LOBBY), LOBBY);
  assert.equal(parseLookTarget("media"), null, "a stage screen has no look");
  assert.equal(parseLookTarget(""), null);

  assert.equal(lookTargetForScreen("audience"), "program");
  assert.equal(lookTargetForScreen("worship"), null);
});

test("a copied look carries its added screens' columns, not shared with the source", () => {
  const base = withLayerEnabled(createDefaultLooksConfig(CLOCK.now), "default", LOBBY, "props", false, CLOCK.now);
  const added = withAddedLook(base, "Copy", CLOCK);
  const changed = withLayerEnabled(added, "look-fixed", LOBBY, "props", true, CLOCK.now);

  assert.equal(lookColumn(added.looks[1], LOBBY).layers.props, false, "the copy inherits the edit");
  assert.equal(lookColumn(changed.looks[0], LOBBY).layers.props, false, "the source is untouched");
});
