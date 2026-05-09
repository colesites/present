"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LookLayerKey,
  LookPreset,
  LookTargetKey,
  LookTextPosition,
  LooksConfig,
} from "../../../shared/types/looks";
import {
  createDefaultLookPreset,
  createDefaultLooksConfig,
  LOOK_LAYER_ORDER,
} from "../../../shared/types/looks";

const LOOKS_STORAGE_KEY = "present-looks-config";

const clampPercent = (value: number) => Math.min(Math.max(value, 0), 100);

const normalizeTextPosition = (position: LookTextPosition): LookTextPosition => ({
  xPercent: clampPercent(position.xPercent),
  yPercent: clampPercent(position.yPercent),
  widthPercent: clampPercent(position.widthPercent),
  heightPercent: clampPercent(position.heightPercent),
  textAlign: position.textAlign,
  verticalAlign: position.verticalAlign,
});

const normalizeLayers = (
  fallbackLayers: Record<LookLayerKey, boolean>,
  candidateLayers: Partial<Record<LookLayerKey, unknown>> | undefined
): Record<LookLayerKey, boolean> =>
  LOOK_LAYER_ORDER.reduce(
    (acc, layer) => {
      const value = candidateLayers?.[layer.key];
      acc[layer.key] =
        typeof value === "boolean"
          ? value
          : fallbackLayers[layer.key];
      return acc;
    },
    { ...fallbackLayers }
  );

