"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Plus, User } from "lucide-react";
import { useDesktopSessionStore } from "../store/desktopSession";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";

const getInitials = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    return "P";
  }
  const parts = normalized.split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
};

const resolveWebBaseUrl = (): string => {
  const configured = process.env.WEB_APP_URL;
  if (configured) {
    return configured;
  }
  return process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : "https://present-gha.vercel.app";
};

export function AuthControls() {
  const [isOpening, setIsOpening] = useState(false);
  const authStatus = useDesktopSessionStore((state) => state.authStatus);
  const user = useDesktopSessionStore((state) => state.user);
  const orgId = useDesktopSessionStore((state) => state.orgId);
  const organizations = useDesktopSessionStore((state) => state.organizations);
  const setOrgId = useDesktopSessionStore((state) => state.setOrgId);
  const clearSession = useDesktopSessionStore((state) => state.clearSession);

  const isSignedIn =
    authStatus === "authenticated" &&
    Boolean(user && orgId && organizations.length > 0);

  if (authStatus === "unauthenticated") {
    return (
      <Button
        type="button"
        className="h-8 px-3 py-0 text-[11px] font-semibold"
        disabled={isOpening}
        onClick={async () => {
          if (!window.electronAPI?.beginAuthFlow || isOpening) {
            return;
          }
          setIsOpening(true);
          try {
            await window.electronAPI.beginAuthFlow();
          } finally {
            setIsOpening(false);
          }
        }}
      >
        {isOpening ? "Opening..." : "Sign In"}
      </Button>
    );
  }

  if (authStatus === "loading" || !isSignedIn) {
    return (
      <Button
        type="button"
        variant="ghost"
        disabled
        className="h-8 px-3 py-0 text-[11px] font-medium"
      >
        Loading...
      </Button>
    );
  }

  const activeOrganization =
    organizations.find((organization) => organization.id === orgId) ??
    organizations[0];
  const webBaseUrl = resolveWebBaseUrl();

  const realOrganizations = organizations.filter(org => org.type !== "personal");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-10 w-10 items-center justify-center rounded-full p-0 hover:opacity-80"
        >
          {activeOrganization.logo ? (
            activeOrganization.logo.startsWith("data:") ? (
              <img
                src={activeOrganization.logo}
                alt={activeOrganization.name}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <img
                src={activeOrganization.logo}
                alt={activeOrganization.name}
                className="h-10 w-10 rounded-full object-cover"
                crossOrigin="anonymous"
              />
            )
          ) : (
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-sm font-semibold text-primary">
              {getInitials(activeOrganization.name)}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[320px] p-0">
        <DropdownMenuLabel className="px-3 py-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Organizations
        </DropdownMenuLabel>
        <div className="max-h-[240px] overflow-y-auto px-1 pb-1">
          {realOrganizations.map((organization) => (
            <DropdownMenuItem
              key={organization.id}
              onClick={() => setOrgId(organization.id)}
              className="mx-1 my-0.5 flex items-center justify-between rounded-md px-2 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                {organization.logo ? (
                  organization.logo.startsWith("data:") ? (
                    <img
                      src={organization.logo}
                      alt={organization.name}
                      className="h-7 w-7 rounded-full object-cover"
                    />
                  ) : (
                    <img
                      src={organization.logo}
                      alt={organization.name}
                      className="h-7 w-7 rounded-full object-cover"
                      crossOrigin="anonymous"
                    />
                  )
                ) : (
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                    {getInitials(organization.name)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {organization.name}
                  </p>
                  <p className="truncate text-[10px] capitalize text-muted-foreground">
                    {organization.type}
                  </p>
                </div>
              </div>
              {organization.id === orgId ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </div>

        <DropdownMenuSeparator />
        <div className="space-y-1 p-2">
          <DropdownMenuItem
            onClick={() => {
              if (!window.electronAPI?.openExternalBrowser) {
                return;
              }
              void window.electronAPI.openExternalBrowser(
                `${webBaseUrl}/dashboard/organization/setup`
              );
            }}
            className="rounded-md px-2 py-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Organization
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => clearSession()}
            className="rounded-md px-2 py-2 text-destructive focus:text-destructive"
          >
            <User className="h-3.5 w-3.5" />
            Logout
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
