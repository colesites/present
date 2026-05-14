import { create } from "zustand";
import type { LibraryItem, Service } from "../../../shared/types";

/**
 * Lightweight store that PresentContainer populates with its data
 * so the AppHeader global search can read it without prop drilling.
 */
interface GlobalSearchStore {
  services: Service[];
  libraryItems: LibraryItem[];
  setServices: (services: Service[]) => void;
  setLibraryItems: (items: LibraryItem[]) => void;

  onSelectService?: (serviceId: string) => void;
  onSelectLibraryItem?: (libraryId: string) => void;
  onSelectScripture?: (reference: string) => void;
  setActions: (actions: {
    onSelectService?: (serviceId: string) => void;
    onSelectLibraryItem?: (libraryId: string) => void;
    onSelectScripture?: (reference: string) => void;
  }) => void;
}

export const useGlobalSearchStore = create<GlobalSearchStore>((set) => ({
  services: [],
  libraryItems: [],
  setServices: (services) => set({ services }),
  setLibraryItems: (items) => set({ libraryItems: items }),
  setActions: (actions) => set(actions),
}));
