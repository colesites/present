"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useConvexAuth } from "convex/react";
import { useClerk, useUser } from "@clerk/nextjs";
import { api } from "../../../../../packages/backend/convex/_generated/api";
import { usePathname, useRouter } from "next/navigation";
import { useWorkspaceStore } from "../../../../../packages/shared/src/store/workspace";
import { DashboardSidebar } from "./components/DashboardSidebar";
import { DashboardFrame } from "./components/DashboardFrame";
import { DashboardOverview } from "./components/DashboardOverview";
import { MembersSection } from "./components/MembersSection";
import { ServicesSection } from "./components/ServicesSection";
import { LibrarySection } from "./components/LibrarySection";
import { BibleSection } from "./components/BibleSection";
import { BillingSection } from "./components/BillingSection";
import { AccountSection } from "./components/AccountSection";
import { SettingsSection } from "./components/SettingsSection";
import {
  DashboardClientProps,
  DashboardLibraryItem,
  DashboardOrganization,
  DashboardOrganizationListItem,
  DashboardServiceItem,
} from "./types";

export function DashboardClient({
  org,
  libraryItems,
  shouldAutoOpen,
  section,
}: DashboardClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useClerk();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { user, isLoaded: isUserLoaded } = useUser();

  const {
    id: activeWorkspaceId,
    setWorkspace,
  } = useWorkspaceStore();

  const libraryData = useQuery(
    api.libraries.list,
    isAuthenticated && activeWorkspaceId
      ? { workspaceId: activeWorkspaceId }
      : "skip"
  ) as DashboardLibraryItem[] | undefined;

  const activeLibraryData = libraryData ?? libraryItems;
  // Still arriving, as opposed to empty: the pages show skeletons meanwhile.
  const isLoadingWorkspaceData = !isAuthenticated || !activeWorkspaceId;
  const libraryLoaded = !isLoadingWorkspaceData && libraryData !== undefined;

  const servicesData = useQuery(
    api.services.list,
    isAuthenticated && activeWorkspaceId
      ? { workspaceId: activeWorkspaceId }
      : "skip"
  ) as DashboardServiceItem[] | undefined;

  const [currentOrg, setCurrentOrg] = useState<DashboardOrganization | null>(
    org
  );
  const [organizations, setOrganizations] = useState<
    DashboardOrganizationListItem[]
  >([]);
  const [isAccountSwitcherOpen, setIsAccountSwitcherOpen] = useState(false);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const nativeOrganizations = useQuery(
    api.users.listMyOrganizations,
    isAuthenticated ? {} : "skip"
  );

  useEffect(() => {
    if (nativeOrganizations) {
      const list: DashboardOrganizationListItem[] = (
        nativeOrganizations as Array<{
          id: string;
          name: string;
          slug: string;
          logo?: string | null;
          role: string;
          createdAt: number;
        }>
      ).map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: org.logo ?? undefined,
        createdAt: new Date(org.createdAt),
      }));

      setOrganizations(list);

      if (!activeWorkspaceId && list[0]?.id) {
        setWorkspace("organization", list[0].id);
      }

      if (
        activeWorkspaceId &&
        !list.some((workspaceOrganization) => workspaceOrganization.id === activeWorkspaceId)
      ) {
        const fallbackOrganizationId = list[0]?.id ?? null;
        if (fallbackOrganizationId) {
          setWorkspace("organization", fallbackOrganizationId);
        }
      }

      const selectedOrg = list.find((workspaceOrganization) => workspaceOrganization.id === activeWorkspaceId) ??
          list[0] ??
          null;
      
      setCurrentOrg(selectedOrg);
    }
  }, [
    nativeOrganizations,
    activeWorkspaceId,
    setWorkspace,
  ]);

  useEffect(() => {
    setCurrentOrg(org);
  }, [org]);

  const sortedLibrary = useMemo(
    () =>
      [...(activeLibraryData ?? [])].sort(
        (a, b) =>
          (b.updatedAt ?? b._creationTime) - (a.updatedAt ?? a._creationTime)
      ),
    [activeLibraryData]
  );

  useEffect(() => {
    if (!isUserLoaded || isLoading) {
      return;
    }

    if (!user) {
      router.replace("/sign-in");
    }
  }, [isLoading, isUserLoaded, router, user]);

  useEffect(() => {
    if (
      !isAuthenticated ||
      isLoading ||
      typeof nativeOrganizations === "undefined"
    ) {
      return;
    }
    if (nativeOrganizations.length > 0) {
      return;
    }
    if (pathname.startsWith("/dashboard/organization/setup")) {
      return;
    }
    router.replace("/dashboard/organization/setup");
  }, [isAuthenticated, isLoading, nativeOrganizations, pathname, router]);

  const openDesktopApp = useCallback(async () => {
    window.location.href = "present://open";
  }, []);

  const handleSwitchContext = useCallback(
    (id: string) => {
      setIsSwitchingWorkspace(true);
      setWorkspace("organization", id);
      setIsAccountSwitcherOpen(false);
      window.setTimeout(() => {
        setIsSwitchingWorkspace(false);
      }, 200);
    },
    [setWorkspace]
  );

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await signOut({ redirectUrl: "/sign-in" });
    } finally {
      setIsSigningOut(false);
    }
  }, [signOut]);

  useEffect(() => {
    if (!shouldAutoOpen) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void openDesktopApp();
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [openDesktopApp, shouldAutoOpen]);

  if (!isUserLoaded || isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#111111] p-4 text-white">
        <div className="rounded-full bg-white/[0.06] px-5 py-3 text-sm text-white/70">Verifying session…</div>
      </div>
    );
  }

  const sidebar = (onNavigate?: () => void) => (
    <DashboardSidebar
      currentSection={section}
      currentOrganization={currentOrg}
      organizations={organizations}
      activeWorkspaceId={activeWorkspaceId}
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
      onSignOut={() => {
        void handleSignOut();
      }}
      onNavigate={onNavigate}
    />
  );

  const isLoadingOrganizations = nativeOrganizations === undefined;
  const page = (() => {
    switch (section) {
      case "dashboard":
        return (
          <DashboardOverview
            currentOrg={currentOrg}
            organizationsCount={organizations.length}
            libraryItems={libraryLoaded ? sortedLibrary : undefined}
            services={servicesData}
            shouldAutoOpen={shouldAutoOpen}
            onOpenDesktopApp={() => {
              void openDesktopApp();
            }}
          />
        );
      case "services":
        return <ServicesSection currentOrg={currentOrg} services={servicesData} />;
      case "library":
        return (
          <LibrarySection
            currentOrg={currentOrg}
            libraryItems={libraryLoaded ? sortedLibrary : undefined}
          />
        );
      case "bible":
        return <BibleSection />;
      case "members":
        return <MembersSection currentOrg={currentOrg} isLoading={isLoadingOrganizations} />;
      case "billing":
        return <BillingSection />;
      case "accounts":
        return (
          <AccountSection
            organizations={organizations}
            onSignOut={() => {
              void handleSignOut();
            }}
            isSigningOut={isSigningOut}
          />
        );
      case "settings":
        return <SettingsSection currentOrg={currentOrg} isLoading={isLoadingOrganizations} />;
    }
  })();

  return (
    <DashboardFrame section={section} currentOrg={currentOrg} sidebar={sidebar}>
      {page}
    </DashboardFrame>
  );
}
