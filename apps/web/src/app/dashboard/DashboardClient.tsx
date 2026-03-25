"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { DashboardSidebar } from "./components/DashboardSidebar";
import { DashboardOverview } from "./components/DashboardOverview";
import { DashboardSectionView } from "./components/DashboardSectionView";
import { OrganizationModal } from "./components/OrganizationModal";
import {
  DashboardClientProps,
  DashboardOrganization,
  DashboardOrganizationListItem,
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
  songs,
  shouldAutoOpen,
  section,
}: DashboardClientProps) {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const organizationApi = authClient.organization as OrganizationApi;

  const [currentOrg, setCurrentOrg] = useState<DashboardOrganization | null>(org);
  const [organizations, setOrganizations] = useState<DashboardOrganizationListItem[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(null);
  const [isLoadingOrganization, setIsLoadingOrganization] = useState(true);
  const [isOrganizationModalOpen, setIsOrganizationModalOpen] = useState(false);
  const [isAccountSwitcherOpen, setIsAccountSwitcherOpen] = useState(false);

  const [orgName, setOrgName] = useState(org?.name ?? "");
  const [logoMode, setLogoMode] = useState<"url" | "upload">("url");
  const [logoPreview, setLogoPreview] = useState<string | null>(org?.logo ?? null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoUrl, setLogoUrl] = useState(
    org?.logo && !org.logo.startsWith("data:") ? org.logo : "",
  );
  const [uploadedLogo, setUploadedLogo] = useState<string | null>(null);

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

  const sortedSongs = useMemo(
    () =>
      [...songs].sort(
        (a, b) => (b.updatedAt ?? b._creationTime) - (a.updatedAt ?? a._creationTime),
      ),
    [songs],
  );

  useEffect(() => {
    if (isSessionPending) {
      return;
    }

    if (!session?.session) {
      router.replace("/auth/login");
    }
  }, [isSessionPending, router, session]);

  useEffect(() => {
    if (isSessionPending || !session?.session) {
      return;
    }

    let cancelled = false;

    const loadOrganizations = async () => {
      setIsLoadingOrganization(true);

      try {
        const response = await organizationApi.listOrganizations();
        const list = (response.data ?? []).map((organization) => ({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          logo: organization.logo ?? undefined,
          createdAt: organization.createdAt,
        }));

        if (cancelled) {
          return;
        }

        const sessionActiveOrganizationId =
          typeof session.session.activeOrganizationId === "string"
            ? session.session.activeOrganizationId
            : null;

        const nextActiveOrganization =
          list.find((organization) => organization.id === sessionActiveOrganizationId) ??
          list[0] ??
          null;

        setOrganizations(list);
        setActiveOrganizationId(nextActiveOrganization?.id ?? null);
        setCurrentOrg(
          nextActiveOrganization
            ? {
                name: nextActiveOrganization.name,
                logo: nextActiveOrganization.logo,
              }
            : null,
        );
      } finally {
        if (!cancelled) {
          setIsLoadingOrganization(false);
        }
      }
    };

    void loadOrganizations();

    return () => {
      cancelled = true;
    };
  }, [isSessionPending, organizationApi, session]);

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
    setLogoMode("url");
    setLogoPreview(null);
    setRemoveLogo(false);
    setLogoUrl("");
    setUploadedLogo(null);
    setIsAccountSwitcherOpen(false);
    setIsOrganizationModalOpen(true);
  };

  const handleOrganizationSwitch = async (
    organization: DashboardOrganizationListItem,
  ) => {
    if (organization.id === activeOrganizationId) {
      setIsAccountSwitcherOpen(false);
      return;
    }

    setIsSwitchingOrganization(true);
    setFeedback(null);

    const result = await organizationApi.setActiveOrganization({
      organizationId: organization.id,
    });

    setIsSwitchingOrganization(false);

    if (result.error) {
      setFeedback(result.error.message || "Unable to switch organization.");
      return;
    }

    setActiveOrganizationId(organization.id);
    setCurrentOrg({
      name: organization.name,
      logo: organization.logo,
    });
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

      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");

      const { data, error: orgError } = await authClient.organization.create({
        name,
        slug,
        logo: nextLogo,
      });

      if (orgError) {
        // If the error is that the organization already exists, we can still try to sync it.
        // This handles cases where the Better Auth side succeeded but the Convex side failed previously.
        const errorMessage = orgError.message || "Unable to create organization.";
        const isExistingOrgError =
          errorMessage.toLowerCase().includes("already exists") ||
          errorMessage.toLowerCase().includes("already taken");

        if (!isExistingOrgError) {
          setFeedback(errorMessage);
          return;
        }
      }

      const syncResponse = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orgName: name,
          logo: nextLogo,
        }),
      });

      const syncResult = (await syncResponse.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!syncResponse.ok) {
        setFeedback(syncResult?.error || "Organization was created, but sync failed.");
        return;
      }

      const createdOrganization: DashboardOrganizationListItem = {
        id: data?.id ?? slug,
        name,
        slug,
        logo: nextLogo,
      };

      setOrganizations((currentList) => [createdOrganization, ...currentList]);
      setActiveOrganizationId(createdOrganization.id);
      setCurrentOrg({
        name,
        logo: nextLogo,
      });
      setFeedback(null);
      setIsOrganizationModalOpen(false);
      router.refresh();
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

    try {
      await authClient.signOut();
    } finally {
      router.replace("/auth/login");
      router.refresh();
      setIsSigningOut(false);
    }
  };

  if (isSessionPending) {
    return (
      <div className="fixed inset-0 box-border overflow-hidden bg-[#111111] px-6 py-8 text-white">
        <div className="flex h-full items-center justify-center rounded-[36px] bg-[#191919]">
          <div className="rounded-full bg-white/6 px-5 py-3 text-sm text-white/72">
            Loading workspace...
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
              activeOrganizationId={activeOrganizationId}
              isAccountSwitcherOpen={isAccountSwitcherOpen}
              isSwitchingOrganization={isSwitchingOrganization}
              onToggleAccountSwitcher={() => {
                setIsAccountSwitcherOpen((current) => !current);
              }}
              onCloseAccountSwitcher={() => {
                setIsAccountSwitcherOpen(false);
              }}
              onCreateOrganization={openCreateOrganizationModal}
              onSelectOrganization={(organization) => {
                void handleOrganizationSwitch(organization);
              }}
              isSigningOut={isSigningOut}
              onSignOut={() => {
                void handleSignOut();
              }}
            />
            <main className="h-full max-h-full min-h-0 min-w-0 max-w-[1320px] flex-1 self-stretch overflow-y-auto overflow-x-hidden overscroll-contain rounded-[56px] border border-[#e8e8e8] bg-white shadow-[0_28px_76px_rgba(0,0,0,0.08)] [scrollbar-gutter:stable]">
              {section === "dashboard" ? (
                <DashboardOverview
                  currentOrg={currentOrg}
                  organizationsCount={organizations.length}
                  songs={sortedSongs}
                  shouldAutoOpen={shouldAutoOpen}
                  onOpenDesktopApp={() => {
                    void openDesktopApp();
                  }}
                />
              ) : (
                <DashboardSectionView
                  section={section}
                  currentOrg={currentOrg}
                  songs={sortedSongs}
                  isSigningOut={isSigningOut}
                  onSignOut={() => {
                    void handleSignOut();
                  }}
                />
              )}
            </main>
          </div>
        </div>
      </div>

      <OrganizationModal
        isOpen={isOrganizationModalOpen}
        isPending={isPending}
        isLoading={isLoadingOrganization}
        orgName={orgName}
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
