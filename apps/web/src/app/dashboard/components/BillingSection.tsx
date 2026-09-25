"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  Check,
  Cloud,
  CreditCard,
  ExternalLink,
  FileText,
  Sparkles,
  UsersRound,
  Wand2,
} from "lucide-react";
import { isUnlimitedSpeechQuota } from "../../../../../../packages/shared/src/billing";
import { formatBytes, formatDate, formatDuration } from "./format";
import { Meter, useBillingStatus } from "./usage";
import {
  Button,
  Card,
  Eyebrow,
  Notice,
  Page,
  PageHeader,
  SectionTitle,
  SkeletonRows,
  buttonClass,
  cx,
} from "./ui";

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
      <PageHeader
        eyebrow="Billing"
        title="Plan and billing"
        description="Your plan, what you've used of it this period, and changing it. Payments are handled by Stripe."
      />

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
            <div className="inline-flex rounded-full border border-[#e4e6ee] p-1" role="radiogroup" aria-label="Billing period">
              {(["month", "year"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={interval === option}
                  onClick={() => setBillingInterval(option)}
                  className={cx(
                    "h-8 rounded-full px-3.5 text-[0.8rem] font-medium transition",
                    interval === option ? "bg-[#232946] text-white" : "text-[#5b6478] hover:text-[#232946]",
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
                  currentPlanKey={complimentary ? status?.planKey ?? null : subscription?.planKey ?? (status ? "free" : null)}
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
          <Card className="mt-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <span className="flex h-10 w-14 flex-none items-center justify-center rounded-control border border-[#e4e6ee] bg-[#fafbfd] text-[#5b6478]">
                  <CreditCard className="h-5 w-5" />
                </span>
                {overview.card ? (
                  <div>
                    <p className="font-medium">
                      {CARD_BRANDS[overview.card.brand] ?? overview.card.brand} ending in {overview.card.last4}
                    </p>
                    <p className="text-sm text-[#9aa3b2]">
                      Expires {String(overview.card.expMonth).padStart(2, "0")}/{String(overview.card.expYear).slice(-2)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-[#7d8798]">No card on file.</p>
                )}
              </div>
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
          <ul className="mt-4 divide-y divide-[#f0f1f5] rounded-card border border-[#ececf2]">
            {overview.invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5 sm:px-5">
                <FileText className="h-4 w-4 flex-none text-[#9aa3b2]" />
                <span className="min-w-[7rem] font-medium">{formatDate(invoice.date)}</span>
                <span className="text-[#5b6478]">{money(invoice.amount, invoice.currency)}</span>
                <span
                  className={cx(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
                    invoice.status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
                  )}
                >
                  {invoice.status ?? "open"}
                </span>
                <span className="ml-auto flex gap-3 text-sm">
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
          </ul>
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
    <Card tone="soft">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-control bg-white text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <Eyebrow>Current plan</Eyebrow>
            <p className="mt-1 text-2xl font-semibold tracking-[-0.03em]">
              {planLabel}
              {subscription ? (
                <span className="ml-2 text-base font-normal text-[#7d8798]">
                  {money(subscription.amount, subscription.currency)} / {subscription.interval}
                </span>
              ) : null}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-[#7d8798]">
              <CalendarClock className="h-4 w-4 flex-none" />
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
                <span className="text-sm text-[#5b6478]">Cancel at the end of this period?</span>
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
  onSwitch,
}: {
  plan: Plan;
  interval: "month" | "year";
  currentPlanKey: string | null;
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

  let action: React.ReactNode = null;
  if (complimentary) {
    action = isCurrentPlan ? <Current /> : null;
  } else if (isFree) {
    action = isCurrentPlan ? <Current /> : hasSubscription ? (
      <p className="text-center text-[0.8rem] text-[#9aa3b2]">Cancel your plan above to move to Free.</p>
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
        isCurrentPlan ? "border-primary/40 ring-1 ring-primary/20" : "border-[#ececf2]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-semibold">{plan.name}</p>
        {featured && !isCurrentPlan ? (
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">Popular</span>
        ) : null}
      </div>
      <p className="mt-3">
        <span className="text-3xl font-semibold tracking-[-0.03em]">{price == null ? "–" : wholeDollars(price)}</span>
        <span className="text-sm text-[#7d8798]"> / {interval}</span>
      </p>
      {plan.description ? <p className="mt-2 text-sm leading-6 text-[#7d8798]">{plan.description}</p> : null}
      <ul className="mt-5 flex-1 space-y-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm leading-5 text-[#3d4460]">
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
    <span className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary/[0.06] text-sm font-semibold text-primary">
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
          {summary ? <p className="mt-1 text-sm leading-6 text-[#7d8798]">{summary}</p> : null}
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
  return (
    <section className="mt-10">
      <SectionTitle>This period</SectionTitle>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
    </section>
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
