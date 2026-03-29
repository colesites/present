"use client";

import { useEffect, useRef } from "react";
import {
  OrganizationSwitcher,
  useOrganization,
  useUser,
  useClerk,
} from "@clerk/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import { useWorkspaceStore } from "../../../../../../packages/shared/src/store/workspace";

export function AuthControls() {
  const { user, isLoaded } = useUser();
  const { organization, isLoaded: isOrganizationLoaded } = useOrganization();
  useClerk();
  const {
    type: workspaceType,
    id: workspaceId,
    setWorkspace,
  } = useWorkspaceStore();
  const convexOrganization = useQuery(
    api.organizations.getByClerkId,
    organization?.id ? { clerkOrgId: organization.id } : "skip"
  );
  const updateOrganizationMetadata = useMutation(api.organizations.updateMetadata);
  const ensuringClerkOrgIdRef = useRef<string | null>(null);
  const currentPath =
    typeof window === "undefined"
      ? "/"
      : `${window.location.pathname}${window.location.search}`;

  useEffect(() => {
    if (!isOrganizationLoaded) {
      return;
    }

    if (!organization?.id) {
      ensuringClerkOrgIdRef.current = null;
      if (workspaceType !== "personal" || workspaceId !== null) {
        setWorkspace("personal", null);
      }
      return;
    }

    const nextWorkspaceId = convexOrganization?._id ?? null;
    if (!nextWorkspaceId) {
      if (ensuringClerkOrgIdRef.current === organization.id) {
        return;
      }
      ensuringClerkOrgIdRef.current = organization.id;
      void updateOrganizationMetadata({
        clerkOrgId: organization.id,
      }).catch((error) => {
        console.error("Failed to map Clerk organization:", error);
        ensuringClerkOrgIdRef.current = null;
      });
      return;
    }

    if (workspaceType !== "organization" || workspaceId !== nextWorkspaceId) {
      setWorkspace("organization", nextWorkspaceId);
    }
  }, [
    convexOrganization?._id,
    isOrganizationLoaded,
    organization?.id,
    updateOrganizationMetadata,
    setWorkspace,
    workspaceId,
    workspaceType,
  ]);

  if (!isLoaded || !user) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {/* Clerk Organization Switcher with avatar-only trigger */}
      <OrganizationSwitcher
        appearance={{
          elements: {
            rootBox: "flex items-center",
            organizationSwitcherTrigger:
              "p-0 border-0 bg-transparent hover:bg-transparent focus:ring-2 focus:ring-primary/40 rounded-full",
            organizationSwitcherTriggerIcon: "hidden",
            userPreviewTextContainer: "hidden",
            organizationPreviewTextContainer: "hidden",
            avatarBox: "h-8 w-8",
            organizationSwitcherPopoverCard: "bg-background border-border",
            organizationSwitcherPopoverActionButton:
              "text-foreground hover:bg-accent",
            organizationSwitcherPopoverActionButtonText: "text-foreground",
            organizationSwitcherPopoverActionButtonIcon: "text-foreground",
          },
          variables: {
            colorBackground: "hsl(var(--background))",
            colorText: "hsl(var(--foreground))",
            colorTextSecondary: "hsl(var(--muted-foreground))",
            colorInputBackground: "hsl(var(--input))",
            colorInputText: "hsl(var(--foreground))",
            colorPrimary: "hsl(var(--primary))",
          },
        }}
        afterCreateOrganizationUrl={(org) => {
          const baseUrl =
            process.env.WEB_APP_URL ||
            (process.env.NODE_ENV === "development"
              ? "http://localhost:3001"
              : "https://present-gha.vercel.app");
          const setupUrl = new URL("/dashboard/organization/setup", baseUrl);
          setupUrl.searchParams.set("clerkOrgId", org.id);

          if (window.electronAPI?.openExternalBrowser) {
            window.electronAPI.openExternalBrowser(setupUrl.toString());
          }
          return currentPath;
        }}
        afterSelectOrganizationUrl={currentPath}
        afterSelectPersonalUrl={currentPath}
      />
    </div>
  );
}
