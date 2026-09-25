"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Search } from "lucide-react";
import type { DashboardOrganization, DashboardServiceItem } from "../types";
import { DateTile } from "./DashboardOverview";
import { formatDate, parseServiceDate } from "./format";
import { EmptyState, Page, PageHeader, SectionTitle, SkeletonRows, cx, fieldClass } from "./ui";

const ITEM_KINDS: Record<string, string> = {
  library: "song",
  scripture: "scripture",
  media: "media",
  presentation: "presentation",
};

/** "3 songs, 1 scripture, 2 media". */
const describeItems = (items: DashboardServiceItem["items"]) => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const kind = ITEM_KINDS[item.type];
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  if (counts.size === 0) return "Empty";
  return [...counts]
    .map(([kind, count]) => `${count} ${kind}${count === 1 || kind === "media" || kind === "scripture" ? "" : "s"}`)
    .join(", ");
};

/**
 * The workspace's services, as the desktop app plans them. Read-only here:
 * a service is built and run in the app, and this is where the team sees
 * what is coming.
 */
export function ServicesSection({
  currentOrg,
  services,
}: {
  currentOrg: DashboardOrganization | null;
  services: DashboardServiceItem[] | undefined;
}) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    if (!services) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const needle = query.trim().toLowerCase();
    const entries = services
      .filter((service) => !needle || service.name.toLowerCase().includes(needle))
      .map((service) => ({ service, date: parseServiceDate(service.date) }));
    const time = (entry: (typeof entries)[number]) => entry.date?.getTime() ?? entry.service.createdAt;
    return {
      upcoming: entries.filter((entry) => entry.date && entry.date >= today).sort((a, b) => time(a) - time(b)),
      past: entries.filter((entry) => !entry.date || entry.date < today).sort((a, b) => time(b) - time(a)),
    };
  }, [query, services]);

  return (
    <Page>
      <PageHeader
        eyebrow="Planning"
        title="Services"
        description={`Every service planned in ${currentOrg?.name ?? "your workspace"}. Build and run them in the desktop app.`}
      />

      <div className="relative mt-8">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa3b2]" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search services"
          className={cx(fieldClass, "pl-10")}
          aria-label="Search services"
        />
      </div>

      <div className="mt-8 space-y-8">
        {!groups ? (
          <SkeletonRows rows={4} height="h-[72px]" />
        ) : groups.upcoming.length + groups.past.length === 0 ? (
          <EmptyState icon={CalendarRange} title={query ? "No services match" : "No services yet"}>
            {query ? "Try another name." : "Create a service in the desktop app and it appears here."}
          </EmptyState>
        ) : (
          <>
            {groups.upcoming.length > 0 ? <ServiceList title="Coming up" entries={groups.upcoming} /> : null}
            {groups.past.length > 0 ? <ServiceList title="Earlier" entries={groups.past} /> : null}
          </>
        )}
      </div>
    </Page>
  );
}

function ServiceList({
  title,
  entries,
}: {
  title: string;
  entries: Array<{ service: DashboardServiceItem; date: Date | null }>;
}) {
  return (
    <section>
      <SectionTitle aside={<span className="text-sm text-[#9aa3b2]">{entries.length}</span>}>{title}</SectionTitle>
      <ul className="mt-3 divide-y divide-[#f0f1f5] rounded-card border border-[#ececf2]">
        {entries.map(({ service, date }) => (
          <li key={service._id} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
            <DateTile date={date} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{service.name}</p>
              <p className="truncate text-sm text-[#9aa3b2]">{describeItems(service.items)}</p>
            </div>
            <p className="hidden flex-none text-sm text-[#7d8798] sm:block">
              {date ? formatDate(date, { weekday: "short", month: "short", day: "numeric" }) : "No date"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
