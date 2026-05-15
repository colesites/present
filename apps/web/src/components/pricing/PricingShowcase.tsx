"use client";

import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { Check, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type BillingPeriod = "month" | "annual";

type StripePlan = {
  slug: string;
  name: string;
  description: string | null;
  features: string[];
  monthlyPrice: number | null;
  monthlyPriceFormatted: string | null;
  yearlyPrice: number | null;
  yearlyPriceFormatted: string | null;
  yearlyMonthlyPrice: number | null;
  yearlyMonthlyPriceFormatted: string | null;
  currency: string;
  monthlyPriceId: string | null;
  yearlyPriceId: string | null;
  monthlyLookupKey: string | null;
  yearlyLookupKey: string | null;
};

type PricingShowcaseProps = {
  compact?: boolean;
  className?: string;
  redirectUrl?: string;
};

const FEATURED_PLAN_SLUG = "pro";

function computeMaxSavings(plans: StripePlan[]): number {
  let max = 0;

  for (const plan of plans) {
    if (
      plan.monthlyPrice &&
      plan.monthlyPrice > 0 &&
      plan.yearlyPrice &&
      plan.yearlyPrice > 0
    ) {
      const annualized = plan.monthlyPrice * 12;
      const percent = Math.round((1 - plan.yearlyPrice / annualized) * 100);
      if (percent > max) max = percent;
    }
  }

  return max;
}

export function PricingShowcase({
  compact = false,
  className,
  redirectUrl = "/pricing",
}: PricingShowcaseProps) {
  const [period, setPeriod] = useState<BillingPeriod>("month");
  const [plans, setPlans] = useState<StripePlan[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPlans() {
      setIsLoadingPlans(true);
      setErrorMessage(null);

      try {
        const response = await fetch("/api/stripe/plans");
        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = (await response.json()) as { plans: StripePlan[] };
        if (!cancelled) {
          setPlans(data.plans);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[PricingShowcase] Failed to load plans", error);
          setErrorMessage("Unable to load plans right now.");
        }
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
  }, []);

  const supportsAnnualBilling = useMemo(
    () =>
      plans.some(
        (plan) =>
          plan.yearlyPrice !== null &&
          plan.yearlyMonthlyPrice !== null &&
          (plan.monthlyPrice ?? 0) > 0,
      ),
    [plans],
  );

  const maxSavings = useMemo(() => computeMaxSavings(plans), [plans]);

  const handleCheckout = async (lookupKey: string) => {
    setCheckoutLoading(lookupKey);
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lookupKey,
          successUrl: `${window.location.origin}${redirectUrl}?checkout=success`,
          cancelUrl: `${window.location.origin}${redirectUrl}?checkout=cancel`,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as { url: string };
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error("[PricingShowcase] Checkout error:", error);
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnUrl: `${window.location.origin}${redirectUrl}`,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as { url: string };
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error("[PricingShowcase] Portal error:", error);
    }
  };

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
                  period === "annual"
                    ? "left-[calc(100%-1.625rem)]"
                    : "left-0.5",
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

      {/* ── Loading state ──────────────────────────────────────────── */}
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
              const isFeatured =
                plan.slug.toLowerCase() === FEATURED_PLAN_SLUG;
              const isFreeLike = (plan.monthlyPrice ?? 0) === 0;

              // Price display logic
              let priceDisplay: string;
              let priceSubtext: string | null = null;

              if (isFreeLike) {
                priceDisplay = "$0";
              } else if (period === "annual" && plan.yearlyMonthlyPriceFormatted) {
                priceDisplay = `$${plan.yearlyMonthlyPriceFormatted}`;
                priceSubtext = plan.yearlyPriceFormatted
                  ? `$${plan.yearlyPriceFormatted}/year`
                  : null;
              } else if (plan.monthlyPriceFormatted) {
                priceDisplay = `$${plan.monthlyPriceFormatted}`;
              } else {
                priceDisplay = "Custom";
              }

              const lookupKey =
                period === "annual"
                  ? plan.yearlyLookupKey
                  : plan.monthlyLookupKey;

              const isCheckoutLoading = checkoutLoading === lookupKey;

              return (
                <article
                  key={plan.slug}
                  className={cn(
                    "relative flex flex-col rounded-[2rem] border p-8 transition-all duration-300",
                    isFeatured
                      ? "border-primary/30 bg-white/[0.08] shadow-[0_0_40px_-10px_rgba(82,39,255,0.15)] ring-1 ring-primary/20 scale-[1.02] z-10"
                      : "border-white/10 bg-white/[0.03] hover:border-white/20",
                  )}
                >
                  {/* Header Badges */}
                  <div className="flex items-center justify-between mb-8">
                    <span
                      className={cn(
                        "rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider",
                        isFeatured
                          ? "bg-primary text-white"
                          : "bg-white/10 text-white/70",
                      )}
                    >
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
                        <span className="text-sm text-white/40 font-medium">
                          /mo
                        </span>
                      )}
                    </div>
                    {priceSubtext ? (
                      <p className="mt-1 text-xs text-white/35">
                        {priceSubtext}
                      </p>
                    ) : null}
                    <p className="mt-3 text-sm leading-relaxed text-white/50">
                      {plan.description ||
                        "Everything you need to get started."}
                    </p>
                  </div>

                  {/* Features List */}
                  <div className="flex-1 space-y-4 mb-10">
                    <div className="h-px w-full bg-white/5 mb-6" />
                    {plan.features.map((feature) => (
                      <div key={feature} className="flex items-start gap-3">
                        <div className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                          <Check className="h-3 w-3 stroke-[3]" />
                        </div>
                        <span className="text-sm text-white/70">{feature}</span>
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
                                  Get started
                                </>
                              ) : (
                                "Get started"
                              )}
                            </button>
                          </SignUpButton>
                        ) : (
                          <SignInButton
                            mode="modal"
                            forceRedirectUrl={redirectUrl}
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
                                  Get started
                                </>
                              ) : (
                                "Get started"
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
                          Included by default
                        </a>
                      ) : lookupKey ? (
                        <button
                          type="button"
                          disabled={isCheckoutLoading}
                          onClick={() => void handleCheckout(lookupKey)}
                          className={cn(
                            "w-full rounded-xl py-4 text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50",
                            isFeatured
                              ? "flex items-center justify-center gap-2 bg-primary text-white shadow-[0_0_20px_-5px_rgba(82,39,255,0.5)] hover:bg-primary/90"
                              : "border border-white/10 bg-white/5 text-white hover:bg-white/10",
                          )}
                        >
                          {isCheckoutLoading ? (
                            "Loading..."
                          ) : isFeatured ? (
                            <>
                              <Zap className="h-4 w-4 fill-white" />
                              Get started
                            </>
                          ) : (
                            "Get started"
                          )}
                        </button>
                      ) : null}
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
          <p className="text-lg font-medium text-white">
            No plans are available yet.
          </p>
          <p className="mt-3 text-sm leading-6 text-white/50">
            Plans are being set up. Please check back shortly.
          </p>
        </div>
      ) : null}
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
