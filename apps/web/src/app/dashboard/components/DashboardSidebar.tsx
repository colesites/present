"use client";

import Image from "next/image";
import Link from "next/link";
import {
  BookOpenText,
  CalendarRange,
  CreditCard,
  LayoutDashboard,
  Library,
  Settings,
  UserRoundCog,
} from "lucide-react";
import {
  DashboardSection,
  DashboardOrganizationListItem,
  getInitials,
} from "../types";
import { AccountSwitcher } from "./AccountSwitcher";

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
}

const navItems = [
  { label: "Dashboard", href: "/dashboard", section: "dashboard", icon: LayoutDashboard },
  { label: "Services", href: "/dashboard/services", section: "services", icon: CalendarRange },
  { label: "Library", href: "/dashboard/library", section: "library", icon: Library },
  { label: "Bible", href: "/dashboard/bible", section: "bible", icon: BookOpenText },
  { label: "Pricing", href: "/pricing", section: "pricing", icon: CreditCard },
  { label: "Accounts", href: "/dashboard/accounts", section: "accounts", icon: UserRoundCog },
  { label: "Settings", href: "/dashboard/settings", section: "settings", icon: Settings },
] as const satisfies ReadonlyArray<{
  label: string;
  href: string;
  section: DashboardSection;
  icon: typeof LayoutDashboard;
}>;

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
}: DashboardSidebarProps) {
  return (
    <aside className="flex h-full w-[320px] flex-none flex-col overflow-hidden px-8 py-14 text-white">
      <div>
        <button
          type="button"
          onClick={onToggleAccountSwitcher}
          className="inline-flex transition hover:opacity-80"
        >
          <div className="flex h-[78px] w-[78px] items-center justify-center overflow-hidden rounded-[18px] bg-white/10">
            {currentOrganization?.logo ? (
              currentOrganization.logo.startsWith("data:") ? (
                <Image
                  src={currentOrganization.logo}
                  alt={currentOrganization.name}
                  width={78}
                  height={78}
                  className="h-[78px] w-[78px] object-cover"
                  unoptimized
                />
              ) : (
                <Image
                  src={currentOrganization.logo}
                  alt={currentOrganization.name}
                  width={78}
                  height={78}
                  className="h-[78px] w-[78px] object-cover"
                />
              )
            ) : (
              <span className="text-[1.55rem] font-semibold text-white">
                {getInitials(currentOrganization?.name ?? "Org")}
              </span>
            )}
          </div>
        </button>
      </div>

      <div className="mt-24 flex-1">
        <ul className="space-y-4">
          {navItems.map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                className={`flex w-full items-center gap-3 py-1.5 text-left text-[1.2rem] font-semibold tracking-[-0.045em] transition ${
                  item.section === currentSection
                    ? "text-white"
                    : "text-white/42 hover:text-white"
                }`}
              >
                <item.icon className="h-[1.05rem] w-[1.05rem] flex-none" />
                <span>{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto pt-8">
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
    </aside>
  );
}
