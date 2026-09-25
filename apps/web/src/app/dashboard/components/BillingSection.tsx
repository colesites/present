"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink } from "lucide-react";
import { isUnlimitedSpeechQuota } from "../../../../../../packages/shared/src/billing";
import { formatBytes, formatDate, formatDuration } from "./format";
import { Meter, useBillingStatus } from "./usage";
import { Button, Card, List, Notice, Page, PageHeader, SectionTitle, SkeletonRows, buttonClass, cx } from "./ui";

type Plan = {
  slug: string;
  name: string;
  description: string | null;
  features: string[];
  monthlyPrice: number | null;
  yearlyPrice: number | null;
  monthlyLookupKey: string | null;
  yearlyLookupKey: string | null;
};

type Subscription = {
  id: string;
  planKey: string;
  planLabel: string;
  lookupKey: string | null;
  interval: "month" | "year";
  amount: number;
  currency: string;
  status: string;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
};

type Overview = {
  subscription: Subscription | null;
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  upcoming: { amountDue: number; currency: string; date: number | null } | null;
  invoices: Array<{
    id: string;
    number: string | null;
    date: number;
    amount: number;
    currency: string;
    status: string | null;
    url: string | null;
    pdf: string | null;
  }>;
};

type Preview = {
  isUpgrade: boolean;
  planLabel: string;
  interval: "month" | "year";
  amount: number;
  currency: string;
  dueNow: number;
  nextAmount: number | null;
};

const money = (minor: number, currency = "usd") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(minor / 100);

const wholeDollars = (amount: number) => (amount % 1 === 0 ? `$${amount}` : `$${amount.toFixed(2)}`);

const CARD_BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  jcb: "JCB",
  diners: "Diners Club",
  unionpay: "UnionPay",
};

/**
 * Your plan, what it includes and what you've used, and changing it, all on
 * this page: buying goes through Present's own checkout (`/checkout`), and
 * switching, cancelling and a new card through `/api/stripe/subscription`.
 * Stripe keeps the subscription; nobody is sent to its portal.
 */
