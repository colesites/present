"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../../../packages/backend/convex/_generated/api";
import { isUnlimitedSpeechQuota } from "../../../../../../packages/shared/src/billing";
import { formatDate, formatDuration } from "./format";
import { Card, Skeleton, cx } from "./ui";

/** The signed-in person's plan and what they have used of it this period. */
export const useBillingStatus = () => {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(api.billing.getMyBillingStatus, isAuthenticated ? {} : "skip");
};

export type BillingStatus = NonNullable<ReturnType<typeof useBillingStatus>>;

export function Meter({ used, total, className }: { used: number; total: number; className?: string }) {
  const fraction = total > 0 ? Math.min(1, used / total) : 0;
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-[#eef0f4]", className)}>
      <div
        className={cx("h-full rounded-full", fraction >= 0.9 ? "bg-amber-500" : "bg-primary")}
        style={{ width: `${Math.max(fraction * 100, used > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

/** AI projection used this period, with the plan it comes from. */
export function PlanUsageCard({ status }: { status: BillingStatus | null | undefined }) {
  if (status === undefined) {
    return (
      <Card>
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="mt-3 h-1.5 w-full" />
      </Card>
    );
  }
  if (status === null) return null;
  const unlimited = isUnlimitedSpeechQuota(status.quotaSeconds);
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm">
          <span className="font-medium">{status.planLabel}</span>
          <span className="text-[#9aa1b1]"> plan</span>
        </p>
        <Link href="/dashboard/billing" className="text-sm font-medium text-primary hover:underline">
          {status.isPaid ? "Billing" : "Upgrade"}
        </Link>
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-[#6b7285]">{status.limits.songAiProjection ? "Bible & song AI projection" : "Bible AI projection"}</span>
        <span className="flex-none tabular-nums">
          {formatDuration(status.usedSeconds)}
          <span className="text-[#9aa1b1]">{unlimited ? " · unlimited" : ` of ${formatDuration(status.quotaSeconds)}`}</span>
        </span>
      </div>
      {unlimited ? null : <Meter used={status.usedSeconds} total={status.quotaSeconds} className="mt-2" />}
      <p className="mt-2 text-[0.8rem] text-[#9aa1b1]">Resets {formatDate(status.periodEndMs, { month: "short", day: "numeric" })}</p>
    </Card>
  );
}
