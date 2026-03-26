"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../../packages/backend/convex/_generated/api";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
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

type OrganizationApi = typeof authClient.organization & {
  listOrganizations: () => Promise<{
    data?: Array<{
      id: string;
      name: string;
      slug: string;
      logo?: string | null;
      createdAt?: string | Date;
    }>;
  }>;
  setActiveOrganization: (input: { organizationId: string }) => Promise<{
    error?: { message?: string } | null;
  }>;
};

type OneTimeTokenApi = {
  oneTimeToken: {
    generate: () => Promise<{
      data?: { token?: string | null } | null;
      error?: { message?: string } | null;
    }>;
  };
};

export function DashboardClient({
  org,
  libraryItems,
  shouldAutoOpen,
  section,
}: DashboardClientProps) {


  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const organizationApi = authClient.organization as OrganizationApi;
  const syncOrganization = useMutation(api.users.createOrganization);
  const linkAuthOrg = useMutation(api.users.linkAuthOrganization);

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
        authOrganizationId?: string;
        name: string;
        slug: string;
        logo?: string | null;
        role: string;
        createdAt: number;
      }>).map((org) => ({
        id: org.id,
        authOrganizationId: org.authOrganizationId,
        name: org.name,
        slug: org.slug,
        logo: org.logo ?? undefined,
        createdAt: new Date(org.createdAt),
      }));

      setOrganizations(list);

      // We don't need to auto-set the active workspace here anymore if it's managed by Zustand,
      // but if the activeorg is null and we have an organization we could fallback.
      // For now, respect the Zustand store.
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

  const sessionUser = (session?.user ?? null) as Record<string, unknown> | null;
  const viewerName =
    (typeof sessionUser?.name === "string" && sessionUser.name) ||
    (typeof sessionUser?.email === "string" && sessionUser.email) ||
    "Your account";
  const viewerEmail = (typeof sessionUser?.email === "string" && sessionUser.email) || "";
  const viewerImage =
    (typeof sessionUser?.image === "string" && sessionUser.image) ||
    (typeof sessionUser?.picture === "string" && sessionUser.picture) ||
    (typeof sessionUser?.avatar === "string" && sessionUser.avatar) ||
    (typeof sessionUser?.imageUrl === "string" && sessionUser.imageUrl) ||
    null;

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

    if (!session?.session) {
      router.replace("/auth/login");
    }
  }, [isSessionPending, router, session]);

  const openDesktopApp = useCallback(async () => {

    const oneTimeTokenApi = authClient as typeof authClient & OneTimeTokenApi;

    try {
      const tokenResponse = await oneTimeTokenApi.oneTimeToken.generate();
      const token = tokenResponse.data?.token;

      if (token) {
        window.location.href = `present://auth-callback?token=${encodeURIComponent(token)}`;
        return;
      }
    } catch {
      // Fall back to plain app open when token generation fails.
    }

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
    authOrgId?: string | null,
  ) => {
    if (type === activeWorkspaceType && id === activeWorkspaceId) {
      setIsAccountSwitcherOpen(false);
      return;
    }

    setIsSwitchingOrganization(true);
    setFeedback(null);

    // Update global store
    setWorkspace(type, id);

    try {
      if (type === "organization" && authOrgId) {
        await organizationApi.setActiveOrganization({
          organizationId: authOrgId,
        });
      } else if (type === "personal") {
        await organizationApi.setActiveOrganization({
          organizationId: "", // Clear BetterAuth active org
        });
      }
    } catch (err) {
      console.warn("Failed to sync BetterAuth session, but context changed:", err);
    } finally {
      setIsSwitchingOrganization(false);
      setIsAccountSwitcherOpen(false);
      
      const nextActiveOrg = type === "organization" 
        ? organizations.find((o) => o.id === id) ?? null 
        : null;
      
      setCurrentOrg(nextActiveOrg ? { name: nextActiveOrg.name, logo: nextActiveOrg.logo } : null);
    }
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

      // STEP 1: Create in Convex FIRST (source of truth)
      // If this fails, we never touch BetterAuth — no orphaned records.
      let convexResult;
      try {
        convexResult = await syncOrganization({
          orgName: name,
          logo: nextLogo,
          orgType,
          userRole,
        });
      } catch (convexError: unknown) {
        console.error("Convex organization creation failed:", convexError);
        const msg = convexError instanceof Error ? convexError.message : String(convexError);
        setFeedback(`Failed to create organization: ${msg}`);
        return;
      }

      // STEP 2: Now create in BetterAuth (secondary, for auth session linkage)
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");

      try {
        const { data, error: orgError } = await authClient.organization.create({
          name,
          slug,
          logo: nextLogo,
        });

        if (data?.id && convexResult) {
          // Link the BetterAuth org ID to the Convex org
          // This is best-effort — if it fails, the org still exists in Convex
          try {
            await linkAuthOrg({
              orgId: convexResult.orgId,
              authOrganizationId: data.id,
            });
          } catch (linkError) {
            console.warn("Failed to link BetterAuth org to Convex, but org was created:", linkError);
          }
        }


        if (orgError) {
          // BetterAuth failed, but org is in Convex — that's OK, log it
          console.warn("BetterAuth org creation failed (Convex org exists):", orgError.message);
        }
      } catch (authError) {
        // BetterAuth creation failed entirely - org still exists in Convex, which is fine
        console.warn("BetterAuth org creation threw (Convex org exists):", authError);
      }

      // Success — the org is in Convex (the source of truth)
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
      const { error } = await authClient.signOut();
      if (error) {
        setFeedback(error.message || "Failed to sign out. Please try again.");
        setIsSigningOut(false);
        return;
      }

      // Use window.location.href for a hard reload to clear all client-side state
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
