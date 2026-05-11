import { PricingTable, SignInButton } from "@clerk/nextjs";
import Link from "next/link";

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-16 text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <div className="space-y-4">
          <Link href="/" className="text-sm text-muted-foreground transition hover:text-foreground">
            Back to home
          </Link>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary/70">
              Pricing
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Speech search plans for Present
            </h1>
            <p className="max-w-3xl text-base text-muted-foreground sm:text-lg">
              Free includes 1 hour per month of speech-to-search. Pro includes 15
              hours. Power includes 30 hours.
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <SignInButton mode="modal">
            <button className="rounded-full border border-border px-4 py-2 text-sm transition hover:border-primary hover:text-primary">
              Sign in to subscribe
            </button>
          </SignInButton>
        </div>

        <PricingTable
          for="user"
          collapseFeatures={false}
          ctaPosition="bottom"
          newSubscriptionRedirectUrl="/pricing"
        />
      </div>
    </main>
  );
}
