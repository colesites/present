import type { CanvasSizePreset, SlideElement } from "./index";

export type VideoSettings = {
  loop: boolean;
  muted: boolean;
};

export type ScriptureTextAlign = "left" | "center" | "right";
export type ScriptureVerticalAlign = "top" | "middle" | "bottom";
export type ScriptureFooterPosition = "top" | "bottom";

export type LibraryStyle = {
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
};

export type ScriptureStyle = {
  fontSize: number;
  footerFontSize: number;
  fontFamily: string;
  fontWeight: string;
  textAlign: ScriptureTextAlign;
  verticalAlign: ScriptureVerticalAlign;
  footerAlign: ScriptureTextAlign;
  footerPosition: ScriptureFooterPosition;
};

// State matching what useOutputBroadcast sends
export type OutputState = {
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  mediaId: string | null;
  showText: boolean;
  showMedia: boolean;
  videoSettings: VideoSettings;
  mediaFilterCSS: string;
  isVideoPlaying: boolean;
  videoCurrentTime: number;
  shouldSyncTime: boolean;

  // Text details
  activeSlideId: string | null;
  slideText: string | null;
  slideFooter: string | null;
  slideElements?: SlideElement[] | null;
  slideCanvasSize?: CanvasSizePreset | null;
  slideBackgroundColor?: string | null;
  timerLabel?: string | null;
  timerText?: string | null;
  timerRunning?: boolean;
  timerVisible?: boolean;

  scriptureStyle: ScriptureStyle;
  libraryStyle: LibraryStyle;
  timerLayout?: {
    xPercent: number;
    yPercent: number;
    clockFontPx: number;
    nameFontPx: number;
    clockColor: string;
    nameColor: string;
    nameBannerEnabled: boolean;
    nameBannerColor: string;
    titlePosition: "top" | "bottom";
  };
};
