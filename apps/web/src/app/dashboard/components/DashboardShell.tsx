"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useClerk, useUser } from "@clerk/nextjs";
import { usePathname, useRouter } from "next/navigation";
import { api } from "../../../../../../packages/backend/convex/_generated/api";
import { useWorkspaceStore } from "../../../../../../packages/shared/src/store/workspace";
import type {
  DashboardLibraryItem,
  DashboardOrganization,
  DashboardOrganizationListItem,
  DashboardSection,
  DashboardServiceItem,
} from "../types";
import { DashboardFrame } from "./DashboardFrame";
import { DashboardSidebar } from "./DashboardSidebar";
import { HelpPanel } from "../../../components/help/HelpCenter";

/**
 * The dashboard around every page: the navigation, the organization in use,
 * and the workspace's library and services.
 *
 * It lives in the dashboard's layout, so moving between pages keeps it, and
 * its subscriptions, instead of starting again and showing "No organization"
 * until the organizations arrive. Pages read what it holds with
 * `useDashboard()`.
 */

export type DashboardData = {
  currentOrg: DashboardOrganization | null;
  organizations: DashboardOrganizationListItem[];
  /** The organizations haven't arrived yet, so none is known. */
  isLoadingOrganizations: boolean;
  /** The workspace id Convex scopes the library and services by. */
  workspaceId: string | null;
  /** `undefined` while they load. */
  libraryItems: DashboardLibraryItem[] | undefined;
  services: DashboardServiceItem[] | undefined;
  openDesktopApp: () => void;
  signOut: () => void;
  isSigningOut: boolean;
};

export const DashboardContext = createContext<DashboardData | null>(null);

export const useDashboard = () => {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("useDashboard is only for pages inside the dashboard layout.");
  return value;
};

const SECTIONS: DashboardSection[] = ["services", "library", "bible", "members", "billing", "accounts", "settings"];

const sectionOf = (pathname: string): DashboardSection => {
  const segment = pathname.split("/")[2] as DashboardSection | undefined;
  return segment && SECTIONS.includes(segment) ? segment : "dashboard";
};

/** The organizations as last seen, so a reload shows them before Convex answers. */
const CACHE_KEY = "present-dashboard-organizations";

const readCachedOrganizations = (): DashboardOrganizationListItem[] => {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as DashboardOrganizationListItem[]) : [];
  } catch {
    return [];
  }
};

type NativeOrganization = { id: string; name: string; slug: string; logo?: string | null; role: string; createdAt: number };

