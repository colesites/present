"use client";

import { ClerkLoaded, ClerkLoading, Show, SignInButton, SignUpButton, useClerk } from "@clerk/nextjs";
import { CheckoutButton } from "@clerk/nextjs/experimental";
import { Check, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type BillingPeriod = "month" | "annual";

type BillingMoneyAmount = {
  amount: number;
  amountFormatted: string;
  currency: string;
  currencySymbol: string;
};

type BillingFeature = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
};

type BillingPlan = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  fee: BillingMoneyAmount | null;
  annualFee: BillingMoneyAmount | null;
  annualMonthlyFee: BillingMoneyAmount | null;
  publiclyVisible: boolean;
  features: BillingFeature[];
  freeTrialDays: number | null;
  freeTrialEnabled: boolean;
  hasBaseFee: boolean;
  isDefault: boolean;
};

type PricingShowcaseProps = {
  compact?: boolean;
  className?: string;
  redirectUrl?: string;
};

const PLAN_ORDER = ["free", "pro", "power"] as const;
const FEATURED_PLAN_SLUG = "pro";

const FEATURE_ALIASES: Record<string, string[]> = {
  free: ["free", "starter", "hobby"],
  pro: ["pro"],
  power: ["power", "business", "enterprise"],
};

function formatAmount(amount: BillingMoneyAmount | null) {
  if (!amount) {
    return null;
  }

  return `${amount.currencySymbol}${amount.amountFormatted}`;
}

function computeAnnualSavings(plan: BillingPlan) {
  if (!plan.fee || !plan.annualFee) {
    return null;
  }

  const monthlyAnnualized = plan.fee.amount * 12;

  if (monthlyAnnualized <= 0) {
    return null;
  }

  const percent = Math.round((1 - plan.annualFee.amount / monthlyAnnualized) * 100);

  return percent > 0 ? percent : null;
}

