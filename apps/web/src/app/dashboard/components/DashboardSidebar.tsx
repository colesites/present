"use client";

import Image from "next/image";
import Link from "next/link";
import {
  BookOpenText,
  CalendarRange,
  LayoutDashboard,
  Library,
  Settings,
  UserRoundCog,
} from "lucide-react";
import {
  DashboardOrganizationListItem,
  DashboardSection,
  getInitials,
} from "../types";
import { AccountSwitcher } from "./AccountSwitcher";

interface DashboardSidebarProps {
  currentSection: DashboardSection;
  viewerName: string;
  viewerEmail: string;
  viewerImage: string | null;
  organizations: DashboardOrganizationListItem[];
  activeWorkspaceType: "personal" | "organization";
  activeWorkspaceId: string | null;
  isAccountSwitcherOpen: boolean;
  isSwitchingOrganization: boolean;
  onToggleAccountSwitcher: () => void;
  onCloseAccountSwitcher: () => void;
  onCreateOrganization: () => void;
  onSwitchContext: (type: "personal" | "organization", id: string | null, authOrgId?: string | null) => void;
  isSigningOut: boolean;
  onSignOut: () => void;
}

const navItems = [
  { label: "Dashboard", href: "/dashboard", section: "dashboard", icon: LayoutDashboard },
  { label: "Services", href: "/dashboard/services", section: "services", icon: CalendarRange },
  { label: "Library", href: "/dashboard/library", section: "library", icon: Library },
  { label: "Bible", href: "/dashboard/bible", section: "bible", icon: BookOpenText },
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
  viewerName,
  viewerEmail,
  viewerImage,
  organizations,
  activeWorkspaceType,
  activeWorkspaceId,
  isAccountSwitcherOpen,
  isSwitchingOrganization,
  onToggleAccountSwitcher,
  onCloseAccountSwitcher,
  onCreateOrganization,
  onSwitchContext,
  isSigningOut,
  onSignOut,
}: DashboardSidebarProps) {
  return (
    <aside className="flex h-full w-[320px] flex-none flex-col overflow-hidden px-8 py-14 text-white">
      <div>
        <div className="inline-flex">
          <div className="flex h-[78px] w-[78px] items-center justify-center overflow-hidden rounded-[18px] bg-white/10">
            {viewerImage ? (
              <Image
                src={viewerImage}
                alt={viewerName}
                width={78}
                height={78}
                className="h-[78px] w-[78px] object-cover"
                unoptimized={viewerImage.startsWith("data:")}
              />
            ) : (
              <span className="text-[1.55rem] font-semibold text-white">
                {getInitials(viewerName)}
              </span>
            )}
          </div>
        </div>

        <div className="mt-6 space-y-5">
          <h2 className="text-[4rem] font-semibold leading-[0.9] tracking-[-0.09em] text-white">
            {viewerName}
          </h2>
          <p className="text-[0.88rem] font-medium tracking-[-0.01em] text-white/36">
            {viewerEmail}
          </p>
        </div>
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
          viewerName={viewerName}
          viewerImage={viewerImage}
          organizations={organizations}
          activeWorkspaceType={activeWorkspaceType}
          activeWorkspaceId={activeWorkspaceId}
          isOpen={isAccountSwitcherOpen}
          isSwitching={isSwitchingOrganization}
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
