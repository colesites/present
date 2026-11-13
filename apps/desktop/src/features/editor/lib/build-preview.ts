"use client";

import { create } from "zustand";

/**
 * A build preview playing on the editor's slide: the whole slide, each
 * click taken in turn, or one object's build on its own. The Build tab
 * starts it; the canvas plays it (`BuildPreviewLayer`).
 */
export type BuildPreview = {
  slideId: string;
  /** Only this build, from its start; the rest of the slide as made. */
  only?: { elementId: string; phase: "in" | "out" };
  /** Bumped on every start, so pressing Preview again starts again. */
  run: number;
};

type BuildPreviewState = {
  preview: BuildPreview | null;
  play: (slideId: string, only?: BuildPreview["only"]) => void;
  stop: () => void;
};

let runs = 0;

export const useBuildPreviewStore = create<BuildPreviewState>()((set) => ({
  preview: null,
  play: (slideId, only) => set({ preview: { slideId, only, run: (runs += 1) } }),
  stop: () => set({ preview: null }),
}));
