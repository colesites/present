"use client";

import { PricingShowcase } from "@/components/pricing/PricingShowcase";

export function Pricing() {
  return (
    <section id="pricing" className="relative overflow-hidden bg-background py-32">
      <div className="container relative z-10 mx-auto px-6">
        <div className="mx-auto mb-20 max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary/70">
            Pricing
          </p>
          <h2 className="mt-5 text-5xl font-semibold tracking-[-0.08em] text-white sm:text-6xl lg:text-7xl">
            Built for every stage
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-white/55 sm:text-lg">
            Choose the plan that fits your team, from a weekly small group to a packed conference hall.
          </p>
        </div>

        <PricingShowcase compact redirectUrl="/pricing" />
      </div>
    </section>
  );
}
