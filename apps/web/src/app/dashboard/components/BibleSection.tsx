"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useDashboard } from "./DashboardShell";
import { PlanUsageCard, useBillingStatus } from "./usage";
import { Card, EmptyState, List, Page, PageHeader, SectionTitle, SkeletonRows } from "./ui";

/** "Matthew 3:2 AMPC" as its reference and its translation. */
const splitReference = (label: string) => {
  const match = label.trim().match(/^(.*\d)\s+([A-Z][A-Z0-9]{1,7})$/);
  return match ? { reference: match[1], translation: match[2] } : { reference: label.trim(), translation: null };
};

/**
 * Scripture in Present: what the workspace's services put on screen, and the
 * AI projection that finds a verse as it's read. The Bibles themselves are
 * imported on each computer, so they aren't listed here.
 */
export function BibleSection() {
  const { services } = useDashboard();
  const billing = useBillingStatus();

  const passages = useMemo(() => {
    if (!services) return null;
    const byReference = new Map<string, { reference: string; translation: string | null; services: string[] }>();
    for (const service of [...services].sort((a, b) => (b.order ?? 0) - (a.order ?? 0))) {
      if (service.archivedAt) continue;
      for (const item of service.items) {
        if (item.type !== "scripture") continue;
        const label = item.label?.trim() || item.refId;
        const existing = byReference.get(label);
        if (existing) {
          if (!existing.services.includes(service.name)) existing.services.push(service.name);
        } else {
          byReference.set(label, { ...splitReference(label), services: [service.name] });
        }
      }
    }
    return [...byReference.values()];
  }, [services]);

  const translations = useMemo(() => {
    const counts = new Map<string, number>();
    for (const passage of passages ?? []) {
      if (passage.translation) counts.set(passage.translation, (counts.get(passage.translation) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [passages]);

  return (
    <Page wide>
      <PageHeader title="Bible" description="The scripture your services put on screen, and the AI that finds each verse as it's read." />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0">
          <SectionTitle
            aside={
              passages && passages.length > 0 ? (
                <span className="text-sm text-[#9aa1b1]">
                  {passages.length} {passages.length === 1 ? "passage" : "passages"}
                </span>
              ) : null
            }
          >
            In your services
          </SectionTitle>
          {!passages ? (
            <SkeletonRows rows={5} />
          ) : passages.length === 0 ? (
            <EmptyState title="No scripture in a service yet">
              Verses you add to a service in the desktop app are listed here.
            </EmptyState>
          ) : (
            <>
              {translations.length > 0 ? (
                <p className="mb-3 text-sm text-[#6b7285]">
                  {translations.map(([code, count], index) => (
                    <span key={code}>
                      {index > 0 ? " · " : ""}
                      <span className="font-medium text-[#1d2240]">{code}</span> {count}
                    </span>
                  ))}
                </p>
              ) : null}
              <List>
                {passages.map((passage) => (
                  <li key={`${passage.reference}:${passage.translation}`} className="flex items-center gap-4 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{passage.reference}</span>
                      <span className="block truncate text-sm text-[#9aa1b1]">{passage.services.join(", ")}</span>
                    </span>
                    {passage.translation ? <span className="flex-none text-sm text-[#6b7285]">{passage.translation}</span> : null}
                  </li>
                ))}
              </List>
            </>
          )}
        </section>

        <aside className="space-y-8">
          <section>
            <SectionTitle>AI projection</SectionTitle>
            <PlanUsageCard status={billing} />
          </section>
          <section>
            <SectionTitle>How it works</SectionTitle>
            <Card>
              <ol className="list-decimal space-y-3 pl-4 text-sm leading-6 text-[#6b7285] marker:text-[#9aa1b1]">
                <li>Import the translations your church is licensed to use in the desktop app&apos;s Scripture panel. They stay on that computer and work offline.</li>
                <li>Turn on the Bible agent. It listens through your microphone or sound desk and finds each verse as it&apos;s read.</li>
                <li>The verse goes on screen in your scripture style. When it isn&apos;t sure, it asks the operator first.</li>
              </ol>
              {billing && !billing.limits.songAiProjection ? (
                <p className="mt-4 border-t border-[#eff0f4] pt-4 text-sm text-[#6b7285]">
                  On Pro and Power, AI projection finds songs from your library by voice too.{" "}
                  <Link href="/dashboard/billing" className="font-medium text-primary hover:underline">
                    See plans
                  </Link>
                </p>
              ) : null}
            </Card>
          </section>
        </aside>
      </div>
    </Page>
  );
}
