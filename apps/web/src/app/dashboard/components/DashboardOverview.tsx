"use client";

import Link from "next/link";
import { ArrowUpRight, Building2, CalendarRange, Download, Music4 } from "lucide-react";
import { DashboardOrganization, DashboardSong } from "../types";

interface DashboardOverviewProps {
  currentOrg: DashboardOrganization | null;
  organizationsCount: number;
  songs: DashboardSong[];
  shouldAutoOpen: boolean;
  onOpenDesktopApp: () => void;
}

export function DashboardOverview({
  currentOrg,
  organizationsCount,
  songs,
  shouldAutoOpen,
  onOpenDesktopApp,
}: DashboardOverviewProps) {
  const recentSongs = songs.slice(0, 5);
  const hasOrganization = Boolean(currentOrg);
  const summaryItems = [
    {
      label: "Organizations",
      value: String(organizationsCount),
      detail: hasOrganization ? "Active workspace connected" : "No organization created",
      icon: Building2,
    },
    {
      label: "Songs",
      value: String(songs.length),
      detail: songs.length > 0 ? "Library content available" : "No songs in this workspace",
      icon: Music4,
    },
    {
      label: "Services",
      value: "0",
      detail: "No service plans yet",
      icon: CalendarRange,
    },
  ] as const;

  return (
    <div className="flex min-h-full flex-col text-[#232946] xl:items-start xl:flex-row">
      <section className="min-w-0 flex-1 px-[4.5rem] py-14">
        <div className="flex items-start justify-between gap-8">
          <div className="max-w-3xl">
            <h1 className="text-[4.1rem] font-semibold leading-none tracking-[-0.07em] text-[#232946]">
              Dashboard
            </h1>
            <p className="mt-5 text-[1.1rem] text-[#9f9f9f]">
              {currentOrg?.name ?? "No organization yet"}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={onOpenDesktopApp}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:opacity-92"
            >
              Open app
              <ArrowUpRight className="h-4 w-4" />
            </button>
            <Link
              href="/"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-primary/15 bg-primary/[0.05] px-6 text-sm font-semibold text-primary transition hover:bg-primary/[0.09]"
            >
              Download app
              <Download className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="mt-14 rounded-[34px] border border-primary/10 bg-primary/[0.04] px-8 py-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.32em] text-primary/65">
                Workspace status
              </p>
              <h2 className="mt-4 text-[2.2rem] font-semibold tracking-[-0.06em] text-[#232946]">
                {hasOrganization
                  ? "Your workspace is ready for content and services"
                  : "Create your organization to start the workspace"}
              </h2>
              <p className="mt-4 max-w-xl text-[1rem] leading-7 text-[#7d8798]">
                {hasOrganization
                  ? "This dashboard summarizes the current organization, its content state, and the next actions for the team."
                  : "Use the organization switcher in the sidebar footer to create the first workspace, then the rest of the dashboard will begin filling with real data."}
              </p>
            </div>

            <div className="rounded-[24px] border border-primary/10 bg-white px-5 py-4">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-primary/60">
                Active organization
              </p>
              <p className="mt-3 text-[1.2rem] font-semibold tracking-[-0.04em] text-[#232946]">
                {currentOrg?.name ?? "No organization"}
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {summaryItems.map((item) => (
              <div
                key={item.label}
                className="rounded-[24px] border border-primary/10 bg-white px-5 py-5"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-primary/60">
                      {item.label}
                    </p>
                    <p className="mt-4 text-[2.55rem] font-semibold leading-none tracking-[-0.08em] text-[#232946]">
                      {item.value}
                    </p>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-primary/10 text-primary">
                    <item.icon className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-4 text-[0.95rem] text-[#7f8898]">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-[2rem] font-semibold tracking-[-0.04em] text-[#232946]">
              Recent songs
            </h3>
            <span className="rounded-full bg-primary/[0.08] px-4 py-2 text-sm font-medium text-primary">
              {songs.length} total
            </span>
          </div>

          <div className="mt-4 divide-y divide-[#efefef] border-t border-[#efefef]">
            {recentSongs.length === 0 ? (
              <div className="px-1 py-10 text-[1rem] text-[#8d8d8d]">
                No songs yet. Your library summary will show up here after songs are added.
              </div>
            ) : (
              recentSongs.map((song) => (
                <div key={song._id} className="flex items-center gap-5 py-6">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Music4 className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[1.1rem] font-semibold text-[#232946]">
                      {song.title}
                    </p>
                    <p className="mt-1 text-[1rem] text-[#9b9b9b]">
                      {song.slides.length} slides
                    </p>
                  </div>
                  <p className="text-[1.2rem] font-semibold tracking-[-0.03em] text-[#232946]">
                    {new Date(song.updatedAt ?? song._creationTime).toLocaleDateString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <aside className="border-t border-[#f2f2f2] bg-[#fbfbfb] px-10 py-14 xl:w-[365px] xl:flex-none xl:self-start xl:border-l xl:border-t-0">
        <h3 className="text-[2rem] font-semibold tracking-[-0.05em] text-[#232946]">
          Workspace summary
        </h3>

        <div className="mt-12 space-y-4">
          {summaryItems.map((item) => (
            <div
              key={item.label}
              className="rounded-[24px] border border-primary/10 bg-white px-5 py-5"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-primary/10 text-primary">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.26em] text-primary/60">
                      {item.label}
                    </p>
                    <p className="mt-1 text-[0.98rem] text-[#7f8898]">{item.detail}</p>
                  </div>
                </div>
                <span className="text-[1.45rem] font-semibold tracking-[-0.05em] text-[#232946]">
                  {item.value}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-[28px] border border-primary/10 bg-white px-6 py-6">
          <div className="space-y-5">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.3em] text-primary/60">
              Desktop app
            </p>
            <div className="space-y-3">
              <p className="text-[1.55rem] font-semibold tracking-[-0.05em] text-[#232946]">
                Launch or install Present
              </p>
              <p className="text-[0.98rem] leading-7 text-[#7f8898]">
                {shouldAutoOpen
                  ? "The browser is currently handing off to the desktop app."
                  : "Open the installed desktop app or go to the site download flow if this machine still needs it."}
              </p>
            </div>
          </div>

          <div className="mt-8 space-y-3">
            <button
              type="button"
              onClick={onOpenDesktopApp}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-92"
            >
              Open app
              <ArrowUpRight className="h-4 w-4" />
            </button>
            <Link
              href="/"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-primary/15 bg-primary/[0.05] px-5 text-sm font-semibold text-primary transition hover:bg-primary/[0.09]"
            >
              Download app
              <Download className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
