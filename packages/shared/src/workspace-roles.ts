/**
 * What someone does in a workspace, and what they may change in it.
 *
 * Two separate things. The role is what they do on a Sunday: the setup page
 * asks for it, and the Members page shows it. Admin access is permission:
 * inviting people, removing them, changing roles. An Administrator has it
 * by default, and anyone else can be given it.
 */

export const WORKSPACE_ROLES = [
  { value: "member", label: "Member" },
  { value: "tech-director", label: "Tech Director" },
  { value: "pastor", label: "Pastor" },
  { value: "worship-leader", label: "Worship Leader" },
  { value: "volunteer", label: "Volunteer" },
  { value: "admin", label: "Administrator" },
  { value: "other", label: "Other" },
] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]["value"];

/** Permission in a workspace, as `userProfiles.role` stores it. */
export type WorkspaceAccess = "admin" | "user";

export const isWorkspaceRole = (value: unknown): value is WorkspaceRole =>
  WORKSPACE_ROLES.some((role) => role.value === value);

/** A stored role as one of the known ones; anything else is a Member. */
export const normalizeWorkspaceRole = (value: unknown): WorkspaceRole =>
  isWorkspaceRole(value) ? value : "member";

export const workspaceRoleLabel = (value: unknown): string =>
  WORKSPACE_ROLES.find((role) => role.value === value)?.label ?? "Member";

/** The access a role starts with, before anyone changes it. */
export const defaultAccessFor = (role: WorkspaceRole): WorkspaceAccess =>
  role === "admin" ? "admin" : "user";

/** What kind of organization a workspace is, as the setup page asks. */
export const WORKSPACE_TYPES = [
  { value: "church", label: "Church" },
  { value: "event", label: "Conference or event" },
  { value: "school", label: "School" },
  { value: "business", label: "Business" },
  { value: "nonprofit", label: "Non-profit" },
  { value: "other", label: "Other" },
] as const;

export const workspaceTypeLabel = (value: unknown): string =>
  WORKSPACE_TYPES.find((type) => type.value === value)?.label ?? "Other";
