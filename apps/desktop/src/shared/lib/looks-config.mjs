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

/** @typedef {"mask"|"messages"|"props"|"announcements"|"presentation"|"slide"|"media"|"videoInput"} LookLayerKey */
/** @typedef {"program"|"stage"|"ndi"} LookTargetKey */

export const LOOK_LAYER_ORDER = [
  { key: "mask", label: "Mask" },
  { key: "messages", label: "Messages" },
  { key: "props", label: "Props" },
  { key: "announcements", label: "Announcements" },
  { key: "presentation", label: "Presentation" },
  { key: "slide", label: "Slide" },
  { key: "media", label: "Media" },
  { key: "videoInput", label: "Video Input" },
];

export const LOOK_TARGET_ORDER = [
  { key: "program", label: "Screen 1" },
  { key: "stage", label: "Stage" },
  { key: "ndi", label: "NDI" },
];

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
        announcements: false,
        presentation: true,
        slide: true,
        media: true,
        videoInput: true,
      },
      textPosition: { ...defaultTextPosition },
    },
    stage: {
      layers: {
        mask: false,
        messages: true,
        props: true,
        announcements: false,
        presentation: true,
        slide: true,
        media: false,
        videoInput: false,
      },
      textPosition: { ...defaultTextPosition, yPercent: 44, heightPercent: 70 },
    },
    ndi: {
      layers: {
        mask: false,
        messages: true,
        props: false,
        announcements: false,
        presentation: true,
        slide: true,
        media: true,
        videoInput: true,
      },
      textPosition: { ...defaultTextPosition },
    },
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
const normalizeLayers = (fallbackLayers, candidateLayers) =>
  LOOK_LAYER_ORDER.reduce(
    (accumulator, layer) => {
      const value = candidateLayers?.[layer.key];
      accumulator[layer.key] = typeof value === "boolean" ? value : fallbackLayers[layer.key];
      return accumulator;
    },
    { ...fallbackLayers },
  );

export const generateLookId = () => `look-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

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
  });

  return {
    id,
    name,
    targets: { program: target("program"), stage: target("stage"), ndi: target("ndi") },
  };
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

  const selectedTarget =
    candidate.selectedTarget === "program" ||
    candidate.selectedTarget === "stage" ||
    candidate.selectedTarget === "ndi"
      ? candidate.selectedTarget
      : fallback.selectedTarget;

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

export const withLayerEnabled = (config, lookId, target, layer, enabled, now = Date.now()) => ({
  ...config,
  looks: config.looks.map((look) =>
    look.id !== lookId
      ? look
      : {
          ...look,
          targets: {
            ...look.targets,
            [target]: {
              ...look.targets[target],
              layers: { ...look.targets[target].layers, [layer]: enabled },
            },
          },
        },
  ),
  updatedAt: now,
});

export const withTextPosition = (config, lookId, target, patch, now = Date.now()) => ({
  ...config,
  looks: config.looks.map((look) => {
    if (look.id !== lookId) {
      return look;
    }
    return {
      ...look,
      targets: {
        ...look.targets,
        [target]: {
          ...look.targets[target],
          textPosition: normalizeTextPosition({ ...look.targets[target].textPosition, ...patch }),
        },
      },
    };
  }),
  updatedAt: now,
});
