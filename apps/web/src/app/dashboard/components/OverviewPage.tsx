"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { ArrowUpRight, Plus } from "lucide-react";
import { api } from "../../../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../../../packages/backend/convex/_generated/dataModel";
import { isUnlimitedSpeechQuota } from "../../../../../../packages/shared/src/billing";
import type { DashboardLibraryItem, DashboardServiceItem } from "../types";
import { useDashboard } from "./DashboardShell";
import { formatDuration, formatRelative, parseServiceDate } from "./format";
import { describeEntry, serviceRows, type IndexedEntry } from "./service-order";
import { useMembers } from "./use-members";
import { Meter, useBillingStatus } from "./usage";
import { Avatar, Button, Card, List, Page, PageHeader, SectionTitle, Skeleton, SkeletonRows, buttonClass, cx } from "./ui";

const startOfToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

/** "Today", "Tomorrow", "In 5 days", "In 3 weeks". */
const untilText = (date: Date) => {
  const days = Math.round((date.getTime() - startOfToday().getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 14) return `In ${days} days`;
  return `In ${Math.round(days / 7)} weeks`;
};

/** The first line someone would recognise a song by. */
export const firstLyric = (item: DashboardLibraryItem) =>
  item.slides
    .map((slide) => slide.text?.split("\n").find((line) => line.trim() && !/^\[.*\]$/.test(line.trim())))
    .find(Boolean)
    ?.trim() ?? "";

/** Services on or after today, soonest first. */
const upcoming = (services: DashboardServiceItem[]) => {
  const today = startOfToday();
  return services
    .filter((service) => !service.archivedAt)
    .map((service) => ({ service, date: parseServiceDate(service.date) }))
    .filter((entry): entry is { service: DashboardServiceItem; date: Date } => Boolean(entry.date && entry.date >= today))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
};

export function OverviewPage({ shouldAutoOpen }: { shouldAutoOpen: boolean }) {
  const { currentOrg, libraryItems, services, openDesktopApp } = useDashboard();
  const { isAuthenticated } = useConvexAuth();
  const billing = useBillingStatus();
  const { members } = useMembers(currentOrg?.id);
  const invitations = useQuery(
    api.invites.listForWorkspace,
    isAuthenticated && currentOrg ? { orgId: currentOrg.id as Id<"organizations"> } : "skip",
  );

  // Signing in from the desktop app lands here with ?setup=1 to hand back to it.
  useEffect(() => {
    if (!shouldAutoOpen) return;
    const timeout = window.setTimeout(openDesktopApp, 1200);
    return () => window.clearTimeout(timeout);
  }, [openDesktopApp, shouldAutoOpen]);

  const libraryById = useMemo(() => new Map((libraryItems ?? []).map((item) => [item._id, item])), [libraryItems]);
  const schedule = useMemo(() => (services ? upcoming(services) : null), [services]);
  // The next dated service; without one, the top of the list as the desktop
  // app orders it, since services there often have no date.
  const next = useMemo(() => {
    if (!services || !schedule) return null;
    if (schedule[0]) return schedule[0];
    const first = [...services].filter((service) => !service.archivedAt).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
    return first ? { service: first, date: null } : null;
  }, [schedule, services]);
  const later = next?.date ? (schedule?.slice(1, 6) ?? []) : [];

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const summary = [
    libraryItems ? `${libraryItems.length} ${libraryItems.length === 1 ? "song" : "songs"}` : null,
    services ? `${services.filter((service) => !service.archivedAt).length} ${services.length === 1 ? "service" : "services"}` : null,
    members ? `${members.length} ${members.length === 1 ? "person" : "people"}` : null,
  ].filter(Boolean);

  return (
    <Page wide>
      <PageHeader
        title={currentOrg?.name ?? <Skeleton className="h-8 w-64" />}
        description={
          <span>
            {today}
            {summary.length > 0 ? <span className="text-[#9aa1b1]"> · {summary.join(" · ")}</span> : null}
          </span>
        }
        actions={
          <>
            <Link href="/dashboard/services?new=1" className={buttonClass("primary")}>
              <Plus className="h-4 w-4" /> New service
            </Link>
            <Button variant="outline" onClick={openDesktopApp}>
              Open app <ArrowUpRight className="h-4 w-4" />
            </Button>
          </>
        }
      />

      {shouldAutoOpen ? <p className="mt-4 text-sm text-[#6b7285]">Opening Present on this computer…</p> : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-8">
          <section>
            <SectionTitle
              aside={
                <Link href="/dashboard/services" className="text-sm font-medium text-primary hover:underline">
                  All services
                </Link>
              }
            >
              {next && !next.date ? "Services" : "Next service"}
            </SectionTitle>
            {!schedule ? (
              <Card padded={false}>
                <div className="p-5">
                  <Skeleton className="h-5 w-56" />
                  <Skeleton className="mt-2 h-3.5 w-32" />
                </div>
                <div className="border-t border-[#eff0f4] p-5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="mt-3 h-3.5 w-1/2" />
                </div>
              </Card>
            ) : next ? (
              <NextService service={next.service} date={next.date} libraryById={libraryById} />
            ) : (
              <Card>
                <p className="font-medium">Nothing planned yet</p>
                <p className="mt-1 text-sm text-[#6b7285]">Plan the next service here or in the desktop app, and your team will see it.</p>
                <Link href="/dashboard/services?new=1" className={cx(buttonClass("outline", "sm"), "mt-4")}>
                  Plan a service
                </Link>
              </Card>
            )}
          </section>

          {later.length > 0 ? (
            <section>
              <SectionTitle>After that</SectionTitle>
              <List>
                {later.map(({ service, date }) => (
                  <li key={service._id}>
                    <Link href={`/dashboard/services/${service._id}`} className="flex items-center gap-4 px-4 py-3 transition hover:bg-[#fafbfc]">
                      <span className="w-24 flex-none text-sm tabular-nums text-[#6b7285]">
                        {date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{service.name}</span>
                      <span className="flex-none text-sm text-[#9aa1b1]">
                        {service.items.length} {service.items.length === 1 ? "item" : "items"}
                      </span>
                    </Link>
                  </li>
                ))}
              </List>
            </section>
          ) : null}

          <section>
            <SectionTitle
              aside={
                <Link href="/dashboard/library" className="text-sm font-medium text-primary hover:underline">
                  Library
                </Link>
              }
            >
              Recently edited
            </SectionTitle>
            {!libraryItems ? (
              <SkeletonRows rows={4} />
            ) : libraryItems.length === 0 ? (
              <Card>
                <p className="font-medium">No songs yet</p>
                <p className="mt-1 text-sm text-[#6b7285]">Add the songs your team sings, and they&apos;re ready in the app.</p>
                <Link href="/dashboard/library/new" className={cx(buttonClass("outline", "sm"), "mt-4")}>
                  Add a song
                </Link>
              </Card>
            ) : (
              <List>
                {libraryItems.slice(0, 6).map((item) => (
                  <li key={item._id}>
                    <Link href={`/dashboard/library/${item._id}`} className="flex items-center gap-4 px-4 py-3 transition hover:bg-[#fafbfc]">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.title}</span>
                        <span className="block truncate text-sm text-[#9aa1b1]">{firstLyric(item) || `${item.slides.length} slides`}</span>
                      </span>
                      <span className="flex-none text-sm text-[#9aa1b1]">{formatRelative(item.updatedAt ?? item._creationTime)}</span>
                    </Link>
                  </li>
                ))}
              </List>
            )}
          </section>
        </div>

        <aside className="space-y-8">
          <section>
            <SectionTitle
              aside={
                <Link href="/dashboard/members" className="text-sm font-medium text-primary hover:underline">
                  {invitations ? "Invite" : "Members"}
                </Link>
              }
            >
              Team
            </SectionTitle>
            <Card>
              {!members ? (
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((index) => (
                    <Skeleton key={index} className="h-8 w-8 rounded-full" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="flex -space-x-2">
                    {members.slice(0, 6).map((member) => (
                      <span key={member.userId} className="rounded-full ring-2 ring-white" title={member.name ?? member.email ?? ""}>
                        <Avatar src={member.imageUrl} name={member.name ?? member.email ?? "?"} size={32} />
                      </span>
                    ))}
                    {members.length > 6 ? (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f1f2f6] text-xs font-medium text-[#6b7285] ring-2 ring-white">
                        +{members.length - 6}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm text-[#6b7285]">
                    {members.length} {members.length === 1 ? "person" : "people"}
                    {invitations && invitations.invites.length > 0
                      ? `, ${invitations.invites.length} ${invitations.invites.length === 1 ? "invitation" : "invitations"} waiting`
                      : ""}
                    {invitations ? ` · ${invitations.seats.limit} on ${invitations.seats.planLabel}` : ""}
                  </p>
                </>
              )}
            </Card>
          </section>

          <section>
            <SectionTitle
              aside={
                <Link href="/dashboard/billing" className="text-sm font-medium text-primary hover:underline">
                  Billing
                </Link>
              }
            >
              This month
            </SectionTitle>
            <Card>
              {!billing ? (
                <>
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="mt-3 h-2 w-full" />
                </>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm">
                    <span className="font-medium">{billing.planLabel}</span>
                    <span className="text-[#9aa1b1]"> plan</span>
                  </p>
                  <UsageLine
                    label="AI projection"
                    used={formatDuration(billing.usedSeconds)}
                    total={isUnlimitedSpeechQuota(billing.quotaSeconds) ? null : formatDuration(billing.quotaSeconds)}
                    fraction={isUnlimitedSpeechQuota(billing.quotaSeconds) ? null : billing.usedSeconds / Math.max(1, billing.quotaSeconds)}
                  />
                  <UsageLine
                    label="AI lyrics fixes"
                    used={String(billing.usedLyricsFixes)}
                    total={billing.limits.monthlyLyricsFixes === null ? null : String(billing.limits.monthlyLyricsFixes)}
                    fraction={
                      billing.limits.monthlyLyricsFixes === null
                        ? null
                        : billing.usedLyricsFixes / Math.max(1, billing.limits.monthlyLyricsFixes)
                    }
                  />
                </div>
              )}
            </Card>
          </section>

          <section>
            <SectionTitle>Desktop app</SectionTitle>
            <Card>
              <p className="text-sm leading-6 text-[#6b7285]">
                Services are run from the app, and keep working without internet on the day.
              </p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" onClick={openDesktopApp}>
                  Open Present
                </Button>
                <Link href="/download" className={buttonClass("outline", "sm")}>
                  Download
                </Link>
              </div>
            </Card>
          </section>
        </aside>
      </div>
    </Page>
  );
}

function UsageLine({ label, used, total, fraction }: { label: string; used: string; total: string | null; fraction: number | null }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-[#6b7285]">{label}</span>
        <span className="tabular-nums">
          {used}
          <span className="text-[#9aa1b1]">{total ? ` of ${total}` : " · unlimited"}</span>
        </span>
      </div>
      {fraction === null ? null : <Meter used={fraction} total={1} className="mt-1.5 h-1.5" />}
    </div>
  );
}

const PREVIEW_ITEMS = 8;

function NextService({
  service,
  date,
  libraryById,
}: {
  service: DashboardServiceItem;
  date: Date | null;
  libraryById: Map<string, DashboardLibraryItem>;
}) {
  // The first few items, numbered in running order, each group named where it starts.
  const flat: Array<{ entry: IndexedEntry; number: number; groupName: string | null }> = [];
  for (const row of serviceRows(service)) {
    const entries = row.kind === "group" ? row.items : [row.item];
    entries.forEach((entry, position) => {
      flat.push({
        entry,
        number: flat.length + 1,
        groupName: row.kind === "group" && position === 0 ? row.name : null,
      });
    });
  }
  const total = flat.length;
  const preview = flat.slice(0, PREVIEW_ITEMS);

  return (
    <Card padded={false}>
      <Link href={`/dashboard/services/${service._id}`} className="flex items-center gap-5 p-5 transition hover:bg-[#fafbfc]">
        {date ? (
          <div className="w-14 flex-none text-center leading-none">
            <p className="text-[0.72rem] font-medium uppercase text-primary">{date.toLocaleDateString(undefined, { weekday: "short" })}</p>
            <p className="mt-1 text-[1.9rem] font-semibold tracking-[-0.04em]">{date.getDate()}</p>
            <p className="mt-1 text-[0.78rem] text-[#6b7285]">{date.toLocaleDateString(undefined, { month: "short" })}</p>
          </div>
        ) : null}
        <div className={cx("min-w-0 flex-1", date && "border-l border-[#eceef3] pl-5")}>
          <p className="truncate text-[1.1rem] font-semibold tracking-[-0.01em]">{service.name}</p>
          <p className="mt-0.5 text-sm text-[#6b7285]">
            {date ? untilText(date) : "No date set"} · {total} {total === 1 ? "item" : "items"}
          </p>
        </div>
      </Link>
      {total === 0 ? (
        <p className="border-t border-[#eff0f4] px-5 py-4 text-sm text-[#6b7285]">
          Nothing in it yet.{" "}
          <Link href={`/dashboard/services/${service._id}`} className="font-medium text-primary hover:underline">
            Add songs
          </Link>
        </p>
      ) : (
        <ol className="border-t border-[#eff0f4] py-1.5">
          {preview.map(({ entry, number, groupName }) => {
            const described = describeEntry(entry, libraryById);
            return (
              <li key={entry.index}>
                {groupName ? <p className="px-5 pb-1 pt-2.5 text-[0.78rem] font-medium text-[#9aa1b1]">{groupName}</p> : null}
                <div className="flex items-center gap-3 px-5 py-1.5 text-sm">
                  <span className="w-5 flex-none text-right tabular-nums text-[#9aa1b1]">{number}</span>
                  <span className={cx("min-w-0 flex-1 truncate", described.missing && "text-[#9aa1b1]")}>{described.title}</span>
                  <span className="flex-none text-[0.8rem] text-[#9aa1b1]">{described.kind}</span>
                </div>
              </li>
            );
          })}
          {total > PREVIEW_ITEMS ? (
            <li className="px-5 pb-2 pt-1.5 text-sm">
              <Link href={`/dashboard/services/${service._id}`} className="font-medium text-primary hover:underline">
                {total - PREVIEW_ITEMS} more
              </Link>
            </li>
          ) : null}
        </ol>
      )}
    </Card>
  );
}
