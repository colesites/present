export type DashboardSection =
  | "dashboard"
  | "services"
  | "library"
  | "bible"
  | "members"
  | "billing"
  | "accounts"
  | "settings";

export interface DashboardLibrarySlide {
  id?: string;
  text: string;
  label?: string;
  labelColor?: string;
  modifier?: string;
  sectionRepeat?: string;
  elements?: unknown[];
  backgroundId?: string;
  backgroundColor?: string;
  useBackgroundColor?: boolean;
}

export interface DashboardLibraryItem {
  _id: string;
  title: string;
  body?: string;
  categoryId?: string;
  updatedAt?: number;
  createdAt?: number;
  _creationTime: number;
  slides: DashboardLibrarySlide[];
  content?: {
    presentation?: { artist?: string; author?: string; canvasSize?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
}

export interface DashboardOrganization {
  id: string;
  name: string;
  logo?: string;
}

export interface DashboardOrganizationListItem {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  createdAt?: number;
}

export type ServiceItemType = "library" | "media" | "scripture" | "presentation" | "group";

export interface ServiceEntry {
  type: ServiceItemType;
  refId: string;
  label?: string;
  labelIsCustom?: boolean;
  groupId?: string | null;
  presentation?: { title?: string; sourceType?: string };
  addedAt: number;
}

export interface ServiceGroupEntry {
  id: string;
  name: string;
  order: number;
}

export type ServiceLayoutEntry = { type: "group"; id: string } | { type: "item"; key: string };

export interface DashboardServiceItem {
  _id: string;
  _creationTime: number;
  name: string;
  /** As the desktop app writes it: an ISO date, "YYYY-MM-DD". */
  date?: string;
  order?: number;
  archivedAt?: number;
  items: ServiceEntry[];
  groups?: ServiceGroupEntry[];
  layout?: ServiceLayoutEntry[];
  createdAt: number;
}


export function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "P";
}