export function DashboardShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const section = sectionOf(pathname);
  const { signOut } = useClerk();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  const { id: activeWorkspaceId, setWorkspace } = useWorkspaceStore();

  const [cached, setCached] = useState<DashboardOrganizationListItem[]>([]);
  const [isAccountSwitcherOpen, setIsAccountSwitcherOpen] = useState(false);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  useEffect(() => {
    setCached(readCachedOrganizations());
  }, []);

  const nativeOrganizations = useQuery(api.users.listMyOrganizations, isAuthenticated ? {} : "skip") as
    | NativeOrganization[]
    | undefined;

  const organizations = useMemo<DashboardOrganizationListItem[]>(
    () =>
      nativeOrganizations
        ? nativeOrganizations.map((org) => ({
            id: org.id,
            name: org.name,
            slug: org.slug,
            logo: org.logo ?? undefined,
            createdAt: org.createdAt,
          }))
        : cached,
    [cached, nativeOrganizations],
  );

  // Remember them for next time, and keep the workspace on one they're in.
  useEffect(() => {
    if (!nativeOrganizations) return;
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(organizations));
    } catch {
      // Full or blocked storage only costs the instant header next time.
    }
    const stillIn = organizations.some((org) => org.id === activeWorkspaceId);
    if (!stillIn && organizations[0]) setWorkspace("organization", organizations[0].id);
  }, [activeWorkspaceId, nativeOrganizations, organizations, setWorkspace]);

  const currentOrg = useMemo<DashboardOrganization | null>(() => {
    const org = organizations.find((each) => each.id === activeWorkspaceId) ?? organizations[0] ?? null;
    return org ? { id: org.id, name: org.name, logo: org.logo } : null;
  }, [activeWorkspaceId, organizations]);

  const workspaceId = currentOrg?.id ?? null;
  const libraryData = useQuery(api.libraries.list, isAuthenticated && workspaceId ? { workspaceId } : "skip") as
    | DashboardLibraryItem[]
    | undefined;
  const servicesData = useQuery(api.services.list, isAuthenticated && workspaceId ? { workspaceId } : "skip") as
    | DashboardServiceItem[]
    | undefined;

  const libraryItems = useMemo(
    () =>
      libraryData
        ? [...libraryData].sort((a, b) => (b.updatedAt ?? b._creationTime) - (a.updatedAt ?? a._creationTime))
        : undefined,
    [libraryData],
  );

  useEffect(() => {
    if (isUserLoaded && !isLoading && !user) router.replace("/sign-in?next=" + encodeURIComponent(pathname));
  }, [isLoading, isUserLoaded, pathname, router, user]);

  // Nobody belongs to no organization for long: they make one or join one.
  useEffect(() => {
    if (isAuthenticated && !isLoading && nativeOrganizations && nativeOrganizations.length === 0) {
      router.replace("/dashboard/organization/setup");
    }
  }, [isAuthenticated, isLoading, nativeOrganizations, router]);

  const openDesktopApp = useCallback(() => {
    window.location.href = "present://open";
  }, []);

  const handleSwitchContext = useCallback(
    (id: string) => {
      setIsSwitchingWorkspace(true);
      setWorkspace("organization", id);
      setIsAccountSwitcherOpen(false);
      window.setTimeout(() => setIsSwitchingWorkspace(false), 200);
    },
    [setWorkspace],
  );

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      window.localStorage.removeItem(CACHE_KEY);
    } catch {
      // Nothing to forget.
    }
    try {
      await signOut({ redirectUrl: "/sign-in" });
    } finally {
      setIsSigningOut(false);
    }
  }, [signOut]);

  const value = useMemo<DashboardData>(
    () => ({
      currentOrg,
      organizations,
      isLoadingOrganizations: nativeOrganizations === undefined && organizations.length === 0,
      workspaceId,
      libraryItems,
      services: servicesData,
      openDesktopApp,
      signOut: () => void handleSignOut(),
      isSigningOut,
    }),
    [currentOrg, handleSignOut, isSigningOut, libraryItems, nativeOrganizations, openDesktopApp, organizations, servicesData, workspaceId],
  );

  const sidebar = (onNavigate?: () => void) => (
    <DashboardSidebar
      currentSection={section}
      currentOrganization={currentOrg}
      isLoadingOrganization={value.isLoadingOrganizations}
      organizations={organizations}
      activeWorkspaceId={currentOrg?.id ?? null}
      isAccountSwitcherOpen={isAccountSwitcherOpen}
      isSwitchingWorkspace={isSwitchingWorkspace}
      isSigningOut={isSigningOut}
      onToggleAccountSwitcher={() => setIsAccountSwitcherOpen((open) => !open)}
      onCloseAccountSwitcher={() => setIsAccountSwitcherOpen(false)}
      onCreateOrganization={() => {
        setIsAccountSwitcherOpen(false);
        router.push("/dashboard/organization/setup");
      }}
      onSwitchContext={handleSwitchContext}
      onSignOut={() => void handleSignOut()}
      onNavigate={onNavigate}
      onOpenHelp={() => setIsHelpOpen(true)}
    />
  );

  return (
    <DashboardContext.Provider value={value}>
      <DashboardFrame
        section={section}
        currentOrg={currentOrg}
        isLoadingOrganization={value.isLoadingOrganizations}
        sidebar={sidebar}
      >
        {children}
      </DashboardFrame>
      <HelpPanel open={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </DashboardContext.Provider>
  );
}