function resolvePlanOrder(slug: string) {
  const normalized = slug.toLowerCase();
  const index = PLAN_ORDER.findIndex((planSlug) => {
    const aliases = FEATURE_ALIASES[planSlug] ?? [planSlug];
    return aliases.includes(normalized);
  });

  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function normalizePlans(input: BillingPlan[]) {
  return input
    .filter((plan) => plan.publiclyVisible)
    .filter((plan) => resolvePlanOrder(plan.slug) !== Number.MAX_SAFE_INTEGER)
    .sort((left, right) => {
      const orderDiff = resolvePlanOrder(left.slug) - resolvePlanOrder(right.slug);
      if (orderDiff !== 0) {
        return orderDiff;
      }

      return left.name.localeCompare(right.name);
    });
}

export function PricingShowcase({
  compact = false,
  className,
  redirectUrl = "/pricing",
}: PricingShowcaseProps) {
  const clerk = useClerk();
  const [period, setPeriod] = useState<BillingPeriod>("month");
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPlans() {
      if (!clerk.loaded) {
        return;
      }

      setIsLoadingPlans(true);
      setErrorMessage(null);

      try {
        const response = await clerk.billing.getPlans({
          for: "user",
          pageSize: 20,
        });

        if (cancelled) {
          return;
        }

        const normalized = normalizePlans(response.data as BillingPlan[]);
        setPlans(normalized);
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("[PricingShowcase] Failed to load plans", error);
        setErrorMessage("Unable to load plans right now.");
      } finally {
        if (!cancelled) {
          setIsLoadingPlans(false);
        }
      }
    }

    void loadPlans();

    return () => {
      cancelled = true;
    };
  }, [clerk, clerk.loaded]);

  const featureRows = useMemo(() => {
    const allFeatures = new Map<string, BillingFeature>();

    for (const plan of plans) {
      for (const feature of plan.features) {
        if (!allFeatures.has(feature.slug)) {
          allFeatures.set(feature.slug, feature);
        }
      }
    }

    return Array.from(allFeatures.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [plans]);

  const supportsAnnualBilling = useMemo(
    () => plans.some((plan) => Boolean(plan.annualFee && plan.annualMonthlyFee)),
    [plans],
  );

  const maxSavings = useMemo(
    () =>
      plans.reduce((highest, plan) => {
        const savings = computeAnnualSavings(plan) ?? 0;
        return Math.max(highest, savings);
      }, 0),
    [plans],
  );

  return (
    <div className={cn(compact ? "space-y-10" : "space-y-16", className)}>
      {/* ── Billing toggle ──────────────────────────────────────────── */}
      {supportsAnnualBilling ? (
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-4">
            <span
              className={cn(
                "text-sm font-medium transition",
                period === "month" ? "text-white" : "text-white/40",
              )}
            >
              Monthly
            </span>

            <button
              type="button"
              onClick={() => setPeriod(period === "month" ? "annual" : "month")}
              className="relative h-7 w-12 rounded-full bg-white/10 transition hover:bg-white/15"
              aria-label="Toggle billing period"
            >
              <span
                className={cn(
                  "absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all duration-200",
                  period === "annual" ? "left-[calc(100%-1.625rem)]" : "left-0.5",
                )}
              />
            </button>

            <span
              className={cn(
                "text-sm font-medium transition",
                period === "annual" ? "text-white" : "text-white/40",
              )}
            >
              Yearly
            </span>
          </div>

          {maxSavings > 0 ? (
            <p className="text-sm font-medium text-primary">
              Save up to {maxSavings}% with yearly plan
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ── Loading states ──────────────────────────────────────────── */}
      <ClerkLoading>
        <PricingSkeleton compact={compact} />
      </ClerkLoading>

      <ClerkLoaded>
        {isLoadingPlans ? <PricingSkeleton compact={compact} /> : null}

        {!isLoadingPlans && errorMessage ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-6 py-5 text-sm text-red-200">
            {errorMessage}
          </div>
        ) : null}

        {!isLoadingPlans && !errorMessage && plans.length > 0 ? (
          <>
            {/* ── Plan cards ──────────────────────────────────────── */}
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {plans.map((plan) => {
                const isFeatured = plan.slug.toLowerCase() === FEATURED_PLAN_SLUG;
                const monthlyPrice = formatAmount(plan.fee);
                const annualMonthlyPrice = formatAmount(plan.annualMonthlyFee ?? plan.fee);
                const displayPrice = period === "annual" ? annualMonthlyPrice : monthlyPrice;
                const isFreeLike =
                  (plan.fee?.amount ?? 0) === 0 && (!plan.annualFee || plan.annualFee.amount === 0);

                const ctaLabel = "Get started";
                const priceDisplay =
                  !isFreeLike && !displayPrice ? "Custom" : (displayPrice ?? "$0");

                return (
                  <article
                    key={plan.id}
                    className={cn(
                      "relative flex flex-col rounded-[2rem] border p-8 transition-all duration-300",
                      isFeatured
                        ? "border-primary/30 bg-white/[0.08] shadow-[0_0_40px_-10px_rgba(82,39,255,0.15)] ring-1 ring-primary/20 scale-[1.02] z-10"
                        : "border-white/10 bg-white/[0.03] hover:border-white/20",
                    )}
                  >
                    {/* Header Badges */}
                    <div className="flex items-center justify-between mb-8">
                      <span className={cn(
                        "rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider",
                        isFeatured ? "bg-primary text-white" : "bg-white/10 text-white/70"
                      )}>
                        {plan.name}
                      </span>
                      {isFeatured && (
                        <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                          Most Popular
                        </span>
                      )}
                    </div>

                    {/* Price */}
                    <div className="mb-8">
                      <div className="flex items-baseline gap-1">
                        <span className="text-5xl font-bold tracking-tighter text-white">
                          {priceDisplay}
                        </span>
                        {priceDisplay !== "Custom" && (
                          <span className="text-sm text-white/40 font-medium">/mo</span>
                        )}
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-white/50">
                        {plan.description || "Everything you need to get started."}
                      </p>
                    </div>

                    {/* Features List */}
                    <div className="flex-1 space-y-4 mb-10">
                      <div className="h-px w-full bg-white/5 mb-6" />
                      {plan.features.map((feature) => (
                        <div key={feature.id} className="flex items-start gap-3">
                          <div className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                            <Check className="h-3 w-3 stroke-[3]" />
                          </div>
                          <span className="text-sm text-white/70">{feature.name}</span>
                        </div>
                      ))}
                    </div>

                    {/* CTA button */}
                    <div className="mt-auto">
                      <Show
                        when="signed-in"
                        fallback={
                          isFreeLike ? (
                            <SignUpButton mode="modal">
                              <button
                                type="button"
                                className={cn(
                                  "w-full rounded-xl py-4 text-sm font-bold transition-all active:scale-[0.98]",
                                  isFeatured
                                    ? "flex items-center justify-center gap-2 bg-primary text-white shadow-[0_0_20px_-5px_rgba(82,39,255,0.5)] hover:bg-primary/90"
                                    : "border border-white/10 bg-white/5 text-white hover:bg-white/10",
                                )}
                              >
                                {isFeatured ? (
                                  <>
                                    <Zap className="h-4 w-4 fill-white" />
                                    {ctaLabel}
                                  </>
                                ) : (
                                  ctaLabel
                                )}
                              </button>
                            </SignUpButton>
                          ) : (
                            <SignInButton mode="modal" forceRedirectUrl={redirectUrl}>
                              <button
                                type="button"
                                className={cn(
                                  "w-full rounded-xl py-4 text-sm font-bold transition-all active:scale-[0.98]",
                                  isFeatured
                                    ? "flex items-center justify-center gap-2 bg-primary text-white shadow-[0_0_20px_-5px_rgba(82,39,255,0.5)] hover:bg-primary/90"
                                    : "border border-white/10 bg-white/5 text-white hover:bg-white/10",
                                )}
                              >
                                {isFeatured ? (
                                  <>
                                    <Zap className="h-4 w-4 fill-white" />
                                    {ctaLabel}
                                  </>
                                ) : (
                                  ctaLabel
                                )}
                              </button>
                            </SignInButton>
                          )
                        }
                      >
                        {isFreeLike ? (
                          <a
                            href="/dashboard"
                            className={cn(
                              "block w-full rounded-xl py-4 text-center text-sm font-bold transition-all active:scale-[0.98]",
                              isFeatured
                                ? "bg-primary text-white shadow-[0_0_20px_-5px_rgba(82,39,255,0.5)] hover:bg-primary/90"
                                : "border border-white/10 bg-white/5 text-white hover:bg-white/10",
                            )}
                          >
                            {plan.isDefault ? "Included by default" : ctaLabel}
                          </a>
                        ) : (
                          <CheckoutButton
                            planId={plan.id}
                            planPeriod={period}
                            newSubscriptionRedirectUrl={redirectUrl}
                          >
                            <button
                              type="button"
                              className={cn(
                                "w-full rounded-xl py-4 text-sm font-bold transition-all active:scale-[0.98]",
                                isFeatured
                                  ? "flex items-center justify-center gap-2 bg-primary text-white shadow-[0_0_20px_-5px_rgba(82,39,255,0.5)] hover:bg-primary/90"
                                  : "border border-white/10 bg-white/5 text-white hover:bg-white/10",
                              )}
                            >
                              {isFeatured ? (
                                <>
                                  <Zap className="h-4 w-4 fill-white" />
                                  {ctaLabel}
                                </>
                              ) : (
                                ctaLabel
                              )}
                            </button>
                          </CheckoutButton>
                        )}
                      </Show>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : null}

        {!isLoadingPlans && !errorMessage && plans.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-8 text-center">
            <p className="text-lg font-medium text-white">No plans are available yet.</p>
            <p className="mt-3 text-sm leading-6 text-white/50">
              Plans are being set up. Please check back shortly.
            </p>
          </div>
        ) : null}
      </ClerkLoaded>
    </div>
  );
}

function PricingSkeleton({ compact }: { compact: boolean }) {
  return (
    <div className="space-y-16">
      {/* Toggle skeleton */}
      <div className="flex justify-center">
        <div className="h-7 w-48 animate-pulse rounded-full bg-white/8" />
      </div>

      {/* Card skeletons */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="flex flex-col rounded-[2rem] border border-white/8 bg-white/[0.03] p-8 min-h-[500px]"
          >
            <div className="flex justify-between items-center mb-8">
              <div className="h-6 w-20 animate-pulse rounded-full bg-white/10" />
              <div className="h-6 w-24 animate-pulse rounded-full bg-white/10" />
            </div>
            <div className="mb-8">
              <div className="h-12 w-32 animate-pulse rounded-lg bg-white/10" />
              <div className="mt-4 h-4 w-48 animate-pulse rounded-full bg-white/6" />
              <div className="mt-2 h-4 w-40 animate-pulse rounded-full bg-white/6" />
            </div>
            <div className="flex-1 space-y-4 mb-10">
              <div className="h-px w-full bg-white/5 mb-6" />
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-4 w-4 animate-pulse rounded-full bg-white/10" />
                  <div className="h-3 w-32 animate-pulse rounded-full bg-white/6" />
                </div>
              ))}
            </div>
            <div className="mt-auto">
              <div className="h-14 w-full animate-pulse rounded-xl bg-white/8" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
