import type {
  CanvasSizePreset,
  MessageOverlay,
  SlideElement,
} from "./index";
import type { ScreenComposerLayout } from "./screen-composer";

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

export type OutputTextPosition = {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  textAlign: ScriptureTextAlign;
  verticalAlign: ScriptureVerticalAlign;
};

/** A box on a screen, as percentages of it: its centre, and its size. */
export type LayerBox = {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
};

/**
 * Where a screen's column of the live look puts its layers (Looks). Rust
 * adds it to the scene for each screen it is drawn for (`ScreenLayout` in
 * `services/output.rs`); the operator never sends it.
 */
export type ScreenLayout = {
  /** Where the words go; none for where the slide puts them. */
  wordsBox: LayerBox | null;
  /** A designed slide's words laid out afresh in their box, rather than the slide scaled into it. */
  wordsTextOnly: boolean;
  /** The words' size, as a share of what the slide asks for. */
  wordsScale: number;
  /** Behind the words' box. */
  wordsBackdrop: string | null;
  mediaBox: LayerBox;
  /** The media fills its box, cropped, rather than fitting inside it. */
  mediaFill: boolean;
  /** The props, as on the whole screen, scaled evenly into this box. */
  propsBox: LayerBox;
};

// State matching what useOutputBroadcast sends
export type OutputState = {
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  mediaId: string | null;
  showText: boolean;
  showMedia: boolean;
  hideBackground: boolean;
  textPosition?: OutputTextPosition | null;
  videoSettings: VideoSettings;
  mediaFilterCSS: string;
  isVideoPlaying: boolean;
  videoCurrentTime: number;
  /** When the operator's video was at `videoCurrentTime`, epoch ms. */
  videoTimeSampledAtMs?: number | null;
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
  /** Once the live timer has run out: the message's colour, and whether it blinks. */
  timerTimeUp?: { color: string; blink: boolean } | null;

  scriptureStyle: ScriptureStyle;
  libraryStyle: LibraryStyle;
  timerLayout?: {
    xPercent: number;
    yPercent: number;
    clockFontPx: number;
    nameFontPx: number;
    nameBannerHeightPx: number;
    clockColor: string;
    nameColor: string;
    nameBannerEnabled: boolean;
    nameBannerColor: string;
    titlePosition: "top" | "bottom";
    /** Behind the clock, or "" for nothing. */
    boxColor?: string;
  };
  screenComposerEnabled?: boolean;
  screenComposerLayout?: ScreenComposerLayout | null;
  messageOverlay?: MessageOverlay | null;
  propsOverlay?: PropsOverlayItem[] | null;
  screenLayout?: ScreenLayout | null;
};

// One visible prop currently overlaid on the audience output. Renderer
// supports media and text kinds positioned via preset slots.
export type PropsOverlayItem = {
  id: string;
  kind: "image" | "text" | "video" | "youtube" | "ndi" | "capture";
  mediaId?: string;
  imageUrl?: string;
  mediaUrl?: string;
  youtubeUrl?: string;
  ndiSourceName?: string;
  captureDeviceId?: string;
  captureDeviceLabel?: string;
  shownAtMs?: number;
  text?: string;
  position:
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "center"
    | "full";
  opacity: number;
  sizePercent: number;
  color?: string;
  fontSize?: number;
};
