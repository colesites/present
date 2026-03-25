"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, LogOut, Plus, Building2, Loader2 } from "lucide-react";
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

type OrganizationItem = {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  createdAt?: string | Date;
};

type OrganizationApi = typeof authClient.organization & {
  list: () => Promise<{
    data?: OrganizationItem[];
    error?: { message?: string } | null;
  }>;
  setActive: (input: { organizationId: string | null }) => Promise<{
    error?: { message?: string } | null;
  }>;
  create: (input: {
    name: string;
    slug: string;
    logo?: string;
  }) => Promise<{
    data?: { id?: string | null } | null;
    error?: { message?: string } | null;
  }>;
};

function getErrorStatus(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }

  return null;
}

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
  const [organizations, setOrganizations] = useState<OrganizationItem[]>([]);
  const [isLoadingOrganizations, setIsLoadingOrganizations] = useState(false);
  const [isSwitchingOrganization, setIsSwitchingOrganization] = useState(false);
  const [isCreatingOrganization, setIsCreatingOrganization] = useState(false);
  const [isOrganizationApiAvailable, setIsOrganizationApiAvailable] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);

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

  const activeOrganization = useMemo(
    () =>
      organizations.find((organization) => organization.id === activeOrganizationId) ??
      null,
    [activeOrganizationId, organizations],
  );

  const refreshOrganizations = useCallback(async () => {
    if (!isAuthenticated) {
      setOrganizations([]);
      setIsLoadingOrganizations(false);
      return [];
    }

    setIsLoadingOrganizations(true);
    setMenuError(null);

    try {
      const organizationApi = authClient.organization as OrganizationApi;
      const response = await organizationApi.list();

      if (response.error) {
        setMenuError(response.error.message || "Unable to load organizations.");
        return [];
      }

      const nextOrganizations = response.data ?? [];
      setOrganizations(nextOrganizations);
      setIsOrganizationApiAvailable(true);
      return nextOrganizations;
    } catch (error) {
      if (getErrorStatus(error) === 404) {
        setIsOrganizationApiAvailable(false);
        setOrganizations([]);
        setMenuError("Organizations are unavailable on this auth deployment.");
        return [];
      }

      setMenuError(getErrorMessage(error, "Unable to load organizations."));
      return [];
    } finally {
      setIsLoadingOrganizations(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setOrganizations([]);
      setMenuError(null);
      setIsOrganizationApiAvailable(true);
      return;
    }

    void refreshOrganizations();
  }, [isAuthenticated, refreshOrganizations]);

  const handleSwitchOrganization = async (organizationId: string) => {
    if (organizationId === activeOrganizationId) {
      return;
    }

    setIsSwitchingOrganization(true);
    setMenuError(null);

    try {
      const organizationApi = authClient.organization as OrganizationApi;
      const response = await organizationApi.setActive({
        organizationId,
      });

      if (response.error) {
        setMenuError(response.error.message || "Unable to switch organization.");
        return;
      }

      await refreshOrganizations();
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md border border-input bg-background px-2 py-1 transition hover:bg-accent"
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
          <span className="max-w-[88px] truncate text-xs font-medium text-foreground">
            {displayName}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
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
          disabled={isCreatingOrganization || !isOrganizationApiAvailable}
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

        {!isOrganizationApiAvailable ? (
          <DropdownMenuItem disabled>
            <Building2 className="h-4 w-4" />
            <span>Organization API unavailable</span>
          </DropdownMenuItem>
        ) : isLoadingOrganizations ? (
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
          organizations.map((organization) => {
            const isActive = organization.id === activeOrganizationId;

            return (
              <DropdownMenuItem
                key={organization.id}
                onClick={() => {
                  void handleSwitchOrganization(organization.id);
                }}
                disabled={isSwitchingOrganization}
                className={cn(
                  "flex items-center justify-between gap-2",
                  isActive && "bg-primary/10 text-primary",
                )}
              >
                <span className="truncate">{organization.name}</span>
                {isActive ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
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
