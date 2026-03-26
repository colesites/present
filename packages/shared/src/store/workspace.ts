import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type WorkspaceType = "personal" | "organization";

export interface WorkspaceState {
  type: WorkspaceType;
  id: string | null;
  setWorkspace: (type: WorkspaceType, id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      type: "personal",
      id: null as string | null,
      setWorkspace: (type, id) => set({ type, id }),
    }),
    {
      name: "present-workspace-storage",
      storage: createJSONStorage(() => {
        if (typeof window !== "undefined") {
          return window.localStorage;
        }
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
      }),
    }
  )
);
