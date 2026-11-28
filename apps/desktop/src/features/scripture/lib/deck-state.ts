"use client";

import { create } from "zustand";
import type { ScriptureSlide } from "./slides";

interface ScriptureDeckState {
  /** The verse slides up now, as the operator window has them. */
  slides: ScriptureSlide[];
  /** Put one of them live. */
  select: ((slide: ScriptureSlide) => void) | null;
  setDeck: (slides: ScriptureSlide[], select: (slide: ScriptureSlide) => void) => void;
}

/**
 * The verses up now, for the Bible tab: which of them are split over several
 * slides (`splitScriptureSlide`), so their parts can be seen and chosen there.
 */
export const useScriptureDeckStore = create<ScriptureDeckState>()((set) => ({
  slides: [],
  select: null,
  setDeck: (slides, select) => set({ slides, select }),
}));

/** The slides of the verse `pk` in `slides`: its parts, when it is split. */
export function partsOfVerse(slides: ScriptureSlide[], pk: string): ScriptureSlide[] {
  const id = `scripture:${pk}`;
  return slides.filter((slide) => slide.id === id || slide.id?.startsWith(`${id}~`));
}
