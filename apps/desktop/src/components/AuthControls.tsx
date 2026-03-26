"use client";

import { useState } from "react";
import { LogOut, Plus, Building2, Loader2 } from "lucide-react";
import { useQuery } from "convex/react";
import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@present/backend/convex/_generated/api";
import { useWorkspaceStore } from "../../../../packages/shared/src";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn } from "../lib/utils";

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
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();
  const currentUser = useQuery(api.users.getCurrentUser);
  const [isSwitchingOrganization, setIsSwitchingOrganization] = useState(false);
  const [isCreatingOrganization, setIsCreatingOrganization] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);

  // Get organizations from Convex (source of truth)
  const nativeOrganizations = useQuery(api.users.listMyOrganizations);

  // Get workspaces from Context store
  const { type: activeWorkspaceType, id: activeWorkspaceId, setWorkspace } = useWorkspaceStore();

  const displayName = currentUser?.name || currentUser?.email || "Account";
  const displayEmail = currentUser?.email || "";
  const userImage = currentUser?.image || null;

  // Find active org from the Convex list (used for display name if it's an org)
  const activeOrganization =
    activeWorkspaceType === "organization"
      ? nativeOrganizations?.find((org) => org.id === activeWorkspaceId) ?? null
      : null;

  const handleSwitchContext = async (type: "personal" | "organization", id: string | null) => {
    if (type === activeWorkspaceType && id === activeWorkspaceId) {
      return;
    }

    setIsSwitchingOrganization(true);
    setMenuError(null);

    try {
      // Update global zustand store immediately for snappy UI
      setWorkspace(type, id);
    } catch (error) {
      console.warn("Context switch failed.", error);
      setMenuError(getErrorMessage(error, "Failed to switch workspace"));
    } finally {
      setIsSwitchingOrganization(false);
    }
  };

  const handleCreateOrganization = async () => {
    setIsCreatingOrganization(true);
    setMenuError(null);
    try {
      const baseUrl = process.env.WEB_APP_URL ||
        (process.env.NODE_ENV === "development"
          ? "http://localhost:3001"
          : "https://present-gha.vercel.app");
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

  if (!isAuthenticated || !currentUser) {
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

        <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>

        {/* Personal Workspace */}
        <DropdownMenuItem
          onClick={() => {
            void handleSwitchContext("personal", null);
          }}
          disabled={isSwitchingOrganization}
          className={cn(
            "flex items-center gap-2",
            activeWorkspaceType === "personal" && "bg-primary/10 text-primary font-semibold",
          )}
        >
          <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary/20 text-[8px] font-bold text-primary shrink-0">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <span className="truncate">Personal Workspace</span>
          {activeWorkspaceType === "personal" && <span className="ml-auto text-[10px] text-muted-foreground">Active</span>}
        </DropdownMenuItem>


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
            const isActive = activeWorkspaceType === "organization" && activeWorkspaceId === org.id;

            return (
              <DropdownMenuItem
                key={org.id}
                onClick={() => {
                  void handleSwitchContext("organization", org.id);
                }}
                disabled={isSwitchingOrganization}
                className={cn(
                  "flex items-center gap-2",
                  isActive && "bg-primary/10 text-primary font-semibold",
                )}
              >
                {isSwitchingOrganization && isActive ? (
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

        {activeWorkspaceType === "organization" && activeOrganization ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
              Active Org: {activeOrganization.name}
            </DropdownMenuLabel>
          </>
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
            await signOut();
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
