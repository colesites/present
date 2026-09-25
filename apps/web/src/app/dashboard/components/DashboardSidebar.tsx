"use client";

import Link from "next/link";
import {
  BookOpenText,
  CalendarRange,
  CreditCard,
  LayoutDashboard,
  Library,
  Settings,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import { DashboardSection, DashboardOrganizationListItem } from "../types";
import { AccountSwitcher } from "./AccountSwitcher";
import { Avatar, cx } from "./ui";

export const navItems = [
  { label: "Dashboard", href: "/dashboard", section: "dashboard", icon: LayoutDashboard },
  { label: "Services", href: "/dashboard/services", section: "services", icon: CalendarRange },
  { label: "Library", href: "/dashboard/library", section: "library", icon: Library },
  { label: "Bible", href: "/dashboard/bible", section: "bible", icon: BookOpenText },
  { label: "Members", href: "/dashboard/members", section: "members", icon: UsersRound },
  { label: "Billing", href: "/dashboard/billing", section: "billing", icon: CreditCard },
  { label: "Account", href: "/dashboard/accounts", section: "accounts", icon: UserRoundCog },
  { label: "Settings", href: "/dashboard/settings", section: "settings", icon: Settings },
] as const satisfies ReadonlyArray<{
  label: string;
  href: string;
  section: DashboardSection;
  icon: typeof LayoutDashboard;
}>;

interface DashboardSidebarProps {
  currentSection: DashboardSection;
  currentOrganization: { id: string; name: string; logo?: string } | null;
  organizations: DashboardOrganizationListItem[];
  activeWorkspaceId: string | null;
  isAccountSwitcherOpen: boolean;
  isSwitchingWorkspace: boolean;
  isSigningOut: boolean;
  onToggleAccountSwitcher: () => void;
  onCloseAccountSwitcher: () => void;
  onCreateOrganization: () => void;
  onSwitchContext: (id: string) => void;
  onSignOut: () => void;
  /** Called when a link is followed, so the phone drawer can close. */
  onNavigate?: () => void;
}

/**
 * The dashboard's navigation. The same content sits beside the page on a
 * large screen and slides in as a drawer on anything smaller
 * (`DashboardClient`).
 */
export function DashboardSidebar({
  currentSection,
  currentOrganization,
  organizations,
  activeWorkspaceId,
  isAccountSwitcherOpen,
  isSwitchingWorkspace,
  isSigningOut,
  onToggleAccountSwitcher,
  onCloseAccountSwitcher,
  onCreateOrganization,
  onSwitchContext,
  onSignOut,
  onNavigate,
}: DashboardSidebarProps) {
  return (
    <div className="flex h-full min-h-0 flex-col text-white">
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="flex items-center gap-3 rounded-card px-2 py-1.5 transition hover:bg-white/[0.04]"
      >
        <Avatar
          src={currentOrganization?.logo}
          name={currentOrganization?.name ?? "Present"}
          size={44}
          shape="tile"
        />
        <div className="min-w-0">
          <p className="truncate text-[0.95rem] font-semibold">{currentOrganization?.name ?? "Present"}</p>
          <p className="text-xs text-white/45">Present dashboard</p>
        </div>
      </Link>

      <nav className="mt-8 min-h-0 flex-1 overflow-y-auto" aria-label="Dashboard">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const active = item.section === currentSection;
            return (
              <li key={item.label}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex items-center gap-3 rounded-control px-3 py-2.5 text-[0.95rem] font-medium transition",
                    active ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/[0.05] hover:text-white",
                  )}
                >
                  <item.icon className="h-[18px] w-[18px] flex-none" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="pt-6">
        <AccountSwitcher
          currentOrganization={currentOrganization}
          organizations={organizations}
          activeWorkspaceId={activeWorkspaceId}
          isOpen={isAccountSwitcherOpen}
          isSwitching={isSwitchingWorkspace}
          onToggle={onToggleAccountSwitcher}
          onClose={onCloseAccountSwitcher}
          onCreateOrganization={onCreateOrganization}
          onSwitchContext={onSwitchContext}
          isSigningOut={isSigningOut}
          onSignOut={onSignOut}
        />
      </div>
    </div>
  );
}
