import type { Id } from "@present/backend/convex/_generated/dataModel";

export type SlideRef = {
  libraryId: string;
  index: number;
};

export type ViewMode = "show" | "edit" | "stage" | "settings" | "browser";
export type BottomTab = "shows" | "media" | "scripture";
export type ContentSource = "my-creations" | "community";

// The right-side tabbed rail (Audio / Text / Timer / Messages / Layers /
// Masters). Distinct from `BottomTab` which is a legacy concept for the
// center-area content (libraries vs media grid vs scripture).
//
// Note: the [M] tab is "Masters" (slide templates the operator can drop in
// instantly — Blank Stream, Main Worship, Pre-Service, etc.), NOT the
// photo/video media panel. Photo/video media keeps its own home in the
// main-area bottom row.
export type SidebarTab =
  | "audio"
  | "text"
  | "timer"
  | "messages"
  | "layers"
  | "masters";

export const SIDEBAR_TABS: readonly SidebarTab[] = [
  "audio",
  "text",
  "timer",
  "messages",
  "layers",
  "masters",
] as const;

// Banner message that appears on the audience output as a top/bottom strip.
export type MessageOverlayPosition = "top" | "bottom";
export type MessageOverlayDismiss = "manual" | "after-10s" | "after-30s";
export type MessageOverlayAnimation =
  | "static"
  | "marquee-left"
  | "marquee-right";

export type MessageOverlay = {
  id: string;
  text: string; // Already token-substituted by the time it reaches output.
  position: MessageOverlayPosition;
  themeKey: string;
  shownAtMs: number;
  dismissMode: MessageOverlayDismiss;
  animation: MessageOverlayAnimation;
  // Seconds for one full marquee pass. Ignored when animation === "static".
  speedSeconds: number;
  // Font-size multiplier applied to the overlay text on both the preview and
  // the main output (1 = default). Lets operators make messages bigger.
  fontScale: number;
};

export type SavedMessage = {
  _id: Id<"messages"> | Id<"personalMessages"> | string;
  _creationTime: number;
  orgId?: Id<"organizations"> | string;
  userId?: string;
  title: string;
  body: string;
  themeKey: string;
  position: MessageOverlayPosition;
  dismissMode: MessageOverlayDismiss;
  allowWebNotifications: boolean;
  animation?: MessageOverlayAnimation;
  speedSeconds?: number;
  fontScale?: number;
  order: number;
  createdAt: number;
  updatedAt: number;
  version: number;
  deleted: boolean;
};

export type RenameTarget = {
  type: "service" | "category" | "library";
  id: string;
  name: string;
} | null;

export type DeleteTarget = {
  type: "service" | "category" | "library";
  id: string;
  name: string;
} | null;

export type SlideElementType = "text" | "shape" | "image" | "video" | "web";

export type SlideElementStyle = {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fontBold?: boolean;
  fontUnderline?: boolean;
  fontStyle?: string;
  textDecoration?: string;
  color?: string;
  textAlign?: "left" | "center" | "right" | "justify";
  verticalAlign?: "top" | "middle" | "bottom";
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  opacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  shadow?: string;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  textFillMode?: "solid" | "gradient";
  gradientFromColor?: string;
  gradientToColor?: string;
  gradientAngle?: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  objectFit?: "cover" | "contain" | "fill";
  /** Extra space between letters, in canvas pixels. */
  letterSpacing?: number;
  /** Line height as a multiple of the font size; 1.2 when unset. */
  lineHeight?: number;
  /** A shape's paint: a colour, gradient or mix. Wins over `backgroundColor`. */
  fill?: SlidePaint;
  /** The line along a shape's `geometry` paths, in canvas pixels. */
  line?: SlideLine;
  /** How much of a picture is cut from each side, as fractions of it. */
  crop?: { left: number; top: number; right: number; bottom: number };
  capitalization?:
  | "none"
  | "allCaps"
  | "titleCase"
  | "lineStart"
  | "uppercase"
  | "lowercase"
  | "capitalize";
};