const generateLookId = () => `look-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

const normalizeLookPreset = (
  candidate: Partial<LookPreset> | null | undefined,
  fallbackLook: LookPreset,
  index: number
): LookPreset => {
  const id =
    typeof candidate?.id === "string" && candidate.id.trim().length > 0
      ? candidate.id.trim()
      : index === 0
        ? "default"
        : generateLookId();

  const name =
    typeof candidate?.name === "string" && candidate.name.trim().length > 0
      ? candidate.name.trim()
      : index === 0
        ? "Default"
        : `Look ${index + 1}`;

  return {
    id,
    name,
    targets: {
      program: {
        layers: normalizeLayers(
          fallbackLook.targets.program.layers,
          candidate?.targets?.program?.layers
        ),
        textPosition: normalizeTextPosition({
          ...fallbackLook.targets.program.textPosition,
          ...candidate?.targets?.program?.textPosition,
        }),
      },
      stage: {
        layers: normalizeLayers(
          fallbackLook.targets.stage.layers,
          candidate?.targets?.stage?.layers
        ),
        textPosition: normalizeTextPosition({
          ...fallbackLook.targets.stage.textPosition,
          ...candidate?.targets?.stage?.textPosition,
        }),
      },
      ndi: {
        layers: normalizeLayers(
          fallbackLook.targets.ndi.layers,
          candidate?.targets?.ndi?.layers
        ),
        textPosition: normalizeTextPosition({
          ...fallbackLook.targets.ndi.textPosition,
          ...candidate?.targets?.ndi?.textPosition,
        }),
      },
    },
  };
};

const normalizeLooksConfig = (candidate: Partial<LooksConfig> | null | undefined): LooksConfig => {
  const fallback = createDefaultLooksConfig();
  const fallbackLook = createDefaultLookPreset();
  if (!candidate) {
    return fallback;
  }

  const selectedTarget: LookTargetKey =
    candidate.selectedTarget === "program" ||
      candidate.selectedTarget === "stage" ||
      candidate.selectedTarget === "ndi"
      ? candidate.selectedTarget
      : fallback.selectedTarget;

  if (
    candidate.version === 2 &&
    Array.isArray(candidate.looks) &&
    candidate.looks.length > 0
  ) {
    const looks = candidate.looks.map((look, index) =>
      normalizeLookPreset(look, fallbackLook, index)
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

    return {
      version: 2,
      selectedTarget,
      selectedLookId,
      liveLookId,
      looks,
      updatedAt:
        typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
          ? candidate.updatedAt
          : Date.now(),
    };
  }

  const candidateV1 = candidate as unknown as Partial<{
    version: 1;
    presetName: string;
    targets: LookPreset["targets"];
  }>;

  if (candidateV1.version === 1 && candidateV1.targets) {
    const migratedLook = normalizeLookPreset(
      {
        id: "default",
        name:
          typeof candidateV1.presetName === "string" && candidateV1.presetName.trim().length > 0
            ? candidateV1.presetName.trim()
            : "Default",
        targets: candidateV1.targets,
      },
      fallbackLook,
      0
    );
    return {
      version: 2,
      selectedTarget,
      selectedLookId: migratedLook.id,
      liveLookId: migratedLook.id,
      looks: [migratedLook],
      updatedAt:
        typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
          ? candidate.updatedAt
          : Date.now(),
    };
  }

  return {
    version: 2,
    selectedTarget,
    selectedLookId: fallback.selectedLookId,
    liveLookId: fallback.liveLookId,
    looks: fallback.looks,
    updatedAt:
      typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
        ? candidate.updatedAt
        : Date.now(),
  };
};

const readLooksConfig = (): LooksConfig => {
  if (typeof window === "undefined") {
    return createDefaultLooksConfig();
  }

  try {
    const raw = window.localStorage.getItem(LOOKS_STORAGE_KEY);
    if (!raw) {
      return createDefaultLooksConfig();
    }
    return normalizeLooksConfig(JSON.parse(raw) as Partial<LooksConfig>);
  } catch {
    return createDefaultLooksConfig();
  }
};

export function useLooksConfig() {
  const lastLooksRawRef = useRef<string | null>(null);
  const [looksConfig, setLooksConfig] = useState<LooksConfig>(() => readLooksConfig());

  useEffect(() => {
    const syncFromStorage = () => {
      const raw = window.localStorage.getItem(LOOKS_STORAGE_KEY);
      if (!raw || raw === lastLooksRawRef.current) {
        return;
      }
      try {
        setLooksConfig(normalizeLooksConfig(JSON.parse(raw) as Partial<LooksConfig>));
        lastLooksRawRef.current = raw;
      } catch {
        void 0;
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOOKS_STORAGE_KEY || !event.newValue) {
        return;
      }
      try {
        setLooksConfig(normalizeLooksConfig(JSON.parse(event.newValue) as Partial<LooksConfig>));
        lastLooksRawRef.current = event.newValue;
      } catch {
        void 0;
      }
    };

    syncFromStorage();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", syncFromStorage);
    const intervalId = window.setInterval(syncFromStorage, 400);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", syncFromStorage);
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    try {
      const serialized = JSON.stringify(looksConfig);
      window.localStorage.setItem(LOOKS_STORAGE_KEY, serialized);
      lastLooksRawRef.current = serialized;
    } catch {
      void 0;
    }
  }, [looksConfig]);

  const setSelectedTarget = useCallback((target: LookTargetKey) => {
    setLooksConfig((current) => ({
      ...current,
      selectedTarget: target,
      updatedAt: Date.now(),
    }));
  }, []);

  const setSelectedLook = useCallback((lookId: string) => {
    setLooksConfig((current) => {
      if (!current.looks.some((look) => look.id === lookId)) {
        return current;
      }
      return {
        ...current,
        selectedLookId: lookId,
        liveLookId: lookId,
        updatedAt: Date.now(),
      };
    });
  }, []);

  const addLook = useCallback((name?: string) => {
    setLooksConfig((current) => {
      const sourceLook =
        current.looks.find((look) => look.id === current.liveLookId) ?? current.looks[0];
      if (!sourceLook) {
        return current;
      }
      const nextIndex = current.looks.length + 1;
      const lookName =
        typeof name === "string" && name.trim().length > 0
          ? name.trim()
          : `Look ${nextIndex}`;
      const newLook: LookPreset = {
        id: generateLookId(),
        name: lookName,
        targets: {
          program: {
            layers: { ...sourceLook.targets.program.layers },
            textPosition: { ...sourceLook.targets.program.textPosition },
          },
          stage: {
            layers: { ...sourceLook.targets.stage.layers },
            textPosition: { ...sourceLook.targets.stage.textPosition },
          },
          ndi: {
            layers: { ...sourceLook.targets.ndi.layers },
            textPosition: { ...sourceLook.targets.ndi.textPosition },
          },
        },
      };
      return {
        ...current,
        selectedLookId: newLook.id,
        looks: [...current.looks, newLook],
        updatedAt: Date.now(),
      };
    });
  }, []);

  const setLookName = useCallback((lookId: string, name: string) => {
    setLooksConfig((current) => {
      const trimmed = name.trim();
      const nextName = trimmed.length > 0 ? trimmed : "Untitled Look";
      return {
        ...current,
        looks: current.looks.map((look) =>
          look.id !== lookId
            ? look
            : {
              ...look,
              name: nextName,
            }
        ),
        updatedAt: Date.now(),
      };
    });
  }, []);

  const setLayerEnabledForLook = useCallback(
    (lookId: string, target: LookTargetKey, layer: LookLayerKey, enabled: boolean) => {
      setLooksConfig((current) => ({
        ...current,
        looks: current.looks.map((look) =>
          look.id !== lookId
            ? look
            : {
              ...look,
              targets: {
                ...look.targets,
                [target]: {
                  ...look.targets[target],
                  layers: {
                    ...look.targets[target].layers,
                    [layer]: enabled,
                  },
                },
              },
            }
        ),
        updatedAt: Date.now(),
      }));
    },
    []
  );

  const setLayerEnabled = useCallback(
    (target: LookTargetKey, layer: LookLayerKey, enabled: boolean) => {
      setLooksConfig((current) => {
        const selectedLookId = current.selectedLookId;
        return {
          ...current,
          looks: current.looks.map((look) =>
            look.id !== selectedLookId
              ? look
              : {
                ...look,
                targets: {
                  ...look.targets,
                  [target]: {
                    ...look.targets[target],
                    layers: {
                      ...look.targets[target].layers,
                      [layer]: enabled,
                    },
                  },
                },
              }
          ),
          updatedAt: Date.now(),
        };
      });
    },
    []
  );

  const setTextPositionForLook = useCallback(
    (lookId: string, target: LookTargetKey, patch: Partial<LookTextPosition>) => {
      setLooksConfig((current) => ({
        ...current,
        looks: current.looks.map((look) => {
          if (look.id !== lookId) {
            return look;
          }
          const nextPosition = normalizeTextPosition({
            ...look.targets[target].textPosition,
            ...patch,
          });
          return {
            ...look,
            targets: {
              ...look.targets,
              [target]: {
                ...look.targets[target],
                textPosition: nextPosition,
              },
            },
          };
        }),
        updatedAt: Date.now(),
      }));
    },
    []
  );

  const setTextPosition = useCallback(
    (target: LookTargetKey, patch: Partial<LookTextPosition>) => {
      setLooksConfig((current) => ({
        ...current,
        looks: current.looks.map((look) => {
          if (look.id !== current.selectedLookId) {
            return look;
          }
          const nextPosition = normalizeTextPosition({
            ...look.targets[target].textPosition,
            ...patch,
          });
          return {
            ...look,
            targets: {
              ...look.targets,
              [target]: {
                ...look.targets[target],
                textPosition: nextPosition,
              },
            },
          };
        }),
        updatedAt: Date.now(),
      }));
    },
    []
  );

  const selectedLook = useMemo(
    () =>
      looksConfig.looks.find((look) => look.id === looksConfig.selectedLookId) ??
      looksConfig.looks[0],
    [looksConfig.looks, looksConfig.selectedLookId]
  );

  const liveLook = useMemo(
    () =>
      looksConfig.looks.find((look) => look.id === looksConfig.liveLookId) ??
      looksConfig.looks[0],
    [looksConfig.liveLookId, looksConfig.looks]
  );

  const activeTargetConfig = useMemo(
    () => selectedLook.targets[looksConfig.selectedTarget],
    [looksConfig.selectedTarget, selectedLook.targets]
  );

  return {
    looksConfig,
    selectedLook,
    liveLook,
    activeTargetConfig,
    setSelectedLook,
    setSelectedTarget,
    addLook,
    setLookName,
    setLayerEnabled,
    setLayerEnabledForLook,
    setTextPosition,
    setTextPositionForLook,
  };
}
