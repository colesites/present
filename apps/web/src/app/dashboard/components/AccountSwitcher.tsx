"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { ChevronDown, Check, LogOut, Plus } from "lucide-react";
import { DashboardOrganizationListItem, getInitials } from "../types";

interface AccountSwitcherProps {
  viewerName: string;
  viewerImage: string | null;
  organizations: DashboardOrganizationListItem[];
  activeWorkspaceType: "personal" | "organization";
  activeWorkspaceId: string | null;
  isOpen: boolean;
  isSwitching: boolean;
  onToggle: () => void;
  onClose: () => void;
  onCreateOrganization: () => void;
  onSwitchContext: (type: "personal" | "organization", id: string | null, authOrgId?: string | null) => void;
  isSigningOut: boolean;
  onSignOut: () => void;
}

export function AccountSwitcher({
  viewerName,
  viewerImage,
  organizations,
  activeWorkspaceType,
  activeWorkspaceId,
  isOpen,
  isSwitching,
  onToggle,
  onClose,
  onCreateOrganization,
  onSwitchContext,
  isSigningOut,
  onSignOut,
}: AccountSwitcherProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const activeOrganization =
    activeWorkspaceType === "organization"
      ? organizations.find((organization) => organization.id === activeWorkspaceId) ?? null
      : null;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <div ref={containerRef} className="relative mt-6">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 rounded-[24px] border border-white/10 bg-white/4 px-4 py-4 text-left shadow-[0_18px_40px_rgba(0,0,0,0.18)] backdrop-blur-sm transition hover:bg-white/7"

      >
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-[18px] bg-white/10">
          {activeWorkspaceType === "personal" ? (
            viewerImage ? (
              <Image
                src={viewerImage}
                alt={viewerName}
                width={48}
                height={48}
                className="h-12 w-12 object-cover"
                unoptimized={viewerImage.startsWith("data:")}
              />
            ) : (
              <span className="text-sm font-semibold text-white">
                {getInitials(viewerName)}
              </span>
            )
          ) : activeOrganization?.logo ? (
            <Image
              src={activeOrganization.logo}
              alt={activeOrganization.name}
              width={48}
              height={48}
              className="h-12 w-12 object-cover"
              unoptimized={activeOrganization.logo.startsWith("data:")}
            />
          ) : (
            <span className="text-sm font-semibold text-white">
              {getInitials(activeOrganization?.name ?? "Account")}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.68rem] uppercase tracking-[0.24em] text-white/38">
            Workspace
          </p>
          <p className="truncate text-[0.98rem] font-semibold text-white">
            {activeWorkspaceType === "personal" ? "Personal" : activeOrganization?.name ?? "No organization"}
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-white/45 transition ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen ? (
        <div className="absolute bottom-[calc(100%+1rem)] left-0 right-0 z-40 rounded-[30px] border border-white/10 bg-[#171717]/96 p-3 shadow-[0_34px_100px_rgba(0,0,0,0.58)] backdrop-blur-xl">
          <div className="px-3 pb-3 pt-2">
            <p className="text-[0.66rem] uppercase tracking-[0.28em] text-white/34">
              Workspace
            </p>
            <p className="mt-2 text-[1.02rem] font-semibold tracking-[-0.03em] text-white">
              Switch organization
            </p>
          </div>

          <div className="space-y-2">
            {/* Personal Workspace Button */}
            <button
              type="button"
              onClick={() => {
                onSwitchContext("personal", null);
              }}
              disabled={isSwitching}
              className={`flex w-full items-center gap-3 rounded-[22px] border px-4 py-3 text-left transition ${
                activeWorkspaceType === "personal"
                  ? "border-white/12 bg-white/8 text-white"
                  : "border-transparent text-white/70 hover:border-white/8 hover:bg-white/5 hover:text-white"
              }`}
            >
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[14px] bg-white/10">
                <span className="text-xs font-semibold text-white">
                  {getInitials(viewerName)}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">Personal Workspace</p>
                <p className="truncate text-[0.68rem] uppercase tracking-[0.2em] text-white/38">
                  {viewerName}
                </p>
              </div>
              {activeWorkspaceType === "personal" ? <Check className="h-4 w-4 text-white" /> : null}
            </button>

            {organizations.length > 0 && (
              <div className="my-2 h-px w-full bg-white/10" />
            )}

            {organizations.length === 0 ? (
              <div className="rounded-[22px] border border-white/6 bg-white/3 px-4 py-4 text-sm text-white/56">

                No organizations yet.
              </div>
            ) : (
              organizations.map((organization) => {
                const isActive = activeWorkspaceType === "organization" && organization.id === activeWorkspaceId;

                return (
                  <button
                    key={organization.id}
                    type="button"
                    onClick={() => {
                      onSwitchContext("organization", organization.id, organization.authOrganizationId);
                    }}
                    disabled={isSwitching}
                    className={`flex w-full items-center gap-3 rounded-[22px] border px-4 py-3 text-left transition ${
                      isActive
                        ? "border-white/12 bg-white/8 text-white"
                        : "border-transparent text-white/70 hover:border-white/8 hover:bg-white/5 hover:text-white"
                    }`}

                  >
                    <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[14px] bg-white/10">
                      {organization.logo ? (
                        <Image
                          src={organization.logo}
                          alt={organization.name}
                          width={40}
                          height={40}
                          className="h-10 w-10 object-cover"
                          unoptimized={organization.logo.startsWith("data:")}
                        />
                      ) : (
                        <span className="text-xs font-semibold text-white">
                          {getInitials(organization.name)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{organization.name}</p>
                      <p className="truncate text-[0.68rem] uppercase tracking-[0.2em] text-white/38">
                        {organization.slug}
                      </p>
                    </div>
                    {isActive ? <Check className="h-4 w-4 text-white" /> : null}
                  </button>
                );
              })
            )}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onCreateOrganization();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-[22px] bg-white px-4 py-3 text-sm font-semibold text-[#141414] transition hover:bg-white/90"
            >
              <Plus className="h-4 w-4" />
              Create organization
            </button>
            <button
              type="button"
              disabled={isSigningOut}
              onClick={async () => {
                await onSignOut();
                onClose();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-[22px] border border-white/15 bg-white/4 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"

            >
              <LogOut className="h-4 w-4" />
              {isSigningOut ? "Signing out..." : "Log out"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
