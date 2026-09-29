"use client";

import { create } from "zustand";
import type { MediaFolder, MediaItem } from "../../../features/media/hooks/useMediaFolders";

/**
 * The media library this computer has, for what draws a slide's image or
 * video background away from the media panel: the slide grid, the editor
 * and the theme designer. `App` keeps it current from `useMediaFolders`, the
 * one place the folders are read.
 */
export const useMediaLibraryStore = create<{
  items: MediaItem[];
  /** In the order they were added, as the Media panel lists them. */
  folders: MediaFolder[];
  setItems: (items: MediaItem[]) => void;
  setFolders: (folders: MediaFolder[]) => void;
}>()((set) => ({
  items: [],
  folders: [],
  setItems: (items) => set({ items }),
  setFolders: (folders) => set({ folders }),
}));
