"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  BookOpenText,
  CalendarRange,
  LayoutDashboard,
  Library,
  LogOut,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { DashboardOrganization, DashboardSection, DashboardLibraryItem } from "../types";

interface DashboardSectionViewProps {
  section: Exclude<DashboardSection, "dashboard">;
  currentOrg: DashboardOrganization | null;
  libraryItems: DashboardLibraryItem[];
  servicesCount: number;
}

const sectionConfig: Record<
  Exclude<DashboardSection, "dashboard">,
  {
    title: string;
    eyebrow: string;
    description: string;
    focusTitle: string;
    actionDescription: string;
    icon: typeof CalendarRange;
    summary: string[];
  }
> = {
  services: {
    title: "Services",
    eyebrow: "Planning",
    description:
      "Build service runs, cue lists, and presenter flows for the active organization.",
    focusTitle: "Service planning, schedules, and presentation flow",
    actionDescription:
      "Manage upcoming service flow, organize priorities, and keep your team aligned around the selected workspace.",
    icon: CalendarRange,
    summary: [
      "Create and manage service plans for the active workspace.",
      "Track upcoming sets, transitions, and presentation flow.",
      "Switch organization in the sidebar footer to view another workspace.",
    ],
  },
  library: {
    title: "Library",
    eyebrow: "Content",
    description:
      "Songs, slides, and presentation content for the active workspace live here.",
    focusTitle: "Content management and workspace media context",
    actionDescription:
      "Keep songs, slides, and reusable assets organized under one active organization with consistent content ownership.",
    icon: Library,
    summary: [
      "Manage songs and slide content from one organized workspace.",
      "The active organization controls the visible library context.",
      "Library updates become immediately available to your presentation team.",
    ],
  },
  bible: {
    title: "Bible",
    eyebrow: "Scripture",
    description:
      "Manage Bible integrations, translation access, and scripture presentation setup.",
    focusTitle: "Scripture access, translation setup, and presentation options",
    actionDescription:
      "Configure scripture tools and translation access per organization so every team uses the right Bible data.",
    icon: BookOpenText,
    summary: [
      "Connect Bible sources for the active organization.",
      "Translation permissions are scoped to the selected workspace.",
      "Scripture presentation settings stay consistent per team context.",
    ],
  },
  accounts: {
    title: "Accounts",
    eyebrow: "Access",
    description:
      "Review account access and manage workspace context from the organization switcher.",
    focusTitle: "User context, workspace switching, and account actions",
    actionDescription:
      "Use the account dropdown in the sidebar footer to switch organizations, create workspaces, or sign out quickly.",
    icon: ShieldCheck,
    summary: [
      "Your signed-in user stays constant while workspace context changes.",
      "Organization switching happens from the sidebar account dropdown.",
      "Workspace data updates immediately after changing organization.",
    ],
  },
  settings: {
    title: "Settings",
    eyebrow: "Configuration",
    description:
      "Organization branding, workspace preferences, and app configuration will live here.",
    focusTitle: "Workspace configuration, preferences, and security",
    actionDescription:
      "Control workspace-level configuration and account session actions from a single place with clear ownership.",
    icon: Settings,
    summary: [
      "Branding and organization settings belong to the selected workspace.",
      "Configuration changes apply only to the active organization.",
      "Sign out is available here and inside the account dropdown menu.",
    ],
  },
};