/**
 * How a shape is painted. A gradient runs across the shape at `angle`
 * degrees (0 left to right, 90 top to bottom) as CSS draws one; a mix is a
 * base colour with soft spots of colour, each at `x`, `y` (fractions of the
 * shape) fading out at `size` times its longer side. The compositor reads the
 * same (`compositor/fill.rs`).
 */
export type SlideFill =
  | { kind: "color"; color: string }
  | { kind: "gradient"; from: string; to: string; angle: number }
  | {
      kind: "mix";
      base: string;
      spots: Array<{ color: string; x: number; y: number; size: number }>;
    };

/**
 * An imported shape's gradient, with as many stops as its deck gave it:
 * `linear` along the same line as `gradient`, `radial` from `cx`, `cy`
 * (fractions of the shape) out to its farthest corner. Drawn, not edited:
 * the editors offer the fills above.
 */
export type SlideStopsFill =
  | { kind: "linear"; angle: number; stops: SlideGradientStop[] }
  | { kind: "radial"; cx: number; cy: number; stops: SlideGradientStop[] };

/** Whatever a shape is painted with. */
export type SlidePaint = SlideFill | SlideStopsFill;

export type SlideGradientStop = { offset: number; color: string };

/** A shape's outline: a dash pattern and the ends and joins of its lines. */
export type SlideLine = {
  color: string;
  width: number;
  dash?: number[];
  cap?: "butt" | "round" | "square";
  join?: "miter" | "round" | "bevel";
};

/**
 * A shape's outline as paths: SVG path data (absolute `M L C Q Z`) in the
 * element's own canvas pixels from its top-left. What an imported PowerPoint
 * shape is drawn with; without it a shape is its (rounded) rectangle.
 */
export type SlideGeometry = {
  paths: Array<{ d: string; fill?: boolean; stroke?: boolean }>;
};

export type SlideTextRun = {
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  color?: string;
  underline?: boolean;
  strike?: boolean;
  letterSpacing?: number;
  /** A colour behind the words. */
  highlight?: string;
};

export type SlideTextParagraph = {
  alignment?: "left" | "center" | "right" | "justify";
  /** A multiple of the size up to 4; above that, pixels. */
  lineHeight?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  /** Where wrapped lines start, from the box's inset, in canvas pixels. */
  marginLeft?: number;
  /** The first line's start from the margin; negative hangs a bullet. */
  indent?: number;
  level?: number;
  bullet?: { text: string; fontFamily?: string; color?: string; fontSize?: number };
  runs: SlideTextRun[];
};

export type SlideTextBody = {
  insetLeft?: number;
  insetRight?: number;
  insetTop?: number;
  insetBottom?: number;
  verticalAlign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  autoFit?: string;
  paragraphs: SlideTextParagraph[];
};

export type SlideElement = {
  id: string;
  type: SlideElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string; // Text string or Image URL
  richTextHtml?: string;
  textBody?: SlideTextBody;
  isPlaceholder?: boolean;
  contentRole?: "scriptureVerse" | "scriptureFooter";
  style?: SlideElementStyle;
  geometry?: SlideGeometry;
  isLocked?: boolean;
  isVisible?: boolean;
};

export type CanvasSizePreset =
  | "1920x1080"
  | "1280x720"
  | "1024x768"
  | "800x600";

export type LibrarySlide = {
  id?: string;
  text: string; // Main text / legacy fallback
  elements?: SlideElement[];
  label?: string;
  labelColor?: string;
  modifier?: string;
  sectionRepeat?: string;
  backgroundId?: string;
  backgroundColor?: string;
  useBackgroundColor?: boolean;
};

export type LibraryPresentationSettings = {
  artist?: string;
  author?: string;
  canvasSize?: CanvasSizePreset;
  backgroundColor?: string;
  useBackgroundColor?: boolean;
};

export type LibraryCompositionSource = {
  libraryId: string;
  title: string;
  slideCount: number;
  slideIndexes?: number[];
};

export type LibraryContent = {
  presentation?: LibraryPresentationSettings;
  slideLabelOptions?: string[];
  composition?: {
    sourceItems: LibraryCompositionSource[];
    createdAt: number;
  };
  editorView?: "slides" | "source";
  /**
   * The theme last applied to the whole song, so slides rebuilt from its
   * lyrics get it again. `look` is `features/themes/theme-look.mjs`'s.
   */
  theme?: LibraryTheme;
};

