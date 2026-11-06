/**
 * The projection settings and what this computer can do for them
 * (`src-tauri/src/services/projection`).
 */

import { invoke } from "@tauri-apps/api/core";

export type ProjectionPreset =
  | "veryLow"
  | "low"
  | "medium"
  | "balanced"
  | "high"
  | "highest"
  | "custom";
export type ProjectionResolution =
  | "r720"
  | "r1080"
  | "r1440"
  | "r2160"
  | "native";
export type ProjectionFrameRate = "fps24" | "fps30" | "adaptive" | "fps60";
export type VideoQuality = "standard" | "high";
export type HardwareDecoding = "auto" | "enabled" | "disabled";
export type RenderingMode = "automatic" | "gpu" | "compatibility";
export type PowerMode = "performance" | "efficiency";

export type ProjectionSettings = {
  preset: ProjectionPreset;
  resolution: ProjectionResolution;
  frameRate: ProjectionFrameRate;
  videoQuality: VideoQuality;
  hardwareDecoding: HardwareDecoding;
  rendering: RenderingMode;
  power: PowerMode;
  autoAdjust: boolean;
};

/** The settings, and the resolution and frame rate in force after the
 * automatic adjustment. */
export type ProjectionStatus = {
  settings: ProjectionSettings;
  resolution: ProjectionResolution;
  frameRate: ProjectionFrameRate;
  adjustedBy: number;
};

export type ProjectionCapabilities = {
  gpus: Array<{
    name: string;
    lowPower: boolean;
    removable: boolean;
    memoryMb: number;
  }>;
  decoding: Array<{ codec: string; gpu: boolean }>;
  displays: Array<{
    width: number;
    height: number;
    refreshHz: number;
    builtIn: boolean;
  }>;
  layers: boolean;
};

export const getProjectionSettings = (): Promise<ProjectionStatus> =>
  invoke("get_projection_settings");

export const setProjectionSettings = (
  settings: ProjectionSettings,
): Promise<ProjectionStatus> => invoke("set_projection_settings", { settings });

export const getProjectionCapabilities = (): Promise<ProjectionCapabilities> =>
  invoke("get_projection_capabilities");
