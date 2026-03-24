export type DashboardSection =
  | "dashboard"
  | "services"
  | "library"
  | "bible"
  | "accounts"
  | "settings";

export interface DashboardSong {
  _id: string;
  title: string;
  categoryId?: string;
  updatedAt?: number;
  _creationTime: number;
  slides: Array<{ text: string }>;
}

export interface DashboardOrganization {
  name: string;
  logo?: string;
}

export interface DashboardOrganizationListItem {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  createdAt?: string | Date;
}

export interface DashboardClientProps {
  org: DashboardOrganization | null;
  songs: DashboardSong[];
  shouldAutoOpen: boolean;
  section: DashboardSection;
}

export function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "P";
}
