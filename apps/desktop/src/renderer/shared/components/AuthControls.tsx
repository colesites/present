"use client";

import { useEffect, useState, useCallback } from "react";
import { Check, ChevronsUpDown, Plus, User } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { useDesktopSessionStore } from "../store/desktopSession";
import { useSpeechUsageStore } from "../store/speechUsage";
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
    : "https://present.c-technology-inc.com";
};

const formatUsageDuration = (
  seconds: number,
  options?: { roundUpMinutes?: boolean },
): string => {
  const normalizedSeconds = Math.max(0, Math.round(seconds));
  if (normalizedSeconds === 0) {
    return "0 min";
  }

  if (normalizedSeconds < 60) {
    return `${normalizedSeconds} sec`;
  }

  const totalMinutes = options?.roundUpMinutes
    ? Math.ceil(normalizedSeconds / 60)
    : Math.floor(normalizedSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = totalMinutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
};

export function AuthControls() {
  const [isOpening, setIsOpening] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const authStatus = useDesktopSessionStore((state) => state.authStatus);
  const user = useDesktopSessionStore((state) => state.user);
  const orgId = useDesktopSessionStore((state) => state.orgId);
  const organizations = useDesktopSessionStore((state) => state.organizations);
  const setOrgId = useDesktopSessionStore((state) => state.setOrgId);
  const clearSession = useDesktopSessionStore((state) => state.clearSession);
  const persistCurrentWorkspace = useMutation(api.users.setCurrentWorkspace);

  // Switch the active organization both locally (instant UI) and on the
  // server (so the choice follows the user to other devices).
  const handleSelectOrganization = useCallback(
    (organization: { id: string; type: "personal" | "organization" }) => {
      setOrgId(organization.id);
      if (organization.type === "organization") {
        void persistCurrentWorkspace({
          workspaceType: "organization",
          workspaceOrgId: organization.id as Id<"organizations">,
        }).catch((error) => {
          console.warn(
            "[Desktop Auth] failed to persist workspace preference",
            error,
          );
        });
      } else {
        void persistCurrentWorkspace({ workspaceType: "personal" }).catch(
          (error) => {
            console.warn(
              "[Desktop Auth] failed to persist workspace preference",
              error,
            );
          },
        );
      }
    },
    [persistCurrentWorkspace, setOrgId],
  );
  const billing = useDesktopSessionStore((state) => state.user?.billing);
  const activeSpeechSessionStartedAtMs = useSpeechUsageStore(
    (state) => state.activeSessionStartedAtMs,
  );
  const pendingCommittedUsageSeconds = useSpeechUsageStore(
    (state) => state.pendingCommittedUsageSeconds,
  );

  useEffect(() => {
    if (!activeSpeechSessionStartedAtMs) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeSpeechSessionStartedAtMs]);

  const isSignedIn =
    authStatus === "authenticated" &&
    Boolean(user && organizations.length > 0);

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
    organizations.find((organization) => organization.type === "personal") ??
    organizations[0];
  const webBaseUrl = resolveWebBaseUrl();

  const effectiveUsedSeconds = billing
    ? Math.min(
        billing.quotaSeconds,
        billing.usedSeconds +
          pendingCommittedUsageSeconds +
          (activeSpeechSessionStartedAtMs
            ? Math.max(0, Math.ceil((nowMs - activeSpeechSessionStartedAtMs) / 1000))
            : 0),
      )
    : 0;
  const effectiveRemainingSeconds = billing
    ? Math.max(0, billing.quotaSeconds - effectiveUsedSeconds)
    : 0;
  const usageSummary = billing
    ? `${formatUsageDuration(effectiveUsedSeconds, { roundUpMinutes: true })} / ${formatUsageDuration(billing.quotaSeconds)} used`
    : null;
  const usageRemainder = billing
    ? `${formatUsageDuration(effectiveRemainingSeconds)} left this month`
    : null;

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
        <div className="border-b border-border/70 px-3 py-3">
          <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
          {usageSummary && usageRemainder ? (
            <div className="mt-2 space-y-0.5">
              <p className="text-[11px] font-medium text-foreground">{usageSummary}</p>
              <p className="text-[10px] text-muted-foreground">{usageRemainder}</p>
            </div>
          ) : null}
        </div>
        <DropdownMenuLabel className="px-3 py-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Organizations
        </DropdownMenuLabel>
        <div className="max-h-[240px] overflow-y-auto px-1 pb-1">
          {realOrganizations.map((organization) => (
            <DropdownMenuItem
              key={organization.id}
              onClick={() => handleSelectOrganization(organization)}
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
