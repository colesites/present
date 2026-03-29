"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useConvexAuth } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { api } from "../../../../../packages/backend/convex/_generated/api";
import { useRouter } from "next/navigation";
import { useWorkspaceStore } from "../../../../../packages/shared/src/store/workspace";
import { DashboardSidebar } from "./components/DashboardSidebar";
import { DashboardOverview } from "./components/DashboardOverview";
import { DashboardSectionView } from "./components/DashboardSectionView";
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
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { user, isLoaded: isUserLoaded } = useUser();

  const {
    type: activeWorkspaceType,
    id: activeWorkspaceId,
    setWorkspace,
  } = useWorkspaceStore();

  const libraryData = useQuery(
    api.libraries.list,
    isAuthenticated ? { workspaceId: activeWorkspaceId ?? undefined } : "skip"
  ) as DashboardLibraryItem[] | undefined;

  const activeLibraryData = libraryData ?? libraryItems;

  const servicesData = useQuery(
    api.services.list,
    isAuthenticated ? { workspaceId: activeWorkspaceId ?? undefined } : "skip"
  ) as DashboardServiceItem[] | undefined;

  const [currentOrg, setCurrentOrg] = useState<DashboardOrganization | null>(
    org
  );
  const [organizations, setOrganizations] = useState<
    DashboardOrganizationListItem[]
  >([]);

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

      const activeOrg =
        activeWorkspaceType === "organization"
          ? (list.find((org) => org.id === activeWorkspaceId) ?? null)
          : null;

      setCurrentOrg(activeOrg);
    }
  }, [nativeOrganizations, activeWorkspaceType, activeWorkspaceId]);

  const viewerName =
    user?.fullName || user?.primaryEmailAddress?.emailAddress || "Your account";
  const viewerEmail = user?.primaryEmailAddress?.emailAddress || "";
  const viewerImage = user?.imageUrl || null;

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

  const openDesktopApp = useCallback(async () => {
    window.location.href = "present://open";
  }, []);

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
      <div className="fixed inset-0 box-border overflow-hidden bg-[#111111] px-6 py-8 text-white">
        <div className="flex h-full items-center justify-center rounded-[36px] bg-[#191919]">
          <div className="rounded-full bg-white/6 px-5 py-3 text-sm text-white/72">
            Verifying session...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 box-border overflow-hidden bg-[#111111] px-10 py-10">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1700px] items-stretch overflow-hidden">
        <div className="flex w-full min-h-0 items-stretch gap-14 overflow-hidden">
          <DashboardSidebar
            currentSection={section}
            viewerName={viewerName}
            viewerEmail={viewerEmail}
            viewerImage={viewerImage}
          />
          <main className="h-full max-h-full min-h-0 min-w-0 max-w-[1320px] flex-1 self-stretch overflow-y-auto overflow-x-hidden overscroll-contain rounded-[56px] border border-[#e8e8e8] bg-white shadow-[0_28px_76px_rgba(0,0,0,0.08)] [scrollbar-gutter:stable]">
            {section === "dashboard" ? (
              <DashboardOverview
                currentOrg={currentOrg}
                organizationsCount={organizations.length}
                libraryItems={sortedLibrary}
                servicesCount={servicesData?.length ?? 0}
                shouldAutoOpen={shouldAutoOpen}
                onOpenDesktopApp={() => {
                  void openDesktopApp();
                }}
              />
            ) : (
              <DashboardSectionView
                section={section}
                currentOrg={currentOrg}
                libraryItems={sortedLibrary}
                servicesCount={servicesData?.length ?? 0}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
