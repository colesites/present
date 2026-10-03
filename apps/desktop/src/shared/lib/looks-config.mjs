/**
 * Output layer flags and text placement — the "looks" configuration.
 *
 * Extracted from `src/renderer/shared/hooks/useLooksConfig.ts` so the rules can
 * be tested without React, and so the Rust port in
 * `src-tauri/src/services/looks.rs` can be checked against the same cases.
 * Behaviour is unchanged — `tests/looks-config.test.mjs` is the characterisation
 * suite that pins it. Same pattern as `display-selection.mjs` in Stage 2.
 *
 * Everything here is a pure function. The two impure inputs a look needs — the
 * clock and a fresh id — are passed in, so a test can supply fixed ones and the
 * Rust port does not have to reproduce `Date.now()` and `Math.random()`.
 *
 * `src/shared/types/looks.ts` re-exports the runtime values below and adds the
 * TypeScript types; import from there in `.ts` and `.tsx`.
 */

/** @typedef {"mask"|"messages"|"props"|"timer"|"announcements"|"presentation"|"slide"|"media"|"videoInput"} LookLayerKey */
/**
 * A column of a look: `program` for the Screen every setup has, `ndi` for the
 * NDI output in Connections, `stage` kept only so a stored config reads, and
 * an added audience screen's own id for the rest.
 * @typedef {string} LookTargetKey
 */

export const LOOK_LAYER_ORDER = [
  { key: "mask", label: "Mask" },
  { key: "messages", label: "Messages" },
  { key: "props", label: "Props" },
  { key: "timer", label: "Timer" },
  { key: "announcements", label: "Announcements" },
  // A presentation's slides — a PDF's pages, a PowerPoint's — on a layer of
  // their own, as ProPresenter keeps them, apart from the words and the media.
  { key: "presentation", label: "Slide" },
  // The words: a song, a verse, a slide made here. The key is older than the
  // Slide layer's name for presentations; the two were one Text layer until
  // 0.4.10.
  { key: "slide", label: "Text" },
  { key: "media", label: "Media" },
  { key: "videoInput", label: "Video Input" },
];

/** The three screens every setup has, by id (`services/screens.rs`). */
const BUILT_IN_SCREENS = ["audience", "media", "worship"];

/**
 * An id an added screen can have: `screens::is_usable_id`. Added screens get
 * ten hex digits, so one never reads as `program`, `stage` or `ndi`.
 */
export const isAddedScreenId = (id) =>
  typeof id === "string" &&
  id.length > 0 &&
  id.length <= 32 &&
  !BUILT_IN_SCREENS.includes(id) &&
  !id.includes("--") &&
  /^[A-Za-z0-9_-]+$/.test(id);

/** The column a word or an audience screen's id names, or null. `LookTarget::parse`. */
export const parseLookTarget = (value) => {
  if (value === "program" || value === "audience") return "program";
  if (value === "stage" || value === "ndi") return value;
  return isAddedScreenId(value) ? value : null;
};

/**
 * The column an audience screen is drawn through, or null for a stage
 * screen, which shows its stage layout instead. `LookTarget::for_screen`.
 */
export const lookTargetForScreen = (screenId) =>
  screenId === "audience" ? "program" : isAddedScreenId(screenId) ? screenId : null;

const defaultTextPosition = {
  xPercent: 50,
  yPercent: 50,
  widthPercent: 92,
  heightPercent: 84,
  textAlign: "center",
  verticalAlign: "middle",
};

export const createDefaultLookPreset = () => ({
  id: "default",
  name: "Default",
  targets: {
    program: {
      layers: {
        mask: false,
        messages: false,
        props: true,
        timer: true,
        announcements: false,
        presentation: true,
        slide: true,
        media: true,
        videoInput: true,
      },
      textPosition: { ...defaultTextPosition },
      layout: {},
    },
    stage: {
      layers: {
        mask: false,
        messages: true,
        props: true,
        timer: true,
        announcements: false,
        presentation: true,
        slide: true,
        media: false,
        videoInput: false,
      },
      textPosition: { ...defaultTextPosition, yPercent: 44, heightPercent: 70 },
      layout: {},
    },
    ndi: {
      layers: {
        mask: false,
        messages: true,
        // Props were never hidden from the stream; the timer was.
        props: true,
        timer: false,
        announcements: false,
        presentation: true,
        slide: true,
        media: true,
        videoInput: true,
      },
      textPosition: { ...defaultTextPosition },
      layout: {},
    },
    screens: {},
  },
});

