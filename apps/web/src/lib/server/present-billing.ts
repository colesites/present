import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import type Stripe from "stripe";
import { planKeyOfPrice } from "./stripe-plan";
import { syncUserBillingToConvex } from "./billing-sync";
import { getPresentPlanDefinition, type PresentPlanKey } from "../../../../../packages/shared/src/billing";

/**
 * Present's billing, as the dashboard's own pages drive it.
 *
 * Stripe still takes the payment and keeps the subscription; what changed is
 * that nobody leaves the site to do it. A plan is bought on Present's
 * checkout page with Stripe's Payment Element inside it (a Checkout Session
 * with `ui_mode: "elements"`), and changed, cancelled or given a new card from
 * the Billing page, instead of Stripe's hosted checkout and billing portal.
 */

/** The prices someone can buy. Free is what they have without one. */
export const PURCHASABLE_LOOKUP_KEYS = [
  "present_pro_plan",
  "present_pro_plan_yr",
  "present_power_plan",
  "present_power_plan_yr",
] as const;

export type PurchasableLookupKey = (typeof PURCHASABLE_LOOKUP_KEYS)[number];

export const isPurchasable = (value: unknown): value is PurchasableLookupKey =>
  PURCHASABLE_LOOKUP_KEYS.includes(value as PurchasableLookupKey);

/** Subscription states that mean someone is on (or still owes for) a plan. */
const LIVE_STATUSES = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due", "incomplete"]);

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** The signed-in person, or a 401. */
export const requireUser = async () => {
  const { userId, getToken } = await auth();
  if (!userId) throw new BillingError("Sign in first.", 401);
  return { userId, getToken };
};

/** Where Stripe sends someone back to: this site, as the request reached it. */
export const siteOrigin = (request: Request) => {
  const configured = process.env.WEB_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
};

export const publishableKey = () => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) throw new BillingError("Payments aren't set up on this site yet.", 500);
  return key;
};

export const priceFor = async (stripe: Stripe, lookupKey: PurchasableLookupKey) => {
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, expand: ["data.product"], limit: 1 });
  const price = prices.data[0];
  if (!price) throw new BillingError("That plan isn't available right now.", 404);
  return price;
};

export const findCustomer = async (stripe: Stripe, userId: string) => {
  const found = await stripe.customers.search({ limit: 1, query: `metadata["userId"]:"${userId}"` });
  return found.data[0] ?? null;
};

/** Their Stripe customer, made the first time, with a name and email for receipts. */
export const ensureCustomer = async (stripe: Stripe, userId: string) => {
  const existing = await findCustomer(stripe, userId);
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? undefined;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || undefined;
  if (existing) {
    if ((email && existing.email !== email) || (name && !existing.name)) {
      return await stripe.customers.update(existing.id, { email, name: existing.name ?? name });
    }
    return existing;
  }
  return await stripe.customers.create({ email, name, metadata: { userId } });
};

export type PresentSubscription = {
  subscription: Stripe.Subscription;
  item: Stripe.SubscriptionItem;
  planKey: PresentPlanKey;
};

/** The Present plan they are paying for, if any. Other products are ignored. */
export const currentSubscription = async (stripe: Stripe, customerId: string): Promise<PresentSubscription | null> => {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
    expand: ["data.items.data.price.product", "data.default_payment_method"],
  });
  const ranked = subscriptions.data
    .filter((subscription) => LIVE_STATUSES.has(subscription.status))
    .sort((a, b) => b.created - a.created);
  for (const subscription of ranked) {
    const item = subscription.items.data[0];
    if (!item) continue;
    const planKey = await planKeyOfPrice(stripe, item.price);
    if (planKey !== "free") return { subscription, item, planKey };
  }
  return null;
};

/**
 * Tell Convex straight away, instead of waiting for the webhook, so the plan
 * someone just bought is the one the app shows on its next look.
 */
export const syncNow = async (userId: string, getToken: (options: { template: string }) => Promise<string | null>) => {
  const convexToken = await getToken({ template: "convex" });
  if (!convexToken) return;
  const user = await currentUser();
  await syncUserBillingToConvex({
    userId,
    convexToken,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
  }).catch((error) => console.error("[Billing] sync after a change failed; the webhook will catch up", error));
};

export const planLabelOf = (planKey: PresentPlanKey) => getPresentPlanDefinition(planKey).label;

/** A route's answer when something went wrong, without leaking Stripe's internals. */
export const billingErrorResponse = (error: unknown, context: string) => {
  if (error instanceof BillingError) return new Response(error.message, { status: error.status });
  const stripeMessage = (error as { type?: string; message?: string } | null)?.type?.startsWith("Stripe")
    ? (error as { message?: string }).message
    : null;
  console.error(`[Billing] ${context}`, error);
  return new Response(stripeMessage ?? "Something went wrong with billing. Try again.", { status: 500 });
};
