"use client";

import { CalendarClock, Cloud, Sparkles, UsersRound, Wand2 } from "lucide-react";
import { isUnlimitedSpeechQuota } from "../../../../../../packages/shared/src/billing";
import { formatBytes, formatDate, formatDuration } from "./format";
import { Meter, useBillingStatus } from "./usage";
import { Card, Eyebrow, Page, PageHeader, SkeletonRows } from "./ui";

/** Your plan, what it includes, and what you've used of it this period. */
export function BillingSection() {
  const status = useBillingStatus();

  return (
    <Page>
      <PageHeader
        eyebrow="Billing"
        title="Plan and usage"
        description="What your plan includes, how much of it you've used this period, and changing it."
      />

      <div className="mt-8 space-y-4">
        {status === undefined ? (
          <SkeletonRows rows={2} height="h-[160px]" />
        ) : status === null ? null : (
          <>
            <Card tone="soft">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <span className="flex h-12 w-12 flex-none items-center justify-center rounded-control bg-white text-primary">
                    <Sparkles className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <Eyebrow>Current plan</Eyebrow>
                    <p className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{status.planLabel}</p>
                  </div>
                </div>
                <p className="flex items-center gap-2 text-sm text-[#7d8798]">
                  <CalendarClock className="h-4 w-4" />
                  {status.isPaid ? "Renews" : "Usage resets"} {formatDate(status.periodEndMs)}
                </p>
              </div>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <UsageCard
                icon={Sparkles}
                title={status.limits.songAiProjection ? "Bible & song AI projection" : "Bible AI projection"}
                used={status.usedSeconds}
                total={isUnlimitedSpeechQuota(status.quotaSeconds) ? null : status.quotaSeconds}
                format={formatDuration}
              />
              <UsageCard
                icon={Wand2}
                title="AI lyrics fixes"
                used={status.usedLyricsFixes}
                total={status.limits.monthlyLyricsFixes}
                format={(count) => String(count)}
              />
              <Card>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-control bg-primary/10 text-primary">
                    <UsersRound className="h-5 w-5" />
                  </span>
                  <p className="font-semibold">Workspace members</p>
                </div>
                <p className="mt-4 text-sm text-[#7d8798]">Up to {status.limits.workspaceMembers} people in each workspace you manage.</p>
              </Card>
              <Card>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-control bg-primary/10 text-primary">
                    <Cloud className="h-5 w-5" />
                  </span>
                  <p className="font-semibold">Cloud storage</p>
                </div>
                <p className="mt-4 text-sm text-[#7d8798]">{formatBytes(status.limits.cloudStorageBytes)} for media synced to the cloud.</p>
              </Card>
            </div>
          </>
        )}
      </div>
    </Page>
  );
}

function UsageCard({
  icon: Icon,
  title,
  used,
  total,
  format,
}: {
  icon: typeof Sparkles;
  title: string;
  used: number;
  /** `null` for unlimited. */
  total: number | null;
  format: (value: number) => string;
}) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <p className="min-w-0 font-semibold">{title}</p>
      </div>
      <p className="mt-4 text-sm text-[#7d8798]">
        <span className="text-lg font-semibold text-[#232946]">{format(used)}</span>
        {total === null ? " used · unlimited" : ` of ${format(total)} used`}
      </p>
      {total === null ? null : <Meter used={used} total={total} className="mt-2" />}
    </Card>
  );
}