export const createDefaultLooksConfig = (now = Date.now()) => ({
  version: 2,
  selectedTarget: "program",
  selectedLookId: "default",
  liveLookId: "default",
  looks: [createDefaultLookPreset()],
  updatedAt: now,
});

const clampPercent = (value) => Math.min(Math.max(value, 0), 100);

const normalizeTextPosition = (position) => ({
  xPercent: clampPercent(position.xPercent),
  yPercent: clampPercent(position.yPercent),
  widthPercent: clampPercent(position.widthPercent),
  heightPercent: clampPercent(position.heightPercent),
  textAlign: position.textAlign,
  verticalAlign: position.verticalAlign,
});

/**
 * Every layer key, taking a boolean from the candidate where there is one and
 * the fallback otherwise. A layer flag decides whether the congregation sees
 * something, so a malformed value must not become "visible" by accident.
 */
const normalizeLayers = (fallbackLayers, candidateLayers) => {
  const layers = LOOK_LAYER_ORDER.reduce(
    (accumulator, layer) => {
      const value = candidateLayers?.[layer.key];
      accumulator[layer.key] = typeof value === "boolean" ? value : fallbackLayers[layer.key];
      return accumulator;
    },
    { ...fallbackLayers },
  );
  // Saved before the Timer layer: its Props switch was the timer's, and
  // props, which it never hid, start as they would by default.
  if (typeof candidateLayers?.timer !== "boolean" && typeof candidateLayers?.props === "boolean") {
    layers.timer = candidateLayers.props;
    layers.props = fallbackLayers.props;
  }
  return layers;
};

/** The smallest a box can be, and how much smaller or bigger than the Screen's a layer can be drawn. */
const MIN_BOX_PERCENT = 5;
const MIN_SCALE_PERCENT = 25;
const MAX_SCALE_PERCENT = 400;

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const clampBetween = (value, low, high) =>
  Number.isNaN(value) ? low : Math.min(Math.max(value, low), Math.max(high, low));
const scaleOf = (part) =>
  clampBetween(isNumber(part.scalePercent) ? part.scalePercent : 100, MIN_SCALE_PERCENT, MAX_SCALE_PERCENT);
const isPart = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A box kept on the screen and big enough to see. `LookBox::clamped`. */
const normalizeBox = (box) => {
  if (!isPart(box)) return null;
  const { xPercent, yPercent, widthPercent, heightPercent } = box;
  if (![xPercent, yPercent, widthPercent, heightPercent].every(isNumber)) return null;
  const width = clampBetween(widthPercent, MIN_BOX_PERCENT, 100);
  const height = clampBetween(heightPercent, MIN_BOX_PERCENT, 100);
  return {
    xPercent: clampBetween(xPercent, width / 2, 100 - width / 2),
    yPercent: clampBetween(yPercent, height / 2, 100 - height / 2),
    widthPercent: width,
    heightPercent: height,
  };
};

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Where a column puts each layer on its screen, as far as it can be read. A
 * part that cannot be read is left out — where the Screen puts it — never
 * somewhere made up. `normalize_layout`.
 */
export const normalizeLayout = (candidate) => {
  const layout = {};
  if (!isPart(candidate)) return layout;
  const { words, slide, media, props, timer, messages } = candidate;

  const wordsArea = isPart(words) ? normalizeBox(words.area) : null;
  if (wordsArea) {
    const backdrop = typeof words.backdrop === "string" ? words.backdrop.trim() : "";
    layout.words = {
      area: wordsArea,
      textAlign: words.textAlign === "left" || words.textAlign === "right" ? words.textAlign : "center",
      verticalAlign:
        words.verticalAlign === "top" || words.verticalAlign === "bottom" ? words.verticalAlign : "middle",
      scalePercent: scaleOf(words),
      textOnly: words.textOnly === true,
      ...(HEX_COLOR.test(backdrop) ? { backdrop } : {}),
    };
  }
  const slideArea = normalizeBox(slide);
  if (slideArea) layout.slide = slideArea;
  const mediaArea = isPart(media) ? normalizeBox(media.area) : null;
  if (mediaArea) layout.media = { area: mediaArea, fill: media.fill === true };
  const propsArea = normalizeBox(props);
  if (propsArea) layout.props = propsArea;
  if (isPart(timer) && isNumber(timer.xPercent) && isNumber(timer.yPercent)) {
    layout.timer = {
      xPercent: clampPercent(timer.xPercent),
      yPercent: clampPercent(timer.yPercent),
      scalePercent: scaleOf(timer),
    };
  }
  if (isPart(messages)) {
    layout.messages = {
      edge: messages.edge === "top" || messages.edge === "bottom" ? messages.edge : "asSent",
      scalePercent: scaleOf(messages),
    };
  }
  return layout;
};

