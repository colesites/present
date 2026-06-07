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
  capitalization?:
  | "none"
  | "allCaps"
  | "titleCase"
  | "lineStart"
  | "uppercase"
  | "lowercase"
  | "capitalize";
};

export type SlideTextRun = {
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  color?: string;
  underline?: boolean;
  letterSpacing?: number;
};

export type SlideTextParagraph = {
  alignment?: "left" | "center" | "right" | "justify";
  lineHeight?: number;
  spaceBefore?: number;
  spaceAfter?: number;
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
};

export type LibraryContent = {
  presentation?: LibraryPresentationSettings;
  slideLabelOptions?: string[];
  composition?: {
    sourceItems: LibraryCompositionSource[];
    createdAt: number;
  };
  editorView?: "slides" | "source";
};

export type LibraryItemDraft = {
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

export type ServiceItemType =
  | "library"
  | "media"
  | "scripture"
  | "presentation";

export interface ServiceItem {
  type: ServiceItemType;
  refId: string;
  label?: string;
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
  items: Array<{
    type: ServiceItemType;
    refId: string;
    label?: string;
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
