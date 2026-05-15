import { getStripe } from "@/lib/server/stripe";

/**
 * Lookup key naming convention:
 *   free_plan, pro_plan, power_plan       (monthly)
 *   free_plan_yr, pro_plan_yr, power_plan_yr  (yearly)
 */
const MONTHLY_LOOKUP_KEYS = ["free_plan", "pro_plan", "power_plan"];
const YEARLY_LOOKUP_KEYS = ["free_plan_yr", "pro_plan_yr", "power_plan_yr"];

const PLAN_DESCRIPTIONS: Record<string, string> = {
  free: "For churches getting started with Present.",
  pro: "For teams using Present consistently every week.",
  power: "For ministries and organizations running Present at scale.",
};

const PLAN_FEATURES: Record<string, string[]> = {
  free: [
    "Basic Features",
    "Multi User Collaboration",
    "Speech To Search 1hr/month",
    "Auto Fix Lyrics",
    "Cloud Storage Access",
  ],
  pro: [
    "Basic Features",
    "Multi User Collaboration",
    "Speech To Search 15hrs/month",
    "Auto Fix Lyrics",
    "Cloud Storage Access",
  ],
  power: [
    "Basic Features",
    "Multi User Collaboration",
    "Speech To Search 30hr/month",
    "Auto Fix Lyrics",
    "Cloud Storage Access",
  ],
};

function resolvePlanSlug(lookupKey: string): string {
  if (lookupKey.startsWith("free")) return "free";
  if (lookupKey.startsWith("pro")) return "pro";
  if (lookupKey.startsWith("power")) return "power";
  return "free";
}

export async function GET() {
  try {
    const stripe = getStripe();

    const allLookupKeys = [...MONTHLY_LOOKUP_KEYS, ...YEARLY_LOOKUP_KEYS];
    const prices = await stripe.prices.list({
      lookup_keys: allLookupKeys,
      expand: ["data.product"],
      active: true,
      limit: 20,
    });

    // Group prices by plan slug
    const planMap = new Map<
      string,
      {
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
      }
    >();

    for (const price of prices.data) {
      const lookupKey = price.lookup_key;
      if (!lookupKey) continue;

      const slug = resolvePlanSlug(lookupKey);
      const isYearly = lookupKey.endsWith("_yr");
      const product =
        typeof price.product === "object" && price.product !== null
          ? (price.product as { name?: string })
          : null;

      const existing = planMap.get(slug) ?? {
        slug,
        name: product?.name ?? slug.charAt(0).toUpperCase() + slug.slice(1),
        description: PLAN_DESCRIPTIONS[slug] ?? null,
        features: PLAN_FEATURES[slug] ?? [],
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
      };

      const amount = (price.unit_amount ?? 0) / 100;

      if (isYearly) {
        existing.yearlyPrice = amount;
        existing.yearlyPriceFormatted = amount.toFixed(2);
        existing.yearlyPriceId = price.id;
        existing.yearlyLookupKey = lookupKey;

        // Monthly equivalent = yearly / 12
        const monthlyEquiv = amount / 12;
        existing.yearlyMonthlyPrice = Math.round(monthlyEquiv * 100) / 100;
        existing.yearlyMonthlyPriceFormatted = existing.yearlyMonthlyPrice.toFixed(2);
      } else {
        existing.monthlyPrice = amount;
        existing.monthlyPriceFormatted = amount.toFixed(2);
        existing.monthlyPriceId = price.id;
        existing.monthlyLookupKey = lookupKey;
      }

      planMap.set(slug, existing);
    }

    // Sort plans: free → pro → power
    const ORDER = ["free", "pro", "power"];
    const plans = Array.from(planMap.values()).sort(
      (a, b) => ORDER.indexOf(a.slug) - ORDER.indexOf(b.slug),
    );

    return Response.json({ plans });
  } catch (error) {
    console.error("[Stripe Plans] Error:", error);
    return new Response(
      error instanceof Error ? error.message : "Failed to load plans",
      { status: 500 },
    );
  }
}
