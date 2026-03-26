"use client";

import { useState } from "react";
import { LogOut, Plus, Building2, Loader2 } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import { authClient } from "../../../../packages/shared/src/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn } from "../lib/utils";

type OrganizationApi = typeof authClient.organization & {
  setActive: (input: { organizationId: string | null }) => Promise<{
    error?: { message?: string } | null;
  }>;
};

function getErrorMessage(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return fallback;
}

export function AuthControls() {
  const { data: sessionData } = authClient.useSession();
  const user = sessionData?.user;
  const isAuthenticated = !!sessionData?.session;
  const [isSwitchingOrganization, setIsSwitchingOrganization] = useState(false);
  const [isCreatingOrganization, setIsCreatingOrganization] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);

  // Get organizations from Convex (source of truth)
  const nativeOrganizations = useQuery(api.users.listMyOrganizations);

  const activeOrganizationId =
    typeof sessionData?.session?.activeOrganizationId === "string"
      ? sessionData.session.activeOrganizationId
      : null;

  const displayName =
    (typeof user?.name === "string" && user.name) ||
    (typeof user?.email === "string" && user.email) ||
    "Account";
  const displayEmail = (typeof user?.email === "string" && user.email) || "";
  const userImage =
    (typeof user?.image === "string" && user.image) ||
    (typeof (user as Record<string, unknown> | undefined)?.picture === "string" &&
      ((user as Record<string, unknown>).picture as string)) ||
    (typeof (user as Record<string, unknown> | undefined)?.avatar === "string" &&
      ((user as Record<string, unknown>).avatar as string)) ||
    (typeof (user as Record<string, unknown> | undefined)?.imageUrl === "string" &&
      ((user as Record<string, unknown>).imageUrl as string)) ||
    null;

  // Find active org from the Convex list
  const activeOrganization =
    nativeOrganizations?.find((org) => org.authOrganizationId === activeOrganizationId) ??
    nativeOrganizations?.[0] ??
    null;

  const handleSwitchOrganization = async (authOrgId: string | null) => {
    if (authOrgId === activeOrganizationId) {
      return;
    }

    setIsSwitchingOrganization(true);
    setMenuError(null);

    try {
      const organizationApi = authClient.organization as OrganizationApi;
      const response = await organizationApi.setActive({
        organizationId: authOrgId,
      });

      if (response.error) {
        setMenuError(response.error.message || "Unable to switch organization.");
      }
    } catch (error) {
      setMenuError(getErrorMessage(error, "Unable to switch organization."));
    } finally {
      setIsSwitchingOrganization(false);
    }
  };

  const handleCreateOrganization = async () => {
    setIsCreatingOrganization(true);
    setMenuError(null);
    try {
      const baseUrl =
        process.env.BETTER_AUTH_URL ||
        (process.env.NODE_ENV === "development"
          ? "http://localhost:3001"
          : "https://present.app");
      const dashboardUrl = `${baseUrl.replace(/\/+$/, "")}/dashboard`;

      if (window.electronAPI?.openExternalBrowser) {
        await window.electronAPI.openExternalBrowser(dashboardUrl);
      } else {
        window.open(dashboardUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      setMenuError(getErrorMessage(error, "Unable to open dashboard."));
    } finally {
      setIsCreatingOrganization(false);
    }
  };

  if (!isAuthenticated || !user) {
    return null;
  }

  const organizations = nativeOrganizations ?? [];
  const isLoadingOrganizations = nativeOrganizations === undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:ring-2 hover:ring-primary/40"
          title={displayName}
        >
          {userImage ? (
            <img
              src={userImage}
              alt={displayName}
              className="h-7 w-7 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-medium text-primary">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="space-y-0.5">
          <div className="truncate text-sm font-semibold text-foreground">
            {displayName}
          </div>
          <div className="truncate text-xs font-normal text-muted-foreground">
            {displayEmail}
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            void handleCreateOrganization();
          }}
          disabled={isCreatingOrganization}
          className="flex items-center gap-2"
        >
          {isCreatingOrganization ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          <span>Create organization</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Organizations
        </DropdownMenuLabel>

        {isLoadingOrganizations ? (
          <DropdownMenuItem disabled>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading organizations...</span>
          </DropdownMenuItem>
        ) : organizations.length === 0 ? (
          <DropdownMenuItem disabled>
            <Building2 className="h-4 w-4" />
            <span>No organizations yet</span>
          </DropdownMenuItem>
        ) : (
          organizations.map((org) => {
            const isActive = org.authOrganizationId === activeOrganizationId;

            return (
              <DropdownMenuItem
                key={org.id}
                onClick={() => {
                  if (org.authOrganizationId) {
                    void handleSwitchOrganization(org.authOrganizationId);
                  }
                }}
                disabled={isSwitchingOrganization || !org.authOrganizationId}
                className={cn(
                  "flex items-center gap-2",
                  isActive && "bg-primary/10 text-primary font-semibold",
                )}
              >
                {isSwitchingOrganization ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : (
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="truncate">{org.name}</span>
                {isActive && <span className="ml-auto text-[10px] text-muted-foreground">Active</span>}
              </DropdownMenuItem>
            );
          })
        )}

        {activeOrganization ? (
          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
            Active: {activeOrganization.name}
          </DropdownMenuLabel>
        ) : null}

        {menuError ? (
          <DropdownMenuLabel className="text-xs font-normal text-destructive">
            {menuError}
          </DropdownMenuLabel>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          onClick={async () => {
            await authClient.signOut();
          }}
          className="flex items-center gap-2"
        >
          <LogOut className="h-4 w-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
