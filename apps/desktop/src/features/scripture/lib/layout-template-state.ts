"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CanvasSizePreset, SlideElement } from "../../../shared/types";

export interface ScriptureLayoutTemplate {
  elements: SlideElement[];
  canvasSize: CanvasSizePreset;
  backgroundColor: string | null;
  useBackgroundColor: boolean;
}

interface ScriptureLayoutTemplateState {
  template: ScriptureLayoutTemplate | null;
  setTemplate: (template: ScriptureLayoutTemplate | null) => void;
  resetTemplate: () => void;
}

export const useScriptureLayoutTemplateStore =
  create<ScriptureLayoutTemplateState>()(
    persist<ScriptureLayoutTemplateState>(
      (set) => ({
        template: null as ScriptureLayoutTemplate | null,
        setTemplate: (template: ScriptureLayoutTemplate | null) => set({ template }),
        resetTemplate: () => set({ template: null as ScriptureLayoutTemplate | null }),
      }),
      {
        name: "present-scripture-layout-template",
      },
    ),
  );