export type LibraryTheme = {
  id: string;
  name: string;
  look: unknown;
};

export type LibraryItemDraft = {
  _id?: Id<"libraries"> | string;
  title: string;
  body: string;
  slides: LibrarySlide[];
  content?: LibraryContent;
};

export type LibraryItem = {
  _id: Id<"libraries"> | string;
  _creationTime: number;
  orgId: Id<"organizations"> | string;
  userId?: string;
  categoryId?: Id<"categories"> | string;
  type?: "song" | "scripture" | "slide" | "note";
  content?: LibraryContent;
  title: string;
  body: string;
  slides: LibrarySlide[];
  createdAt: number;
  updatedAt: number;
  version: number;
  deleted: boolean;
};

export type ServicePresentation = {
  title: string;
  sourceType: "pdf" | "pptx";
  slides: LibrarySlide[];
  content?: LibraryContent;
};

export type ServiceGroup = {
  id: string;
  name: string;
  order: number;
};

export type ServiceLayoutEntry =
  | { type: "group"; id: string }
  | { type: "item"; key: string };

export type ServiceItemType =
  | "library"
  | "media"
  | "scripture"
  | "presentation"
  // Legacy: older local data used service items as divider rows.
  | "group";

export interface ServiceItem {
  type: ServiceItemType;
  refId: string;
  label?: string;
  /** Whether label is an operator-defined service-only name rather than a library title. */
  labelIsCustom?: boolean;
  groupId?: string | null;
  addedAt: number;
  presentation?: ServicePresentation | null;
  libraryItem: LibraryItem | null;
  index: number;
}

export type Service = {
  _id: Id<"services">;
  _creationTime: number;
  orgId: Id<"organizations"> | string;
  name: string;
  date?: string;
  /**
   * When the service was archived, absent while it is in use.
   *
   * Archiving is not deletion: last year's Carol Service stays, with
   * everything in it, and simply leaves this Sunday's list.
   */
  archivedAt?: number;
  groups?: ServiceGroup[];
  layout?: ServiceLayoutEntry[];
  items: Array<{
    type: ServiceItemType;
    refId: string;
    label?: string;
    labelIsCustom?: boolean;
    groupId?: string | null;
    addedAt: number;
    presentation?: ServicePresentation;
  }>;
  createdAt: number;
  updatedAt: number;
  version: number;
  deleted: boolean;
};

export type Category = {
  _id: Id<"categories">;
  _creationTime: number;
  orgId: Id<"organizations">;
  name: string;
  isDefault: boolean;
  order: number;
  createdAt: number;
};

export type PlaybackState = {
  _id: Id<"playbackState">;
  _creationTime: number;
  orgId: Id<"organizations">;
  activeSlideId?: string;
  activeBackgroundId?: string;
  isBlackedOut: boolean;
  fontFamily?: string;
  fontSize?: number;
  fontBold?: boolean;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  updatedAt: number;
};

export type Organization = {
  _id: Id<"organizations">;
  _creationTime: number;
  name: string;
  createdAt: number;
};

// Slide label colors - includes background and text color for visibility
export const LABEL_COLORS: Record<string, string> = {
  verse: "bg-blue-600 text-white",
  chorus: "bg-primary text-primary-foreground",
  bridge: "bg-purple-600 text-white",
  intro: "bg-green-600 text-white",
  outro: "bg-orange-600 text-white",
  tag: "bg-yellow-500 text-black",
  "pre-chorus": "bg-cyan-600 text-white",
  opening: "bg-indigo-600 text-white",
  closing: "bg-rose-600 text-white",
  praise: "bg-violet-600 text-white",
  worship: "bg-fuchsia-600 text-white",
  default: "bg-secondary text-secondary-foreground",
};

export function getLabelColor(label?: string): string {
  if (!label) return LABEL_COLORS.default;
  const lower = label.toLowerCase();
  for (const key of Object.keys(LABEL_COLORS)) {
    if (lower.includes(key)) return LABEL_COLORS[key];
  }
  return LABEL_COLORS.default;
}
