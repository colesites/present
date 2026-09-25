"use client";

import Image from "next/image";
import Link from "next/link";
import {
  BookOpenText,
  CalendarRange,
  CreditCard,
  LayoutGrid,
  Library,
  LifeBuoy,
  Settings,
  UserRound,
  UsersRound,
} from "lucide-react";
import { DashboardSection, DashboardOrganizationListItem } from "../types";
import { AccountSwitcher } from "./AccountSwitcher";
import { cx } from "./ui";

export const navItems = [
  { label: "Overview", href: "/dashboard", section: "dashboard", icon: LayoutGrid },
  { label: "Services", href: "/dashboard/services", section: "services", icon: CalendarRange },
  { label: "Library", href: "/dashboard/library", section: "library", icon: Library },
  { label: "Bible", href: "/dashboard/bible", section: "bible", icon: BookOpenText },
  { label: "Members", href: "/dashboard/members", section: "members", icon: UsersRound },
  { label: "Billing", href: "/dashboard/billing", section: "billing", icon: CreditCard },
  { label: "Account", href: "/dashboard/accounts", section: "accounts", icon: UserRound },
  { label: "Settings", href: "/dashboard/settings", section: "settings", icon: Settings },
] as const satisfies ReadonlyArray<{
  label: string;
  href: string;
  section: DashboardSection;
  icon: typeof LayoutGrid;
}>;

interface DashboardSidebarProps {
  currentSection: DashboardSection;
  currentOrganization: { id: string; name: string; logo?: string } | null;
  isLoadingOrganization: boolean;
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
  onOpenHelp?: () => void;
}

/**
 * The dashboard's navigation. The same content sits beside the page on a
 * large screen and slides in as a drawer on anything smaller
 * (`DashboardFrame`).
 */
export function DashboardSidebar({
  currentSection,
  currentOrganization,
  isLoadingOrganization,
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
  onOpenHelp,
}: DashboardSidebarProps) {
  return (
    <div className="flex h-full min-h-0 flex-col text-white">
      <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2.5 px-3 py-1">
        <Image src="/present-mark.svg" alt="" width={26} height={26} className="h-[26px] w-[26px]" />
        <span className="text-[1.05rem] font-semibold tracking-[-0.02em]">Present</span>
      </Link>

      <nav className="mt-8 min-h-0 flex-1 overflow-y-auto" aria-label="Dashboard">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const active = item.section === currentSection;
            return (
              <li key={item.label}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex items-center gap-3 rounded-[10px] px-3 py-2 text-[0.92rem] transition-colors",
                    active ? "bg-white/[0.09] font-medium text-white" : "text-white/55 hover:bg-white/[0.04] hover:text-white/90",
                  )}
                >
                  <item.icon className={cx("h-[17px] w-[17px] flex-none", active ? "text-white" : "text-white/45")} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {onOpenHelp ? (
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            onOpenHelp();
          }}
          className="mt-4 flex items-center gap-3 rounded-[10px] px-3 py-2 text-[0.92rem] text-white/55 transition-colors hover:bg-white/[0.04] hover:text-white/90"
        >
          <LifeBuoy className="h-[17px] w-[17px] flex-none text-white/45" strokeWidth={1.8} />
          Help
        </button>
      ) : null}

      <div className="pt-4">
        <AccountSwitcher
          currentOrganization={currentOrganization}
          isLoading={isLoadingOrganization}
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
