"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { loadStripe, type Appearance, type Stripe } from "@stripe/stripe-js";
import {
  CheckoutElementsProvider,
  PaymentElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";
import { ArrowLeft, Check, CreditCard, Loader2, Lock, Tag, X } from "lucide-react";

/**
 * Present's checkout: the plan on one side, Stripe's Payment Element on the
 * other, all on this site. Stripe still takes the payment (a Checkout
 * Session with `ui_mode: "elements"`, `/api/stripe/checkout`); the card is
 * typed into Stripe's own frame and never reaches us.
 *
 * `?plan=present_pro_plan` (or `?plan=pro&interval=year`) buys a plan;
 * `?mode=card` saves a new card for the plan already running.
 */

type StripePlan = {
  slug: string;
  name: string;
  description: string | null;
  features: string[];
  monthlyPrice: number | null;
  yearlyPrice: number | null;
  monthlyLookupKey: string | null;
  yearlyLookupKey: string | null;
};

const PRIMARY = "#4348d0";
const INK = "#232946";

const APPEARANCE: Appearance = {
  theme: "stripe",
  variables: {
    colorPrimary: PRIMARY,
    colorText: INK,
    colorTextSecondary: "#7d8798",
    colorDanger: "#dc2626",
    colorBackground: "#ffffff",
    fontFamily: "Geist, system-ui, -apple-system, sans-serif",
    borderRadius: "12px",
    spacingUnit: "4px",
  },
  rules: {
    ".Input": { border: "1px solid #e4e6ee", boxShadow: "none", padding: "12px 14px" },
    ".Input:focus": { border: `1px solid ${PRIMARY}`, boxShadow: "0 0 0 4px rgba(67, 72, 208, 0.12)" },
    ".Label": { fontWeight: "500", marginBottom: "6px" },
    ".Tab": { border: "1px solid #e4e6ee", boxShadow: "none" },
    ".Tab--selected": { border: `1px solid ${PRIMARY}`, boxShadow: "0 0 0 1px " + PRIMARY },
  },
};

const FONTS = [{ cssSrc: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" }];

/** One Stripe.js per publishable key, made once, outside render. */
const stripeByKey = new Map<string, Promise<Stripe | null>>();
const stripeFor = (key: string) => {
  let promise = stripeByKey.get(key);
  if (!promise) {
    promise = loadStripe(key);
    stripeByKey.set(key, promise);
  }
  return promise;
};

const LOOKUP_KEYS: Record<string, { month: string; year: string }> = {
  pro: { month: "present_pro_plan", year: "present_pro_plan_yr" },
  power: { month: "present_power_plan", year: "present_power_plan_yr" },
};

/** `?plan=` as a lookup key, whichever way the link spelled it. */
const lookupKeyFrom = (plan: string | null, interval: string | null) => {
  if (!plan) return null;
  if (plan.startsWith("present_")) return plan;
  const keys = LOOKUP_KEYS[plan.toLowerCase()];
  if (!keys) return null;
  return interval === "year" || interval === "yearly" ? keys.year : keys.month;
};

const slugOf = (lookupKey: string) => (lookupKey.includes("power") ? "power" : "pro");
const intervalOf = (lookupKey: string): "month" | "year" => (lookupKey.endsWith("_yr") ? "year" : "month");

type Started =
  | { state: "loading" }
  | { state: "ready"; clientSecret: string; publishableKey: string }
  | { state: "subscribed" }
  | { state: "error"; message: string };

export function CheckoutClient() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const isCardMode = params.get("mode") === "card";
  const lookupKey = isCardMode ? null : lookupKeyFrom(params.get("plan"), params.get("interval"));

  const [plans, setPlans] = useState<StripePlan[] | null>(null);
  const [started, setStarted] = useState<Started>({ state: "loading" });

  // Checkout is for someone signed in; everyone else signs in and comes back.
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      const back = `${pathname}?${params.toString()}`;
      router.replace(`/sign-in?next=${encodeURIComponent(back)}`);
    }
  }, [isLoaded, isSignedIn, params, pathname, router]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/stripe/plans")
      .then((response) => (response.ok ? response.json() : { plans: [] }))
      .then((data: { plans: StripePlan[] }) => {
        if (!cancelled) setPlans(data.plans);
      })
      .catch(() => {
        if (!cancelled) setPlans([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (!isCardMode && !lookupKey) {
      setStarted({ state: "error", message: "Choose a plan first." });
      return;
    }
    let cancelled = false;
    setStarted({ state: "loading" });
    void (async () => {
      try {
        const response = await fetch("/api/stripe/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(isCardMode ? { mode: "setup" } : { lookupKey }),
        });
        if (response.status === 409) {
          if (!cancelled) setStarted({ state: "subscribed" });
          return;
        }
        if (!response.ok) throw new Error((await response.text()) || "Checkout couldn't start.");
        const data = (await response.json()) as { clientSecret: string; publishableKey: string };
        if (!cancelled) setStarted({ state: "ready", ...data });
      } catch (error) {
        if (!cancelled) {
          setStarted({ state: "error", message: error instanceof Error ? error.message : "Checkout couldn't start." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCardMode, isLoaded, isSignedIn, lookupKey]);

  const plan = lookupKey ? plans?.find((each) => each.slug === slugOf(lookupKey)) ?? null : null;
  const stripePromise = useMemo(
    () => (started.state === "ready" ? stripeFor(started.publishableKey) : null),
    [started],
  );

  return (
    <CheckoutFrame>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-10">
        <div className="min-w-0">
          {isCardMode ? (
            <CardSummary />
          ) : lookupKey ? (
            <PlanSummary
              plan={plan}
              lookupKey={lookupKey}
              onInterval={(interval) => {
                const next = LOOKUP_KEYS[slugOf(lookupKey)][interval];
                router.replace(`/checkout?plan=${next}`);
              }}
            />
          ) : null}
        </div>

        <div className="min-w-0">
          {started.state === "ready" && stripePromise ? (
            <CheckoutElementsProvider
              key={started.clientSecret}
              stripe={stripePromise}
              options={{ clientSecret: started.clientSecret, elementsOptions: { appearance: APPEARANCE, fonts: FONTS } }}
            >
              <PaymentForm isCardMode={isCardMode} planName={plan?.name ?? null} />
            </CheckoutElementsProvider>
          ) : started.state === "subscribed" ? (
            <Panel>
              <p className="text-lg font-semibold">You already have a paid plan</p>
              <p className="mt-2 text-sm leading-6 text-[#7d8798]">
                Switch plans from Billing instead. You&apos;re only charged the difference for the rest of this period.
              </p>
              <Link
                href={lookupKey ? `/dashboard/billing?plan=${lookupKey}` : "/dashboard/billing"}
                className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white transition hover:bg-primary/90"
              >
                Go to Billing
              </Link>
            </Panel>
          ) : started.state === "error" ? (
            <Panel>
              <p className="font-semibold">Checkout couldn&apos;t start</p>
              <p className="mt-2 text-sm leading-6 text-[#7d8798]">{started.message}</p>
              <Link href="/pricing" className="mt-5 inline-flex text-sm font-semibold text-primary hover:underline">
                Back to plans
              </Link>
            </Panel>
          ) : (
            <PaymentSkeleton />
          )}
        </div>
      </div>
    </CheckoutFrame>
  );
}

export function CheckoutFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#f5f6fa] text-[#232946]">
      <header className="border-b border-[#e9ebf2] bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/present-mark.svg" alt="" width={28} height={28} className="h-7 w-7" />
            <span className="text-[1.05rem] font-semibold tracking-[-0.02em]">Present</span>
          </Link>
          <p className="flex items-center gap-1.5 text-sm text-[#7d8798]">
            <Lock className="h-4 w-4" /> Secure checkout
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-[#e9ebf2] bg-white p-5 shadow-[0_1px_2px_rgba(35,41,70,0.04)] sm:p-7 ${className ?? ""}`}>
      {children}
    </div>
  );
}

function PlanSummary({
  plan,
  lookupKey,
  onInterval,
}: {
  plan: StripePlan | null;
  lookupKey: string;
  onInterval: (interval: "month" | "year") => void;
}) {
  const interval = intervalOf(lookupKey);
  const savings =
    plan?.monthlyPrice && plan.yearlyPrice
      ? Math.round((1 - plan.yearlyPrice / (plan.monthlyPrice * 12)) * 100)
      : 0;
  const price = interval === "year" ? plan?.yearlyPrice : plan?.monthlyPrice;

  return (
    <div>
      <Link href="/pricing" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#7d8798] hover:text-[#232946]">
        <ArrowLeft className="h-4 w-4" /> All plans
      </Link>
      <p className="mt-6 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/70">Subscribe to</p>
      {plan ? (
        <h1 className="mt-2 text-[2rem] font-semibold leading-tight tracking-[-0.04em] sm:text-[2.5rem]">Present {plan.name}</h1>
      ) : (
        <div className="mt-3 h-10 w-56 animate-pulse rounded-control bg-[#e9ebf2]" />
      )}
      {price != null ? (
        <p className="mt-3 text-lg text-[#5b6478]">
          <span className="text-3xl font-semibold tracking-[-0.03em] text-[#232946]">${price % 1 === 0 ? price : price.toFixed(2)}</span>{" "}
          per {interval}
        </p>
      ) : null}

      <div className="mt-6 inline-flex rounded-full border border-[#e4e6ee] bg-white p-1" role="radiogroup" aria-label="Billing period">
        {(["month", "year"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={interval === option}
            onClick={() => interval !== option && onInterval(option)}
            className={`h-9 rounded-full px-4 text-sm font-medium transition ${
              interval === option ? "bg-[#232946] text-white" : "text-[#5b6478] hover:text-[#232946]"
            }`}
          >
            {option === "month" ? "Monthly" : "Yearly"}
            {option === "year" && savings > 0 ? (
              <span className={`ml-1.5 text-xs ${interval === "year" ? "text-emerald-300" : "text-emerald-600"}`}>
                Save {savings}%
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {plan && plan.features.length > 0 ? (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-[0.95rem] leading-6 text-[#3d4460]">
              <span className="mt-1 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
                <Check className="h-3 w-3" />
              </span>
              {feature}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CardSummary() {
  return (
    <div>
      <Link href="/dashboard/billing" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#7d8798] hover:text-[#232946]">
        <ArrowLeft className="h-4 w-4" /> Billing
      </Link>
      <span className="mt-6 flex h-12 w-12 items-center justify-center rounded-control bg-primary/10 text-primary">
        <CreditCard className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-[2rem] font-semibold leading-tight tracking-[-0.04em] sm:text-[2.5rem]">Update your card</h1>
      <p className="mt-3 max-w-md text-[0.95rem] leading-7 text-[#7d8798]">
        The card you save here pays for your plan from the next bill on. Nothing is charged now.
      </p>
    </div>
  );
}

function PaymentSkeleton() {
  return (
    <Panel>
      <div className="space-y-3" aria-hidden="true">
        <div className="h-5 w-24 animate-pulse rounded bg-[#eef0f5]" />
        <div className="h-11 animate-pulse rounded-control bg-[#eef0f5]" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-11 animate-pulse rounded-control bg-[#eef0f5]" />
          <div className="h-11 animate-pulse rounded-control bg-[#eef0f5]" />
        </div>
        <div className="h-11 animate-pulse rounded-control bg-[#eef0f5]" />
        <div className="h-12 animate-pulse rounded-full bg-[#eef0f5]" />
      </div>
      <p className="mt-4 flex items-center gap-2 text-sm text-[#9aa3b2]">
        <Loader2 className="h-4 w-4 animate-spin" /> Preparing a secure payment form…
      </p>
    </Panel>
  );
}

function PaymentForm({ isCardMode, planName }: { isCardMode: boolean; planName: string | null }) {
  const state = useCheckoutElements();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  if (state.type === "loading") return <PaymentSkeleton />;
  if (state.type === "error") {
    return (
      <Panel>
        <p className="font-semibold">The payment form couldn&apos;t load</p>
        <p className="mt-2 text-sm text-[#7d8798]">{state.error.message}</p>
      </Panel>
    );
  }

  const { checkout } = state;
  const line = checkout.lineItems[0];
  const discounts = checkout.discountAmounts ?? [];
  const appliedCode = discounts.find((discount) => discount.promotionCode)?.promotionCode ?? null;
  const dueNow = checkout.total.total;
  const recurring = checkout.recurring;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    // Success leaves this page for `return_url`; only a failure comes back.
    const result = await checkout.confirm();
    if (result.type === "error") setMessage(result.error.message);
    setSubmitting(false);
  };

  const applyCode = async () => {
    if (!code.trim()) return;
    setCodeBusy(true);
    setCodeError(null);
    const result = await checkout.applyPromotionCode(code.trim());
    if (result.type === "error") setCodeError(result.error.message);
    else setCode("");
    setCodeBusy(false);
  };

  return (
    <form onSubmit={onSubmit}>
      <Panel>
        {!isCardMode && line ? (
          <div className="mb-6 space-y-2.5 border-b border-[#eef0f5] pb-6 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[#5b6478]">
                {planName ? `Present ${planName}` : line.name}
                {line.recurring ? `, billed ${line.recurring.interval}ly` : ""}
              </span>
              <span className="font-medium">{line.subtotal.amount}</span>
            </div>
            {discounts.map((discount) => (
              <div key={discount.displayName} className="flex items-baseline justify-between gap-3 text-emerald-700">
                <span className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" /> {discount.displayName}
                  {discount.promotionCode ? (
                    <button
                      type="button"
                      onClick={() => void checkout.removePromotionCode()}
                      aria-label={`Remove ${discount.promotionCode}`}
                      className="rounded-full p-0.5 text-emerald-700/70 hover:bg-emerald-50 hover:text-emerald-800"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </span>
                <span>-{discount.amount}</span>
              </div>
            ))}
            {checkout.total.taxExclusive.minorUnitsAmount > 0 ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[#5b6478]">Tax</span>
                <span>{checkout.total.taxExclusive.amount}</span>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-3 pt-1 text-base">
              <span className="font-semibold">Due today</span>
              <span className="font-semibold">{dueNow.amount}</span>
            </div>
            {recurring ? (
              <p className="text-[0.8rem] text-[#9aa3b2]">
                Then {recurring.dueNext.total.amount} every {recurring.interval}. Cancel any time from Billing.
              </p>
            ) : null}
          </div>
        ) : null}

        <p className="mb-3 text-sm font-semibold">{isCardMode ? "New card" : "Payment"}</p>
        <PaymentElement options={{ layout: { type: "tabs" } }} />

        {!isCardMode && !appliedCode ? (
          showCode ? (
            <div className="mt-5">
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void applyCode();
                    }
                  }}
                  placeholder="Promo code"
                  aria-label="Promo code"
                  className="h-11 min-w-0 flex-1 rounded-control border border-[#e4e6ee] px-3.5 text-[0.95rem] uppercase outline-none transition placeholder:normal-case placeholder:text-[#a3aaba] focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
                />
                <button
                  type="button"
                  onClick={() => void applyCode()}
                  disabled={codeBusy || !code.trim()}
                  className="h-11 flex-none rounded-full border border-[#e4e6ee] px-4 text-sm font-semibold transition hover:border-primary/40 hover:text-primary disabled:opacity-50"
                >
                  {codeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                </button>
              </div>
              {codeError ? <p className="mt-2 text-sm text-red-600">{codeError}</p> : null}
            </div>
          ) : (
            <button type="button" onClick={() => setShowCode(true)} className="mt-5 text-sm font-medium text-primary hover:underline">
              Have a promo code?
            </button>
          )
        ) : null}

        {message ? (
          <p role="alert" className="mt-5 rounded-control bg-red-50 px-3.5 py-2.5 text-sm text-red-600">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting || !checkout.canConfirm}
          className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-[0.95rem] font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          {isCardMode ? "Save card" : dueNow.minorUnitsAmount > 0 ? `Pay ${dueNow.amount}` : "Start plan"}
        </button>
        <p className="mt-4 text-center text-[0.78rem] leading-5 text-[#9aa3b2]">
          Payments are processed by Stripe. Your card details never reach Present&apos;s servers.
        </p>
      </Panel>
    </form>
  );
}