export function BillingSection() {
  const status = useBillingStatus();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [interval, setBillingInterval] = useState<"month" | "year">("month");
  const [target, setTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/stripe/subscription", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as Overview;
      setOverview(data);
      if (data.subscription) setBillingInterval(data.subscription.interval);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    void fetch("/api/stripe/plans")
      .then((response) => (response.ok ? response.json() : { plans: [] }))
      .then((data: { plans: Plan[] }) => setPlans(data.plans))
      .catch(() => setPlans([]));
  }, [load]);

  // Arriving from checkout with a plan picked, for someone who already pays.
  const hasSubscription = Boolean(overview?.subscription);
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("plan");
    if (wanted && hasSubscription) {
      setTarget(wanted);
      setBillingInterval(wanted.endsWith("_yr") ? "year" : "month");
    }
  }, [hasSubscription]);

  const subscription = overview?.subscription ?? null;
  const complimentary = Boolean(status?.isPaid && overview && !subscription);

  return (
    <Page>
      <PageHeader title="Billing" description="Your plan and what you've used of it this period. Payments are handled by Stripe." />

      {notice ? (
        <div className="mt-6">
          <Notice kind={notice.kind}>{notice.text}</Notice>
        </div>
      ) : null}

      <div className="mt-8 space-y-4">
        {status === undefined || (!overview && !loadError) ? (
          <SkeletonRows rows={2} height="h-[140px]" />
        ) : status === null ? null : (
          <CurrentPlan
            planLabel={status.planLabel}
            periodEndMs={status.periodEndMs}
            isPaid={status.isPaid}
            subscription={subscription}
            upcoming={overview?.upcoming ?? null}
            complimentary={complimentary}
            onChanged={async (text) => {
              setNotice({ kind: "ok", text });
              await load();
            }}
            onError={(text) => setNotice({ kind: "error", text })}
          />
        )}
        {loadError ? <Notice kind="error">Billing details couldn&apos;t load. Refresh to try again.</Notice> : null}
      </div>

      {status ? <UsageGrid status={status} /> : null}

      <section className="mt-10">
        <SectionTitle
          aside={
            <div className="inline-flex gap-1" role="radiogroup" aria-label="Billing period">
              {(["month", "year"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={interval === option}
                  onClick={() => setBillingInterval(option)}
                  className={cx(
                    "h-7 rounded-[7px] px-3 text-[0.82rem] transition-colors",
                    interval === option ? "bg-[#f1f2f6] font-medium text-[#1d2240]" : "text-[#6b7285] hover:text-[#1d2240]",
                  )}
                >
                  {option === "month" ? "Monthly" : "Yearly"}
                </button>
              ))}
            </div>
          }
        >
          {subscription ? "Change plan" : "Plans"}
        </SectionTitle>
        <div className="mt-4">
          {!plans ? (
            <SkeletonRows rows={1} height="h-[300px]" />
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.slug}
                  plan={plan}
                  interval={interval}
                  // What the server says they have: a subscription's plan, or the
                  // one their account carries without one (Free, or the allowlist).
                  currentPlanKey={subscription?.planKey ?? status?.planKey ?? null}
                  ready={Boolean(overview) && Boolean(status)}
                  currentLookupKey={subscription?.lookupKey ?? null}
                  hasSubscription={Boolean(subscription)}
                  complimentary={complimentary}
                  onSwitch={(lookupKey) => setTarget(lookupKey)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {target && subscription ? (
        <SwitchPanel
          lookupKey={target}
          onClose={() => setTarget(null)}
          onDone={async (text) => {
            setTarget(null);
            setNotice({ kind: "ok", text });
            await load();
          }}
        />
      ) : null}

      {overview && (overview.card || subscription) ? (
        <section className="mt-10">
          <SectionTitle>Payment method</SectionTitle>
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {overview.card ? (
                <p className="text-sm">
                  <span className="font-medium">
                    {CARD_BRANDS[overview.card.brand] ?? overview.card.brand} ending {overview.card.last4}
                  </span>
                  <span className="text-[#9aa1b1]">
                    {" "}
                    · expires {String(overview.card.expMonth).padStart(2, "0")}/{String(overview.card.expYear).slice(-2)}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-[#6b7285]">No card on file.</p>
              )}
              <Link href="/checkout?mode=card" className={buttonClass("outline", "sm")}>
                {overview.card ? "Update card" : "Add a card"}
              </Link>
            </div>
          </Card>
        </section>
      ) : null}

      {overview && overview.invoices.length > 0 ? (
        <section className="mt-10">
          <SectionTitle>Invoices</SectionTitle>
          <List>
            {overview.invoices.map((invoice) => (
              <li key={invoice.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 text-sm sm:grid-cols-[8rem_7rem_6rem_minmax(0,1fr)]">
                <span className="font-medium">{formatDate(invoice.date)}</span>
                <span className="tabular-nums text-[#6b7285] sm:text-[#1d2240]">{money(invoice.amount, invoice.currency)}</span>
                <span className={cx("capitalize", invoice.status === "paid" ? "text-emerald-700" : "text-amber-700")}>{invoice.status ?? "open"}</span>
                <span className="flex gap-3 sm:justify-end">
                  {invoice.url ? (
                    <a href={invoice.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                      View <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                  {invoice.pdf ? (
                    <a href={invoice.pdf} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                      PDF
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </List>
        </section>
      ) : null}
    </Page>
  );
}

function CurrentPlan({
  planLabel,
  periodEndMs,
  isPaid,
  subscription,
  upcoming,
  complimentary,
  onChanged,
  onError,
}: {
  planLabel: string;
  periodEndMs: number;
  isPaid: boolean;
  subscription: Subscription | null;
  upcoming: Overview["upcoming"];
  complimentary: boolean;
  onChanged: (text: string) => Promise<void>;
  onError: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const act = async (action: "cancel" | "resume") => {
    setBusy(true);
    try {
      const response = await fetch("/api/stripe/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(await response.text());
      setConfirmCancel(false);
      await onChanged(
        action === "cancel"
          ? `Your plan stays active until ${formatDate(subscription?.currentPeriodEnd ?? periodEndMs)}, then moves to Free.`
          : "Your plan will renew as usual.",
      );
    } catch (error) {
      onError(error instanceof Error && error.message ? error.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const ending = subscription?.cancelAtPeriodEnd || Boolean(subscription?.cancelAt);
  const pastDue = subscription?.status === "past_due" || subscription?.status === "incomplete";

  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[1.15rem] font-semibold tracking-[-0.02em]">
            {planLabel}
            {subscription ? (
              <span className="ml-2 text-[0.95rem] font-normal text-[#6b7285]">
                {money(subscription.amount, subscription.currency)} / {subscription.interval}
              </span>
            ) : null}
          </p>
          <p className={cx("mt-1 text-sm", pastDue ? "text-amber-700" : "text-[#6b7285]")}>
            {complimentary
              ? "Included with your account at no charge."
              : !subscription
                ? `Usage resets ${formatDate(periodEndMs)}.`
                : pastDue
                  ? "Your last payment didn't go through. Update your card to keep your plan."
                  : ending
                    ? `Ends ${formatDate(subscription.cancelAt ?? subscription.currentPeriodEnd)}, then moves to Free.`
                    : upcoming
                      ? `Renews ${formatDate(upcoming.date ?? subscription.currentPeriodEnd)} for ${money(upcoming.amountDue, upcoming.currency)}.`
                      : `Renews ${formatDate(subscription.currentPeriodEnd)}.`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {!subscription && !isPaid ? (
            <Link href="/checkout?plan=present_pro_plan" className={buttonClass()}>
              Upgrade to Pro
            </Link>
          ) : null}
          {subscription && pastDue ? (
            <Link href="/checkout?mode=card" className={buttonClass()}>
              Update card
            </Link>
          ) : null}
          {subscription && ending ? (
            <Button busy={busy} onClick={() => void act("resume")}>
              Keep my plan
            </Button>
          ) : subscription ? (
            confirmCancel ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-[#6b7285]">Cancel at the end of this period?</span>
                <Button size="sm" variant="danger" busy={busy} onClick={() => void act("cancel")}>
                  Cancel plan
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmCancel(false)}>
                  Keep it
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirmCancel(true)}>
                Cancel plan
              </Button>
            )
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function PlanCard({
  plan,
  interval,
  currentPlanKey,
  currentLookupKey,
  hasSubscription,
  complimentary,
  ready,
  onSwitch,
}: {
  plan: Plan;
  interval: "month" | "year";
  currentPlanKey: string | null;
  ready: boolean;
  currentLookupKey: string | null;
  hasSubscription: boolean;
  complimentary: boolean;
  onSwitch: (lookupKey: string) => void;
}) {
  const isFree = plan.slug === "free";
  const price = isFree ? 0 : interval === "year" ? plan.yearlyPrice : plan.monthlyPrice;
  const lookupKey = interval === "year" ? plan.yearlyLookupKey : plan.monthlyLookupKey;
  const isCurrentPlan = currentPlanKey === plan.slug;
  const isExactPrice = Boolean(lookupKey && lookupKey === currentLookupKey);
  const featured = plan.slug === "pro";

  const rank = { free: 0, pro: 1, power: 2 } as Record<string, number>;
  let action: React.ReactNode = null;
  if (!ready) {
    action = <div className="h-10 animate-pulse rounded-[10px] bg-[#f1f2f6]" aria-hidden="true" />;
  } else if (complimentary) {
    // On the allowlist: their plan costs nothing, so nothing here is for sale.
    action = isCurrentPlan ? (
      <Current />
    ) : (rank[plan.slug] ?? 0) < (rank[currentPlanKey ?? "free"] ?? 0) ? (
      <p className="text-center text-[0.8rem] text-[#9aa1b1]">Included in your plan.</p>
    ) : null;
  } else if (isFree) {
    action = isCurrentPlan ? <Current /> : hasSubscription ? (
      <p className="text-center text-[0.8rem] text-[#9aa1b1]">Cancel your plan above to move to Free.</p>
    ) : null;
  } else if (!lookupKey) {
    action = null;
  } else if (isExactPrice) {
    action = <Current />;
  } else if (hasSubscription) {
    action = (
      <Button variant={featured ? "primary" : "outline"} className="w-full" onClick={() => onSwitch(lookupKey)}>
        {isCurrentPlan ? `Switch to ${interval === "year" ? "yearly" : "monthly"}` : `Switch to ${plan.name}`}
      </Button>
    );
  } else {
    action = (
      <Link href={`/checkout?plan=${lookupKey}`} className={cx(buttonClass(featured ? "primary" : "outline"), "w-full")}>
        Get {plan.name}
      </Link>
    );
  }

  return (
    <div
      className={cx(
        "flex flex-col rounded-card border bg-white p-5 sm:p-6",
        isCurrentPlan ? "border-primary/50" : "border-[#e7e9ef]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-semibold">{plan.name}</p>
        {featured && !isCurrentPlan ? (
          <span className="text-xs font-medium text-primary">Most chosen</span>
        ) : null}
      </div>
      <p className="mt-3">
        <span className="text-3xl font-semibold tracking-[-0.03em]">{price == null ? "–" : wholeDollars(price)}</span>
        <span className="text-sm text-[#6b7285]"> / {interval}</span>
      </p>
      {plan.description ? <p className="mt-2 text-sm leading-6 text-[#6b7285]">{plan.description}</p> : null}
      <ul className="mt-5 flex-1 space-y-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm leading-5 text-[#1d2240]">
            <Check className="mt-0.5 h-4 w-4 flex-none text-primary" />
            {feature}
          </li>
        ))}
      </ul>
      <div className="mt-6">{action}</div>
    </div>
  );
}

function Current() {
  return (
    <span className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[#f1f2f6] text-sm font-medium text-[#1d2240]">
      <Check className="h-4 w-4" /> Current plan
    </span>
  );
}

/** What a switch costs, shown before it happens. */
function SwitchPanel({
  lookupKey,
  onClose,
  onDone,
}: {
  lookupKey: string;
  onClose: () => void;
  onDone: (text: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);
    void fetch("/api/stripe/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview", lookupKey }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()) as Preview;
      })
      .then((result) => !cancelled && setPreview(result))
      .catch((failure: unknown) => !cancelled && setError(failure instanceof Error ? failure.message : "Couldn't price that change."));
    return () => {
      cancelled = true;
    };
  }, [lookupKey]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/stripe/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "change", lookupKey }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as { ok: boolean; message: string | null };
      if (!result.ok) throw new Error(result.message ?? "The plan didn't change.");
      await onDone(`You're now on ${preview?.planLabel ?? "your new plan"}.`);
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "The plan didn't change. Try again.");
      setBusy(false);
    }
  };

  const summary = useMemo(() => {
    if (!preview) return null;
    const price = `${money(preview.amount, preview.currency)} / ${preview.interval}`;
    return preview.isUpgrade
      ? `You'll pay ${money(preview.dueNow, preview.currency)} today for the rest of this period, then ${price}.`
      : `Nothing to pay today. What's left of this period is credited, so your next bill comes to ${money(
          preview.nextAmount ?? 0,
          preview.currency,
        )}, then ${price}.`;
  }, [preview]);

  return (
    <Card className="mt-4 border-primary/30">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold">
            {preview ? `Switch to ${preview.planLabel}, billed ${preview.interval}ly` : "Working out the price…"}
          </p>
          {summary ? <p className="mt-1 text-sm leading-6 text-[#6b7285]">{summary}</p> : null}
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        </div>
        <div className="flex flex-none gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void confirm()} busy={busy} disabled={!preview}>
            Confirm switch
          </Button>
        </div>
      </div>
    </Card>
  );
}

function UsageGrid({ status }: { status: NonNullable<ReturnType<typeof useBillingStatus>> }) {
  const unlimitedSpeech = isUnlimitedSpeechQuota(status.quotaSeconds);
  const fixes = status.limits.monthlyLyricsFixes;
  return (
    <section className="mt-10">
      <SectionTitle>This period</SectionTitle>
      <List>
        <UsageRow
          label={status.limits.songAiProjection ? "Bible & song AI projection" : "Bible AI projection"}
          value={`${formatDuration(status.usedSeconds)}${unlimitedSpeech ? "" : ` of ${formatDuration(status.quotaSeconds)}`}`}
          meter={unlimitedSpeech ? null : [status.usedSeconds, status.quotaSeconds]}
          note={unlimitedSpeech ? "Unlimited" : null}
        />
        <UsageRow
          label="AI lyrics fixes"
          value={`${status.usedLyricsFixes}${fixes === null ? "" : ` of ${fixes}`}`}
          meter={fixes === null ? null : [status.usedLyricsFixes, fixes]}
          note={fixes === null ? "Unlimited" : null}
        />
        <UsageRow label="Workspace members" value={`Up to ${status.limits.workspaceMembers}`} note="in each workspace you manage" />
        <UsageRow label="Cloud storage" value={formatBytes(status.limits.cloudStorageBytes)} note="for media synced to the cloud" />
      </List>
    </section>
  );
}

function UsageRow({
  label,
  value,
  meter = null,
  note = null,
}: {
  label: string;
  value: string;
  meter?: [number, number] | null;
  note?: string | null;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_10rem_9rem]">
      <span className="text-[#6b7285]">{label}</span>
      <span className="text-right tabular-nums sm:text-left">
        {value}
        {note ? <span className="text-[#9aa1b1]"> {note}</span> : null}
      </span>
      <span className="col-span-2 sm:col-span-1">{meter ? <Meter used={meter[0]} total={meter[1]} /> : null}</span>
    </li>
  );
}