export function DashboardSectionView({
  section,
  currentOrg,
  libraryItems,
  servicesCount,
}: DashboardSectionViewProps) {
  const config = sectionConfig[section];
  const Icon = config.icon;
  const hasOrganization = Boolean(currentOrg);

  return (
    <div className="flex min-h-full flex-col text-[#232946] xl:items-start xl:flex-row">
      <section className="min-w-0 flex-1 px-18 py-14">
        <div className="flex items-start justify-between gap-8">
          <div className="max-w-3xl">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.34em] text-primary/65">
              {config.eyebrow}
            </p>
            <h1 className="mt-5 text-[4.1rem] font-semibold leading-none tracking-[-0.07em] text-[#232946]">
              {config.title}
            </h1>
            <p className="mt-5 text-[1.08rem] leading-7 text-[#7d8798]">
              {config.description}
            </p>
          </div>

          <div className="rounded-[24px] border border-primary/10 bg-primary/5 px-6 py-5 text-right">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-primary/60">
              Active organization
            </p>
            <p className="mt-3 text-[1.25rem] font-semibold tracking-[-0.04em] text-[#232946]">
              {currentOrg?.name ?? "No organization"}
            </p>
          </div>
        </div>

        <div className="mt-14 rounded-[34px] border border-primary/10 bg-primary/4 px-8 py-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.32em] text-primary/65">
                Workspace focus
              </p>
              <h2 className="mt-4 text-[2.2rem] font-semibold tracking-[-0.06em] text-[#232946]">
                {config.focusTitle}
              </h2>
              <p className="mt-4 max-w-xl text-[1rem] leading-7 text-[#7d8798]">
                {config.actionDescription}
              </p>
            </div>

            <div className="rounded-[24px] border border-primary/10 bg-white px-5 py-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <p className="mt-3 text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-primary/60">
                Module
              </p>
              <p className="mt-2 text-[1.15rem] font-semibold tracking-[-0.04em] text-[#232946]">
                {config.title}
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-[24px] border border-primary/10 bg-white px-5 py-5">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-primary/60">
                Status
              </p>
              <p className="mt-4 text-[1.6rem] font-semibold leading-none tracking-[-0.05em] text-[#232946]">
                {hasOrganization ? "Ready" : "Setup"}
              </p>
              <p className="mt-4 text-[0.95rem] text-[#7f8898]">
                {hasOrganization
                  ? "Workspace is connected and ready for updates."
                  : "Create an organization from the sidebar dropdown."}
              </p>
            </div>
            <div className="rounded-[24px] border border-primary/10 bg-white px-5 py-5">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-primary/60">
                Library
              </p>
              <p className="mt-4 text-[2.55rem] font-semibold leading-none tracking-[-0.08em] text-[#232946]">
                {libraryItems.length}
              </p>
              <p className="mt-4 text-[0.95rem] text-[#7f8898]">
                Total items available in this organization.
              </p>
            </div>
            <div className="rounded-[24px] border border-primary/10 bg-white px-5 py-5">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-primary/60">
                Services
              </p>
              <p className="mt-4 text-[2.55rem] font-semibold leading-none tracking-[-0.08em] text-[#232946]">
                {servicesCount}
              </p>
              <p className="mt-4 text-[0.95rem] text-[#7f8898]">
                Total services in this workspace.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-14">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-[2rem] font-semibold tracking-[-0.04em] text-[#232946]">
              {config.title} priorities
            </h3>
            <span className="rounded-full bg-primary/8 px-4 py-2 text-sm font-medium text-primary">
              {config.summary.length} items
            </span>
          </div>

          <div className="mt-4 divide-y divide-[#efefef] border-t border-[#efefef]">
            {config.summary.map((item, index) => (
              <div key={item} className="flex items-start gap-4 py-6">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <LayoutDashboard className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[1.08rem] font-semibold text-[#232946]">
                    Priority {index + 1}
                  </p>
                  <p className="mt-1 text-[1rem] leading-7 text-[#7f8898]">{item}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="border-t border-[#f2f2f2] bg-[#fbfbfb] px-10 py-14 xl:w-[365px] xl:flex-none xl:self-start xl:border-l xl:border-t-0">
        <h3 className="text-[2rem] font-semibold tracking-[-0.05em] text-[#232946]">
          Workspace summary
        </h3>

        <div className="mt-12 space-y-4">
          <div className="rounded-[24px] border border-primary/10 bg-white px-5 py-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.26em] text-primary/60">
                    Module
                  </p>
                  <p className="mt-1 text-[0.98rem] text-[#7f8898]">
                    Active section in workspace
                  </p>
                </div>
              </div>
              <span className="text-[1rem] font-semibold tracking-[-0.03em] text-[#232946]">
                {config.title}
              </span>
            </div>
          </div>

          <div className="rounded-[24px] border border-primary/10 bg-white px-5 py-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-primary/10 text-primary">
                   <Library className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.26em] text-primary/60">
                    Library
                  </p>
                  <p className="mt-1 text-[0.98rem] text-[#7f8898]">
                    Content visible in this workspace
                  </p>
                </div>
              </div>
              <span className="text-[1.45rem] font-semibold tracking-[-0.05em] text-[#232946]">
                {libraryItems.length}
              </span>
            </div>
          </div>

          <div className="rounded-[24px] border border-primary/10 bg-white px-5 py-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-primary/10 text-primary">
                  <LayoutDashboard className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-primary/60">
                    Status
                  </p>
                  <p className="mt-1 text-[0.98rem] text-[#7f8898]">
                    Workspace readiness
                  </p>
                </div>
              </div>
              <span className="text-[1rem] font-semibold tracking-[-0.03em] text-[#232946]">
                {hasOrganization ? "Ready" : "Setup"}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-10 rounded-[28px] border border-primary/10 bg-white px-6 py-6">
          <div className="space-y-5">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.3em] text-primary/60">
              Actions
            </p>
            <div className="space-y-3">
              <p className="text-[1.55rem] font-semibold tracking-[-0.05em] text-[#232946]">
                Manage {config.title.toLowerCase()}
              </p>
              <p className="text-[0.98rem] leading-7 text-[#7f8898]">
                Use the sidebar account dropdown to switch organizations and keep this section in sync.
              </p>
            </div>
          </div>

          <div className="mt-8 space-y-3">
            <Link
              href="/dashboard"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-92"
            >
              Back to dashboard
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
