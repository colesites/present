"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { Sparkles } from "lucide-react";
import { api } from "../../../../../../packages/backend/convex/_generated/api";
import { isUnlimitedSpeechQuota } from "../../../../../../packages/shared/src/billing";
import { formatDate, formatDuration } from "./format";
import { Card, Eyebrow, buttonClass, cx } from "./ui";

/** The signed-in person's plan and what they have used of it this period. */
export const useBillingStatus = () => {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(api.billing.getMyBillingStatus, isAuthenticated ? {} : "skip");
};

export type BillingStatus = NonNullable<ReturnType<typeof useBillingStatus>>;

export function Meter({ used, total, className }: { used: number; total: number; className?: string }) {
  const fraction = total > 0 ? Math.min(1, used / total) : 0;
  return (
    <div className={cx("h-2 overflow-hidden rounded-full bg-[#eef0f5]", className)}>
      <div
        className={cx("h-full rounded-full transition-all", fraction >= 0.9 ? "bg-amber-500" : "bg-primary")}
        style={{ width: `${Math.max(fraction * 100, used > 0 ? 3 : 0)}%` }}
      />
    </div>
  );
}

/** AI projection used this period, with the plan it comes from. */
export function PlanUsageCard({ status, compact = false }: { status: BillingStatus | null | undefined; compact?: boolean }) {
  if (status === undefined) {
    return <div className="h-[168px] animate-pulse rounded-card bg-[#f3f4f8]" aria-hidden="true" />;
  }
  if (status === null) return null;
  const unlimited = isUnlimitedSpeechQuota(status.quotaSeconds);
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>Your plan</Eyebrow>
          <p className="mt-1.5 text-xl font-semibold tracking-[-0.02em]">{status.planLabel}</p>
        </div>
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" />
        </span>
      </div>
      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium">
            {status.limits.songAiProjection ? "Bible & song AI projection" : "Bible AI projection"}
          </span>
          <span className="flex-none text-[#7d8798]">
            {unlimited
              ? `${formatDuration(status.usedSeconds)} used`
              : `${formatDuration(status.usedSeconds)} of ${formatDuration(status.quotaSeconds)}`}
          </span>
        </div>
        {unlimited ? null : <Meter used={status.usedSeconds} total={status.quotaSeconds} className="mt-2" />}
        <p className="mt-2 text-[0.8rem] text-[#9aa3b2]">Renews {formatDate(status.periodEndMs, { month: "short", day: "numeric" })}</p>
      </div>
      {compact ? null : (
        <Link href="/dashboard/billing" className={cx(buttonClass("secondary", "sm"), "mt-5 w-full")}>
          {status.isPaid ? "Manage plan" : "Upgrade"}
        </Link>
      )}
    </Card>
  );
}