export const generateLookId = () => `look-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

/**
 * An added audience screen's column until it is changed: every layer but the
 * mask, with the words where the Screen has them. The operator's toggles still
 * apply on top, so a screen added mid-service shows what the Screen shows.
 * `LookTargets::screen_default`.
 */
export const screenDefaultColumn = (targets) => ({
  layers: {
    mask: false,
    messages: true,
    props: true,
    timer: true,
    announcements: true,
    presentation: true,
    slide: true,
    media: true,
    videoInput: true,
  },
  textPosition: { ...targets.program.textPosition },
  layout: {},
});

/** A look's column for `target`, an added screen's default if it has none yet. */
export const lookColumn = (look, target) => {
  if (target === "program" || target === "stage" || target === "ndi") {
    return look.targets[target];
  }
  return look.targets.screens?.[target] ?? screenDefaultColumn(look.targets);
};

const normalizeLookPreset = (candidate, fallbackLook, index, newId) => {
  const id =
    typeof candidate?.id === "string" && candidate.id.trim().length > 0
      ? candidate.id.trim()
      : index === 0
        ? "default"
        : newId();

  const name =
    typeof candidate?.name === "string" && candidate.name.trim().length > 0
      ? candidate.name.trim()
      : index === 0
        ? "Default"
        : `Look ${index + 1}`;

  const target = (key) => ({
    layers: normalizeLayers(fallbackLook.targets[key].layers, candidate?.targets?.[key]?.layers),
    textPosition: normalizeTextPosition({
      ...fallbackLook.targets[key].textPosition,
      ...candidate?.targets?.[key]?.textPosition,
    }),
    layout: normalizeLayout(candidate?.targets?.[key]?.layout),
  });

  const targets = {
    program: target("program"),
    stage: target("stage"),
    ndi: target("ndi"),
    screens: {},
  };
  // Only an id an added screen could have: anything else names no screen.
  const fallbackScreen = screenDefaultColumn(targets);
  const storedScreens = candidate?.targets?.screens;
  if (storedScreens && typeof storedScreens === "object" && !Array.isArray(storedScreens)) {
    for (const [screenId, raw] of Object.entries(storedScreens)) {
      if (!isAddedScreenId(screenId)) continue;
      targets.screens[screenId] = {
        layers: normalizeLayers(fallbackScreen.layers, raw?.layers),
        textPosition: normalizeTextPosition({ ...fallbackScreen.textPosition, ...raw?.textPosition }),
        layout: normalizeLayout(raw?.layout),
      };
    }
  }

  return { id, name, targets };
};

/**
 * Turn whatever was in storage into a usable config.
 *
 * Defensive on purpose: this reads `localStorage`, which survives app versions,
 * hand-editing and half-written writes. A config that cannot be parsed loses
 * the operator's looks — bad — but a config that parses into nonsense can put
 * the wrong layers on the audience screen mid-service, which is worse.
 *
 * @param {unknown} candidate parsed JSON from storage, or null
 * @param {{ now?: number, newId?: () => string }} [clock]
 */
export const normalizeLooksConfig = (candidate, { now = Date.now(), newId = generateLookId } = {}) => {
  const fallback = createDefaultLooksConfig(now);
  const fallbackLook = createDefaultLookPreset();
  if (!candidate) {
    return fallback;
  }

  const selectedTarget = parseLookTarget(candidate.selectedTarget) ?? fallback.selectedTarget;

  const updatedAt =
    typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
      ? candidate.updatedAt
      : now;

  if (candidate.version === 2 && Array.isArray(candidate.looks) && candidate.looks.length > 0) {
    const looks = candidate.looks.map((look, index) =>
      normalizeLookPreset(look, fallbackLook, index, newId),
    );
    const fallbackLookId = looks[0]?.id ?? "default";
    const selectedLookId =
      typeof candidate.selectedLookId === "string" &&
      looks.some((look) => look.id === candidate.selectedLookId)
        ? candidate.selectedLookId
        : fallbackLookId;
    const liveLookId =
      typeof candidate.liveLookId === "string" &&
      looks.some((look) => look.id === candidate.liveLookId)
        ? candidate.liveLookId
        : fallbackLookId;

    return { version: 2, selectedTarget, selectedLookId, liveLookId, looks, updatedAt };
  }

  // Version 1 held a single unnamed preset. Migrate it into the list rather
  // than discarding it: it is the operator's own layer setup.
  if (candidate.version === 1 && candidate.targets) {
    const migratedLook = normalizeLookPreset(
      {
        id: "default",
        name:
          typeof candidate.presetName === "string" && candidate.presetName.trim().length > 0
            ? candidate.presetName.trim()
            : "Default",
        targets: candidate.targets,
      },
      fallbackLook,
      0,
      newId,
    );
    return {
      version: 2,
      selectedTarget,
      selectedLookId: migratedLook.id,
      liveLookId: migratedLook.id,
      looks: [migratedLook],
      updatedAt,
    };
  }

  return {
    version: 2,
    selectedTarget,
    selectedLookId: fallback.selectedLookId,
    liveLookId: fallback.liveLookId,
    looks: fallback.looks,
    updatedAt,
  };
};

// --- transitions ---------------------------------------------------------
// Each returns a new config. `now` is passed in so a caller can make a whole
// batch share one timestamp, and so tests are deterministic.

export const withSelectedTarget = (config, target, now = Date.now()) => ({
  ...config,
  selectedTarget: target,
  updatedAt: now,
});

/**
 * Selecting a look also takes it live. That is the product behaviour: the
 * Looks window's list is a "what is on screen" control, not a preview.
 */
export const withSelectedLook = (config, lookId, now = Date.now()) => {
  if (!config.looks.some((look) => look.id === lookId)) {
    return config;
  }
  return { ...config, selectedLookId: lookId, liveLookId: lookId, updatedAt: now };
};

/** Adds a copy of whichever look is currently live. */
export const withAddedLook = (config, name, { now = Date.now(), newId = generateLookId } = {}) => {
  const sourceLook = config.looks.find((look) => look.id === config.liveLookId) ?? config.looks[0];
  if (!sourceLook) {
    return config;
  }

  const lookName =
    typeof name === "string" && name.trim().length > 0
      ? name.trim()
      : `Look ${config.looks.length + 1}`;

  const copyTarget = (key) => ({
    layers: { ...sourceLook.targets[key].layers },
    textPosition: { ...sourceLook.targets[key].textPosition },
  });

  const newLook = {
    id: newId(),
    name: lookName,
    targets: {
      program: copyTarget("program"),
      stage: copyTarget("stage"),
      ndi: copyTarget("ndi"),
      screens: Object.fromEntries(
        Object.entries(sourceLook.targets.screens ?? {}).map(([screenId, column]) => [
          screenId,
          { layers: { ...column.layers }, textPosition: { ...column.textPosition } },
        ]),
      ),
    },
  };

  return {
    ...config,
    selectedLookId: newLook.id,
    looks: [...config.looks, newLook],
    updatedAt: now,
  };
};

export const withLookName = (config, lookId, name, now = Date.now()) => {
  const trimmed = name.trim();
  const nextName = trimmed.length > 0 ? trimmed : "Untitled Look";
  return {
    ...config,
    looks: config.looks.map((look) => (look.id !== lookId ? look : { ...look, name: nextName })),
    updatedAt: now,
  };
};

/** A look with one column replaced: a fixed one in place, an added screen's in `screens`. */
const withColumn = (look, target, change) => {
  const column = change(lookColumn(look, target));
  if (target === "program" || target === "stage" || target === "ndi") {
    return { ...look, targets: { ...look.targets, [target]: column } };
  }
  return {
    ...look,
    targets: { ...look.targets, screens: { ...look.targets.screens, [target]: column } },
  };
};

export const withLayerEnabled = (config, lookId, target, layer, enabled, now = Date.now()) => ({
  ...config,
  looks: config.looks.map((look) =>
    look.id !== lookId
      ? look
      : withColumn(look, target, (column) => ({
          ...column,
          layers: { ...column.layers, [layer]: enabled },
        })),
  ),
  updatedAt: now,
});

export const withTextPosition = (config, lookId, target, patch, now = Date.now()) => ({
  ...config,
  looks: config.looks.map((look) =>
    look.id !== lookId
      ? look
      : withColumn(look, target, (column) => ({
          ...column,
          textPosition: normalizeTextPosition({ ...column.textPosition, ...patch }),
        })),
  ),
  updatedAt: now,
});

/** A column laid out afresh, read as a stored layout is. `set_layout`. */
export const withLayout = (config, lookId, target, layout, now = Date.now()) => ({
  ...config,
  looks: config.looks.map((look) =>
    look.id !== lookId
      ? look
      : withColumn(look, target, (column) => ({ ...column, layout: normalizeLayout(layout) })),
  ),
  updatedAt: now,
});
