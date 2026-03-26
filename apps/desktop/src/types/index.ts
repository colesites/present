import type { Id } from "@present/backend/convex/_generated/dataModel";

export type SlideRef = {
  libraryId: string;
  index: number;
};

export type ViewMode = "show" | "edit" | "stage" | "settings";
export type BottomTab = "shows" | "media" | "scripture";
export type ContentSource = "my-creations" | "community";

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

export type LibraryItem = {
  _id: any;
  _creationTime: number;
  orgId?: any;
  userId?: any;
  categoryId?: any;
  title: string;
  body: string;
  slides: Array<{
    text: string;
    label?: string;
    modifier?: string;
    backgroundId?: string;
  }>;
  createdAt: number;
  updatedAt?: number;
};

export type ServiceItemType = "library" | "media" | "scripture";

export interface ServiceItem {
  type: ServiceItemType;
  refId: string;
  label?: string;
  addedAt: number;
  libraryItem: LibraryItem | null;
  index: number;
}

export type Service = {
  _id: Id<"services">;
  _creationTime: number;
  orgId: Id<"organizations">;
  name: string;
  date?: string;
  items: Array<{
    type: ServiceItemType;
    refId: string;
    label?: string;
    addedAt: number;
  }>;
  createdAt: number;
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
