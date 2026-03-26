"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useMutation, useQuery } from "convex/react";
import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";

import { api } from "../../../../../packages/backend/convex/_generated/api";
import { useRouter } from "next/navigation";
import { useWorkspaceStore } from "../../../../../packages/shared/src/store/workspace";
import { DashboardSidebar } from "./components/DashboardSidebar";
import { DashboardOverview } from "./components/DashboardOverview";
import { DashboardSectionView } from "./components/DashboardSectionView";
import { OrganizationModal } from "./components/OrganizationModal";
import {
  DashboardClientProps,
  DashboardLibraryItem,
  DashboardOrganization,
  DashboardOrganizationListItem,
  DashboardServiceItem,
} from "./types";

const MAX_LOGO_FILE_SIZE = 4 * 1024 * 1024;

export function DashboardClient({
  org,
  libraryItems,
  shouldAutoOpen,
  section,
}: DashboardClientProps) {
  const router = useRouter();
  const { isAuthenticated, isLoading: isSessionPending } = useConvexAuth();
  const { signOut } = useAuthActions();
  const currentUser = useQuery(api.users.getCurrentUser);
  const syncOrganization = useMutation(api.users.createOrganization);

  const { type: activeWorkspaceType, id: activeWorkspaceId, setWorkspace } = useWorkspaceStore();

  const libraryData = useQuery(api.libraries.list, { 
    workspaceId: activeWorkspaceId ?? undefined 
  }) as DashboardLibraryItem[] | undefined;

  const activeLibraryData = libraryData ?? libraryItems;

  const servicesData = useQuery(api.services.list, {
    workspaceId: activeWorkspaceId ?? undefined
  }) as DashboardServiceItem[] | undefined;

  const [currentOrg, setCurrentOrg] = useState<DashboardOrganization | null>(org);
  const [organizations, setOrganizations] = useState<DashboardOrganizationListItem[]>([]);
  const [isOrganizationModalOpen, setIsOrganizationModalOpen] = useState(false);
  const [isAccountSwitcherOpen, setIsAccountSwitcherOpen] = useState(false);

  const nativeOrganizations = useQuery(api.users.listMyOrganizations);

  useEffect(() => {
    if (nativeOrganizations) {
      const list: DashboardOrganizationListItem[] = (nativeOrganizations as Array<{
        id: string;
        name: string;
        slug: string;
        logo?: string | null;
        role: string;
        createdAt: number;
      }>).map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: org.logo ?? undefined,
        createdAt: new Date(org.createdAt),
      }));

      setOrganizations(list);

      const activeOrg = activeWorkspaceType === "organization"
        ? list.find((org) => org.id === activeWorkspaceId) ?? null
        : null;

      setCurrentOrg(activeOrg);
    }
  }, [nativeOrganizations, activeWorkspaceType, activeWorkspaceId]);

  const [orgName, setOrgName] = useState(org?.name ?? "");
  const [logoMode, setLogoMode] = useState<"url" | "upload">("url");
  const [logoPreview, setLogoPreview] = useState<string | null>(org?.logo ?? null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoUrl, setLogoUrl] = useState(
    org?.logo && !org.logo.startsWith("data:") ? org.logo : "",
  );
  const [uploadedLogo, setUploadedLogo] = useState<string | null>(null);
  const [orgType, setOrgType] = useState("church");
  const [userRole, setUserRole] = useState("tech-director");

  const [isPending, setIsPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSwitchingOrganization, setIsSwitchingOrganization] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const viewerName = currentUser?.name || currentUser?.email || "Your account";
  const viewerEmail = currentUser?.email || "";
  const viewerImage = currentUser?.image || null;

  useEffect(() => {
    setCurrentOrg(org);
  }, [org]);

  useEffect(() => {
    if (!currentOrg) {
      return;
    }

    setOrgName(currentOrg.name);
    setLogoPreview(currentOrg.logo ?? null);
    setLogoUrl(
      currentOrg.logo && !currentOrg.logo.startsWith("data:")
        ? currentOrg.logo
        : "",
    );
    setRemoveLogo(false);
  }, [currentOrg]);

  const sortedLibrary = useMemo(
    () =>
      [...(activeLibraryData ?? [])].sort(
        (a, b) => (b.updatedAt ?? b._creationTime) - (a.updatedAt ?? a._creationTime),
      ),
    [activeLibraryData],
  );

  useEffect(() => {
    if (isSessionPending) {
      return;
    }

    if (!isAuthenticated) {
      router.replace("/auth/login");
    }
  }, [isSessionPending, router, isAuthenticated]);

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

  const openCreateOrganizationModal = () => {
    setFeedback(null);
    setOrgName("");
    setOrgType("church");
    setUserRole("tech-director");
    setLogoMode("url");
    setLogoPreview(null);
    setRemoveLogo(false);
    setLogoUrl("");
    setUploadedLogo(null);
    setIsAccountSwitcherOpen(false);
    setIsOrganizationModalOpen(true);
  };

  const handleSwitchContext = async (
    type: "personal" | "organization",
    id: string | null,
  ) => {
    if (type === activeWorkspaceType && id === activeWorkspaceId) {
      setIsAccountSwitcherOpen(false);
      return;
    }

    setIsSwitchingOrganization(true);
    setFeedback(null);

    setWorkspace(type, id);

    setIsSwitchingOrganization(false);
    setIsAccountSwitcherOpen(false);
    
    const nextActiveOrg = type === "organization" 
      ? organizations.find((o) => o.id === id) ?? null 
      : null;
    
    setCurrentOrg(nextActiveOrg ? { name: nextActiveOrg.name, logo: nextActiveOrg.logo } : null);
    setIsAccountSwitcherOpen(false);
    router.refresh();
  };

  const handleLogoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (file.size > MAX_LOGO_FILE_SIZE) {
      setFeedback("Logo upload must be 4MB or smaller.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setRemoveLogo(false);
        setUploadedLogo(reader.result);
        setLogoPreview(reader.result);
        setFeedback(null);
      }
    };
    reader.onerror = () => {
      setFeedback("Unable to read the selected logo file.");
    };
    reader.readAsDataURL(file);
  };

  const handleCreateOrganization = async () => {
    const name = orgName.trim();

    if (!name) {
      setFeedback("Organization name is required.");
      return;
    }

    setIsPending(true);
    setFeedback(null);

    try {
      const nextLogo =
        removeLogo
          ? undefined
          : logoMode === "upload"
            ? uploadedLogo ?? undefined
            : logoUrl.trim() || undefined;

      await syncOrganization({
        orgName: name,
        logo: nextLogo,
        orgType,
        userRole,
      });

      setIsOrganizationModalOpen(false);
      setOrgName("");
      setOrgType("church");
      setUserRole("tech-director");
      setLogoUrl("");
      setLogoPreview(null);
      setUploadedLogo(null);
      setFeedback(null);

    } catch (error) {
      console.error("Failed to create organization:", error);
      setFeedback(
        error instanceof Error ? error.message : "An unexpected error occurred during creation."
      );
    } finally {
      setIsPending(false);
    }
  };

  const handleSignOut = async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    setFeedback(null);

    try {
      await signOut();
      window.location.href = "/auth/login";
    } catch (error) {
      console.error("Sign out exception:", error);
      setFeedback("An unexpected error occurred during sign out.");
      setIsSigningOut(false);
    }
  };

  if (isSessionPending) {
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
    <>
      <div className="fixed inset-0 box-border overflow-hidden bg-[#111111] px-10 py-10">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[1700px] items-stretch overflow-hidden">
          <div className="flex w-full min-h-0 items-stretch gap-14 overflow-hidden">
            <DashboardSidebar
              currentSection={section}
              viewerName={viewerName}
              viewerEmail={viewerEmail}
              viewerImage={viewerImage}
              organizations={organizations}
              activeWorkspaceType={activeWorkspaceType}
              activeWorkspaceId={activeWorkspaceId}
              isAccountSwitcherOpen={isAccountSwitcherOpen}
              isSwitchingOrganization={isSwitchingOrganization}
              onToggleAccountSwitcher={() => {
                setIsAccountSwitcherOpen((current) => !current);
              }}
              onCloseAccountSwitcher={() => {
                setIsAccountSwitcherOpen(false);
              }}
              onCreateOrganization={openCreateOrganizationModal}
              onSwitchContext={handleSwitchContext}
              isSigningOut={isSigningOut}
              onSignOut={handleSignOut}
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
                  isSigningOut={isSigningOut}
                  onSignOut={handleSignOut}
                />
              )}
            </main>
          </div>
        </div>
      </div>

      <OrganizationModal
        isOpen={isOrganizationModalOpen}
        isPending={isPending}
        orgName={orgName}
        orgType={orgType}
        userRole={userRole}
        logoMode={logoMode}
        logoUrl={logoUrl}
        logoPreview={logoPreview}
        feedback={feedback}
        onClose={() => {
          if (!isPending) {
            setIsOrganizationModalOpen(false);
          }
        }}
        onSubmit={() => {
          void handleCreateOrganization();
        }}
        onOrgNameChange={setOrgName}
        onOrgTypeChange={setOrgType}
        onUserRoleChange={setUserRole}
        onLogoModeChange={(mode) => {
          setLogoMode(mode);
          setRemoveLogo(false);
        }}
        onLogoUrlChange={(value) => {
          setRemoveLogo(false);
          setUploadedLogo(null);
          setLogoUrl(value);
          setLogoPreview(value || null);
        }}
        onLogoUpload={handleLogoUpload}
        onRemoveLogo={() => {
          setRemoveLogo(true);
          setLogoPreview(null);
          setUploadedLogo(null);
          setLogoUrl("");
        }}
      />
    </>
  );
}
