import Link from "next/link";

import { PricingShowcase } from "@/components/pricing/PricingShowcase";

export default function PricingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-6 py-16 text-foreground">
      <div className="relative mx-auto flex max-w-7xl flex-col gap-12">
        <div className="space-y-5">
          <Link
            href="/"
            className="inline-flex text-sm text-white/55 transition hover:text-white"
          >
            Back to home
          </Link>

          <div className="max-w-3xl space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary/70">
              Pricing
            </p>
            <h1 className="text-4xl font-semibold tracking-[-0.07em] text-white sm:text-5xl lg:text-6xl">
              Built for every stage
            </h1>
            <p className="text-base leading-7 text-white/55 sm:text-lg">
              Choose the plan that fits your congregation. From local small groups to global cathedrals.
            </p>
          </div>
        </div>

        <PricingShowcase redirectUrl="/pricing" />
      </div>
    </main>
  );
}
