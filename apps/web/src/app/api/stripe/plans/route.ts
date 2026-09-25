import type Stripe from "stripe";

import { getStripe } from "@/lib/server/stripe";
import { resolvePresentPlanKey } from "../../../../../../../packages/shared/src/billing";

/**
 * The prices on the pricing page, by lookup key. Each plan is its own Stripe
 * product with a monthly price and, for the paid ones, a yearly one. Free has
 * no yearly price; the page shows $0 either way.
 */
const LOOKUP_KEYS = [
  "present_free_plan",
  "present_free_plan_yr",
  "present_pro_plan",
  "present_pro_plan_yr",
  "present_power_plan",
  "present_power_plan_yr",
];

type Plan = {
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

/**
 * What the product says about itself. Name, description and feature list are
 * all edited in Stripe, so a change there reaches the page without a deploy.
 * A "Present " prefix, there to tell the products apart in a shared Stripe
 * account, is dropped: the page is already Present's.
 */
const describe = (product: Stripe.Product | null, slug: string) => ({
  name: product?.name?.replace(/^present\s+/i, "").trim() || slug.charAt(0).toUpperCase() + slug.slice(1),
  description: product?.description ?? null,
  features: (product?.marketing_features ?? [])
    .map((feature) => feature.name?.trim() ?? "")
    .filter(Boolean),
});

export async function GET() {
  try {
    const stripe = getStripe();
    const prices = await stripe.prices.list({
      lookup_keys: LOOKUP_KEYS,
      expand: ["data.product"],
      active: true,
      limit: 20,
    });

    const plans = new Map<string, Plan>();

    for (const price of prices.data) {
      const product =
        typeof price.product === "object" && price.product !== null && !("deleted" in price.product)
          ? (price.product as Stripe.Product)
          : null;
      const slug = resolvePresentPlanKey(product?.metadata?.plan || price.lookup_key);
      const isYearly = price.recurring?.interval === "year";

      const plan =
        plans.get(slug) ??
        ({
          slug,
          ...describe(product, slug),
          monthlyPrice: null,
          monthlyPriceFormatted: null,
          yearlyPrice: null,
          yearlyPriceFormatted: null,
          yearlyMonthlyPrice: null,
          yearlyMonthlyPriceFormatted: null,
          currency: price.currency,
          monthlyPriceId: null,
          yearlyPriceId: null,
          monthlyLookupKey: null,
          yearlyLookupKey: null,
        } satisfies Plan);

      const amount = (price.unit_amount ?? 0) / 100;
      if (isYearly) {
        plan.yearlyPrice = amount;
        plan.yearlyPriceFormatted = amount.toFixed(2);
        plan.yearlyPriceId = price.id;
        plan.yearlyLookupKey = price.lookup_key;
        plan.yearlyMonthlyPrice = Math.round((amount / 12) * 100) / 100;
        plan.yearlyMonthlyPriceFormatted = plan.yearlyMonthlyPrice.toFixed(2);
      } else {
        plan.monthlyPrice = amount;
        plan.monthlyPriceFormatted = amount.toFixed(2);
        plan.monthlyPriceId = price.id;
        plan.monthlyLookupKey = price.lookup_key;
      }

      plans.set(slug, plan);
    }

    const ORDER = ["free", "pro", "power"];
    return Response.json({
      plans: [...plans.values()].sort((a, b) => ORDER.indexOf(a.slug) - ORDER.indexOf(b.slug)),
    });
  } catch (error) {
    console.error("[Stripe Plans] Error:", error);
    return new Response(
      error instanceof Error ? error.message : "Failed to load plans",
      { status: 500 },
    );
  }
}
