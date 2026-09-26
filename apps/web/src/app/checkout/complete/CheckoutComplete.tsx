"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { AlertCircle, ArrowUpRight, Check, Loader2 } from "lucide-react";
import { CheckoutFrame } from "../CheckoutClient";

type Outcome =
  | { kind: "subscription"; status: string; planLabel: string; interval: string | null }
  | { kind: "payment-method"; status: string };

/**
 * Where Stripe sends someone after they pay or save a card. What happened is
 * asked of the server (`/api/stripe/checkout/status`), which also puts the
 * new plan in place, rather than taken from the address bar.
 */
export function CheckoutComplete() {
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const { isLoaded, isSignedIn } = useAuth();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.replace(`/sign-in?next=${encodeURIComponent(`${pathname}?${params.toString()}`)}`);
    }
  }, [isLoaded, isSignedIn, params, pathname, router]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !sessionId) return;
    let cancelled = false;
    void fetch(`/api/stripe/checkout/status?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.text()) || "We couldn't check that payment.");
        return (await response.json()) as Outcome;
      })
      .then((result) => {
        if (!cancelled) setOutcome(result);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : "We couldn't check that payment.");
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, sessionId]);

  const complete = outcome?.status === "complete";
  const problem = sessionId ? error : "This page needs the link Stripe sent you back with.";

  return (
    <CheckoutFrame>
      <div className="mx-auto max-w-md rounded-card border border-[#e9ebf2] bg-white p-6 text-center shadow-[0_1px_2px_rgba(35,41,70,0.04)] sm:p-8">
        {problem ? (
          <>
            <Badge tone="error" />
            <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">Something went wrong</h1>
            <p className="mt-2 text-sm leading-6 text-[#7d8798]">{problem}</p>
            <Link href="/dashboard/billing" className={primaryButton}>
              Go to Billing
            </Link>
          </>
        ) : !outcome ? (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-sm text-[#7d8798]">Confirming with Stripe…</p>
          </>
        ) : outcome.kind === "payment-method" ? (
          complete ? (
            <>
              <Badge tone="ok" />
              <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">Card saved</h1>
              <p className="mt-2 text-sm leading-6 text-[#7d8798]">Your next bill goes on the card you just added.</p>
              <Link href="/dashboard/billing" className={primaryButton}>
                Back to Billing
              </Link>
            </>
          ) : (
            <Failed retry="/checkout?mode=card" what="The card wasn't saved." />
          )
        ) : complete ? (
          <>
            <Badge tone="ok" />
            <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">You&apos;re on {outcome.planLabel}</h1>
            <p className="mt-2 text-sm leading-6 text-[#7d8798]">
              Thank you. Everything in {outcome.planLabel} is ready now, in the desktop app and here. A receipt is on its way
              to your email.
            </p>
            <div className="mt-6 grid gap-2">
              <a href="present://open" className={`${primaryButton} mt-0`}>
                Open Present <ArrowUpRight className="h-4 w-4" />
              </a>
              <Link
                href="/dashboard"
                className="inline-flex h-11 items-center justify-center rounded-full border border-[#e4e6ee] px-5 text-sm font-semibold transition hover:border-primary/40 hover:text-primary"
              >
                Go to the dashboard
              </Link>
            </div>
          </>
        ) : (
          <Failed retry="/pricing" what="The payment didn't go through, so nothing was charged." />
        )}
      </div>
    </CheckoutFrame>
  );
}

const primaryButton =
  "mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-white transition hover:bg-primary/90";

function Badge({ tone }: { tone: "ok" | "error" }) {
  return (
    <span
      className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${
        tone === "ok" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
      }`}
    >
      {tone === "ok" ? <Check className="h-7 w-7" /> : <AlertCircle className="h-7 w-7" />}
    </span>
  );
}

function Failed({ retry, what }: { retry: string; what: string }) {
  return (
    <>
      <Badge tone="error" />
      <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">Not finished</h1>
      <p className="mt-2 text-sm leading-6 text-[#7d8798]">{what} Try again, or use another card.</p>
      <Link href={retry} className={primaryButton}>
        Try again
      </Link>
    </>
  );
}
