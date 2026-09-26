"use client";

import { create } from "zustand";
import type { MediaItem } from "../../../features/media/hooks/useMediaFolders";

/**
 * The media library this computer has, for what draws a slide's image or
 * video background away from the media panel: the slide grid, the editor
 * and the theme designer. `App` keeps it current from `useMediaFolders`, the
 * one place the folders are read.
 */
export const useMediaLibraryStore = create<{
  items: MediaItem[];
  setItems: (items: MediaItem[]) => void;
}>()((set) => ({
  items: [],
  setItems: (items) => set({ items }),
}));
