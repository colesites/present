"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { ArrowUpRight, Building2, CalendarRange, ChevronRight, Download, Library, Monitor } from "lucide-react";
import { DashboardOrganization, DashboardLibraryItem, DashboardServiceItem } from "../types";
import { formatDate, formatRelative, parseServiceDate } from "./format";
import { PlanUsageCard, useBillingStatus } from "./usage";
import { Button, Card, EmptyState, Eyebrow, Page, PageHeader, SectionTitle, SkeletonRows, StatCard, buttonClass } from "./ui";

interface DashboardOverviewProps {
  currentOrg: DashboardOrganization | null;
  organizationsCount: number;
  /** `undefined` while it loads. */
  libraryItems: DashboardLibraryItem[] | undefined;
  services: DashboardServiceItem[] | undefined;
  shouldAutoOpen: boolean;
  onOpenDesktopApp: () => void;
}

/** Services from today on, soonest first; then the latest past ones. */
const upcomingFirst = (services: DashboardServiceItem[]) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dated = services.map((service) => ({ service, date: parseServiceDate(service.date) }));
  const upcoming = dated
    .filter((entry) => entry.date && entry.date >= today)
    .sort((a, b) => a.date!.getTime() - b.date!.getTime());
  const rest = dated
    .filter((entry) => !entry.date || entry.date < today)
    .sort((a, b) => (b.date?.getTime() ?? b.service.createdAt) - (a.date?.getTime() ?? a.service.createdAt));
  return { upcoming: upcoming.length, ordered: [...upcoming, ...rest] };
};

export function DashboardOverview({
  currentOrg,
  organizationsCount,
  libraryItems,
  services,
  shouldAutoOpen,
  onOpenDesktopApp,
}: DashboardOverviewProps) {
  const { user } = useUser();
  const billing = useBillingStatus();
  const firstName = user?.firstName?.trim();
  const schedule = services ? upcomingFirst(services) : null;

  return (
    <Page wide>
      <PageHeader
        eyebrow={currentOrg?.name ?? "Personal workspace"}
        title={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        description="What your team has ready, and what is coming up."
        actions={
          <>
            <Button onClick={onOpenDesktopApp}>
              Open app <ArrowUpRight className="h-4 w-4" />
            </Button>
            <Link href="/download" className={buttonClass("secondary")}>
              Download <Download className="h-4 w-4" />
            </Link>
          </>
        }
      />

      {shouldAutoOpen ? (
        <p className="mt-6 rounded-card bg-primary/[0.06] px-4 py-3 text-sm text-primary">
          Opening Present on this computer…
        </p>
      ) : null}

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={Library}
          label="Library"
          value={libraryItems ? libraryItems.length : "–"}
          detail={libraryItems?.length === 1 ? "song or presentation" : "songs and presentations"}
        />
        <StatCard
          icon={CalendarRange}
          label="Services"
          value={services ? services.length : "–"}
          detail={schedule ? `${schedule.upcoming} coming up` : "Loading"}
        />
        <StatCard
          icon={Building2}
          label="Organizations"
          value={organizationsCount}
          detail={organizationsCount === 1 ? "workspace you're in" : "workspaces you're in"}
        />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          <section>
            <SectionTitle
              aside={
                <Link href="/dashboard/services" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  All services <ChevronRight className="h-4 w-4" />
                </Link>
              }
            >
              Services
            </SectionTitle>
            <div className="mt-3">
              {!schedule ? (
                <SkeletonRows rows={3} height="h-16" />
              ) : schedule.ordered.length === 0 ? (
                <EmptyState icon={CalendarRange} title="No services yet">
                  Plan a service in the desktop app and it shows up here for the whole team.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-[#f0f1f5] rounded-card border border-[#ececf2]">
                  {schedule.ordered.slice(0, 4).map(({ service, date }) => (
                    <li key={service._id} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
                      <DateTile date={date} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{service.name}</p>
                        <p className="text-sm text-[#9aa3b2]">
                          {service.items.length} {service.items.length === 1 ? "item" : "items"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section>
            <SectionTitle
              aside={
                <Link href="/dashboard/library" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  Library <ChevronRight className="h-4 w-4" />
                </Link>
              }
            >
              Recently edited
            </SectionTitle>
            <div className="mt-3">
              {!libraryItems ? (
                <SkeletonRows rows={4} height="h-16" />
              ) : libraryItems.length === 0 ? (
                <EmptyState icon={Library} title="Nothing in the library yet">
                  Songs and presentations you add in the desktop app appear here.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-[#f0f1f5] rounded-card border border-[#ececf2]">
                  {libraryItems.slice(0, 5).map((item) => (
                    <li key={item._id} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
                      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-primary/10 text-primary">
                        <Library className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{item.title}</p>
                        <p className="text-sm text-[#9aa3b2]">
                          {item.slides.length} {item.slides.length === 1 ? "slide" : "slides"}
                        </p>
                      </div>
                      <p className="hidden flex-none text-sm text-[#7d8798] sm:block">
                        {formatRelative(item.updatedAt ?? item._creationTime)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        <aside className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <PlanUsageCard status={billing} />
          <Card tone="soft">
            <span className="flex h-10 w-10 items-center justify-center rounded-control bg-white text-primary">
              <Monitor className="h-5 w-5" />
            </span>
            <Eyebrow className="mt-4">Desktop app</Eyebrow>
            <p className="mt-1.5 text-lg font-semibold tracking-[-0.02em]">Present runs your service</p>
            <p className="mt-2 text-sm leading-6 text-[#7d8798]">
              Everything here is edited and presented in the app, and works without internet on the day.
            </p>
            <div className="mt-5 grid gap-2">
              <Button onClick={onOpenDesktopApp} className="w-full">
                Open app <ArrowUpRight className="h-4 w-4" />
              </Button>
              <Link href="/download" className={`${buttonClass("outline")} w-full`}>
                Download for this computer
              </Link>
            </div>
          </Card>
        </aside>
      </div>
    </Page>
  );
}

function DateTile({ date }: { date: Date | null }) {
  if (!date) {
    return (
      <span className="flex h-11 w-11 flex-none items-center justify-center rounded-control bg-[#f3f4f8] text-[#9aa3b2]">
        <CalendarRange className="h-[18px] w-[18px]" />
      </span>
    );
  }
  return (
    <span className="flex h-11 w-11 flex-none flex-col items-center justify-center rounded-control bg-primary/10 leading-none text-primary" title={formatDate(date)}>
      <span className="text-[0.6rem] font-semibold uppercase tracking-wide">
        {date.toLocaleDateString(undefined, { month: "short" })}
      </span>
      <span className="mt-0.5 text-base font-semibold">{date.getDate()}</span>
    </span>
  );
}

export { DateTile };
