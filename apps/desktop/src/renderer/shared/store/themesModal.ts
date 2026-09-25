"use client";

import { create } from "zustand";
import type {
  CanvasSizePreset,
  LibrarySlide,
  LibraryTheme,
} from "../../../shared/types";

/** Where a theme is applied from: the editor's draft, or the song in Show. */
export type ThemeSurface = "editor" | "show";

/** The song a theme would go on, as the view in front sees it. */
export interface ThemeTarget {
  surface: ThemeSurface;
  libraryId: string;
  title: string;
  slides: LibrarySlide[];
  /** The slide "This slide" means: the one selected in Edit, or live in Show. */
  slideId: string | null;
  canvasSize: CanvasSizePreset;
  /** The theme recorded on the song, if one was applied to all of it. */
  themeId: string | null;
}

/** A request to apply a theme, for the surface that published the target. */
export interface ThemeApplication {
  surface: ThemeSurface;
  libraryId: string;
  theme: LibraryTheme;
  /** Only this slide, or the whole song when null. */
  onlySlideId: string | null;
  // Bumped on every dispatch, so the same theme applied twice is two requests.
  nonce: number;
}

interface ThemesModalState {
  isOpen: boolean;
  /** Each surface publishes its song while it is in front, and clears it when not. */
  targets: Partial<Record<ThemeSurface, ThemeTarget>>;
  pending: ThemeApplication | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setTarget: (surface: ThemeSurface, target: ThemeTarget | null) => void;
  dispatchApply: (request: Omit<ThemeApplication, "nonce">) => void;
  consumePending: (nonce: number) => void;
}

let requests = 0;

// The Themes panel's state, outside the views so any of them (the header
// button, the View menu) can open it, and so the panel can apply a theme to
// whichever view is in front without holding its song itself.
export const useThemesModalStore = create<ThemesModalState>()((set) => ({
  isOpen: false,
  targets: {},
  pending: null,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  setTarget: (surface, target) =>
    set((state) => {
      if (!target && !state.targets[surface]) return state;
      const targets = { ...state.targets };
      if (target) targets[surface] = target;
      else delete targets[surface];
      return { targets };
    }),
  dispatchApply: (request) => set({ pending: { ...request, nonce: ++requests } }),
  consumePending: (nonce) =>
    set((state) => (state.pending?.nonce === nonce ? { pending: null } : state)),
}));

/** The song the panel applies to: the editor's while it is open, else Show's. */
export const selectThemeTarget = (state: ThemesModalState): ThemeTarget | null =>
  state.targets.editor ?? state.targets.show ?? null;
