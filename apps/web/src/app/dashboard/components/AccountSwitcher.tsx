"use client";

import { useEffect, useRef } from "react";
import { Check, ChevronsUpDown, LogOut, Plus } from "lucide-react";
import { DashboardOrganizationListItem } from "../types";
import { Avatar, cx } from "./ui";

interface AccountSwitcherProps {
  currentOrganization: { id: string; name: string; logo?: string } | null;
  /** No organization is known yet: show a placeholder, not "No organization". */
  isLoading?: boolean;
  organizations: DashboardOrganizationListItem[];
  activeWorkspaceId: string | null;
  isOpen: boolean;
  isSwitching: boolean;
  onToggle: () => void;
  onClose: () => void;
  onCreateOrganization: () => void;
  onSwitchContext: (id: string) => void;
  isSigningOut: boolean;
  onSignOut: () => void;
}

/** The workspace in use, and every other one this person is in. */
export function AccountSwitcher({
  currentOrganization,
  isLoading = false,
  organizations,
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

  if (isLoading && !currentOrganization) {
    return (
      <div className="flex items-center gap-3 rounded-[12px] border border-white/[0.08] p-2.5" aria-hidden="true">
        <span className="h-9 w-9 flex-none animate-pulse rounded-[9px] bg-white/10" />
        <span className="h-3.5 w-28 animate-pulse rounded bg-white/10" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 rounded-[12px] border border-white/[0.08] p-2.5 pr-3 text-left transition hover:bg-white/[0.05]"
      >
        <Avatar
          src={currentOrganization?.logo}
          name={currentOrganization?.name ?? "Organization"}
          size={36}
          shape="tile"
        />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">
          {currentOrganization?.name ?? "Choose an organization"}
        </p>
        <ChevronsUpDown className="h-4 w-4 flex-none text-white/45" />
      </button>

      {isOpen ? (
        <div className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-40 rounded-[12px] border border-white/10 bg-[#1a1a1a] p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
          <p className="px-2.5 pb-1.5 pt-1.5 text-xs text-white/40">Organizations</p>

          <div className="max-h-[min(50vh,320px)] space-y-1 overflow-y-auto">
            {organizations.length === 0 ? (
              <p className="rounded-[8px] px-2.5 py-3 text-sm text-white/55">No organizations yet.</p>
            ) : (
              organizations.map((organization) => {
                const isActive = organization.id === activeWorkspaceId;
                return (
                  <button
                    key={organization.id}
                    type="button"
                    onClick={() => onSwitchContext(organization.id)}
                    disabled={isSwitching}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left transition",
                      isActive ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Avatar src={organization.logo} name={organization.name} size={32} shape="tile" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{organization.name}</span>
                    {isActive ? <Check className="h-4 w-4 flex-none text-white" /> : null}
                  </button>
                );
              })
            )}
          </div>

          <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onCreateOrganization();
              }}
              className="flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-sm text-white/75 transition hover:bg-white/5 hover:text-white"
            >
              <Plus className="h-4 w-4" />
              Create or join an organization
            </button>
            <button
              type="button"
              disabled={isSigningOut}
              onClick={async () => {
                await onSignOut();
                onClose();
              }}
              className="flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-sm text-white/75 transition hover:bg-white/5 hover:text-white disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" />
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
