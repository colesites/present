import type { CanvasSizePreset, SlideElement } from "./index";

export type ScreenComposerMode = "edit" | "live";

export type ScreenComposerPreset =
  | "single"
  | "split-vertical"
  | "split-horizontal"
  | "grid-3"
  | "grid-4";

export type ScreenComposerSource =
  | "video"
  | "camera-feed"
  | "countdown"
  | "slides";

export type ScreenComposerFitMode = "cover" | "contain" | "fill" | "scale-down";

export type ScreenComposerMediaType = "image" | "video";

export type ScreenComposerRegion = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  source: ScreenComposerSource;
  fitMode: ScreenComposerFitMode;
  backgroundColor: string;
  padding: number;
  borderRadius: number;
  textContent: string;
  footerText: string;
  mediaUrl: string | null;
  mediaType: ScreenComposerMediaType | null;
  mediaLabel: string | null;
  backgroundMediaUrl?: string | null;
  backgroundMediaType?: ScreenComposerMediaType | null;
  backgroundMediaLabel?: string | null;
  showTextLayer: boolean;
  showMediaLayer: boolean;
  slideId?: string | null;
  slideText?: string | null;
  slideFooter?: string | null;
  slideElements?: SlideElement[] | null;
  slideCanvasSize?: CanvasSizePreset | null;
  slideBackgroundColor?: string | null;
};

export type ScreenComposerLayout = {
  id: string;
  name: string;
  regions: ScreenComposerRegion[];
  allowOverlap: boolean;
  updatedAt: number;
};

export type ScreenComposerStore = {
  version: 2;
  enabled: boolean;
  mode: ScreenComposerMode;
  activeLayoutId: string;
  liveLayoutId: string;
  selectedRegionId: string | null;
  layouts: ScreenComposerLayout[];
  liveLayout: ScreenComposerLayout;
};
