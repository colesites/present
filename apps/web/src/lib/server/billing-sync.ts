import "server-only";

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../packages/backend/convex/_generated/api";
import { getStripe } from "./stripe";
import { planKeyOfPrice } from "./stripe-plan";
import {
  getPresentPlanDefinition,
  resolvePresentPlanKey,
} from "../../../../../packages/shared/src/billing";

/**
 * Syncs a user's Stripe subscription state to Convex.
 *
 * Called from the AssemblyAI token route so the billing record is fresh
 * before we check speech-to-search quotas.
 */
export const syncUserBillingToConvex = async (input: {
  userId: string;
  convexToken: string;
  email?: string | null;
}) => {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
  }

  const stripe = getStripe();
  const billingSyncSecret = process.env.STRIPE_BILLING_SYNC_SECRET;
  const allowlistEmail =
    input.email && billingSyncSecret ? input.email : undefined;

  // Look up the Stripe customer by the Clerk user ID stored in metadata
  const customers = await stripe.customers.search({
    limit: 1,
    expand: ["data.subscriptions"],
    query: `metadata["userId"]:"${input.userId}"`,
  });

  const customer = customers.data[0] ?? null;

  if (!customer) {
    // No Stripe customer → free plan
    const freePlan = getPresentPlanDefinition("free");
    const fallbackPeriod = getFallbackPeriodWindow();

    const convex = new ConvexHttpClient(convexUrl, { auth: input.convexToken });
    await convex.mutation(api.billing.syncUserBillingFromServer, {
      userId: input.userId,
      secret: allowlistEmail ? billingSyncSecret : undefined,
      email: allowlistEmail,
      planSlug: freePlan.key,
      planLabel: freePlan.label,
      status: "active",
      periodStartMs: fallbackPeriod.periodStartMs,
      periodEndMs: fallbackPeriod.periodEndMs,
    });
    return;
  }

  // Find the most relevant subscription
  const subscriptions = customer.subscriptions?.data ?? [];
  const sub =
    subscriptions.find((s) => s.status === "active") ??
    subscriptions.find((s) => s.status === "trialing") ??
    subscriptions.find((s) => s.status === "past_due") ??
    subscriptions[0] ??
    null;

  if (!sub) {
    // Customer exists but no subscription → free plan
    const freePlan = getPresentPlanDefinition("free");
    const fallbackPeriod = getFallbackPeriodWindow();

    const convex = new ConvexHttpClient(convexUrl, { auth: input.convexToken });
    await convex.mutation(api.billing.syncUserBillingFromServer, {
      userId: input.userId,
      secret: allowlistEmail ? billingSyncSecret : undefined,
      email: allowlistEmail,
      planSlug: freePlan.key,
      planLabel: freePlan.label,
      status: "active",
      periodStartMs: fallbackPeriod.periodStartMs,
      periodEndMs: fallbackPeriod.periodEndMs,
      stripeSubscriptionId: undefined,
      stripeCustomerId: customer.id,
    });
    return;
  }

  const item = sub.items.data[0];
  const planKey = await planKeyOfPrice(stripe, item?.price);
  const plan = getPresentPlanDefinition(planKey);

  const periodStartMs = (item?.current_period_start ?? 0) * 1000;
  const periodEndMs = (item?.current_period_end ?? 0) * 1000;

  const convex = new ConvexHttpClient(convexUrl, { auth: input.convexToken });
  await convex.mutation(api.billing.syncUserBillingFromServer, {
    userId: input.userId,
    secret: allowlistEmail ? billingSyncSecret : undefined,
    email: allowlistEmail,
    planSlug: plan.key,
    planLabel: plan.label,
    status: sub.status,
    periodStartMs,
    periodEndMs,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customer.id,
  });
};

/**
 * Syncs billing from a Stripe webhook event (no auth token needed).
 */
export const syncUserBillingToConvexFromWebhook = async (input: {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  status: string;
  planLookupKey: string | null;
  periodStartMs: number;
  periodEndMs: number;
}) => {
  const webhookSecret = process.env.STRIPE_BILLING_SYNC_SECRET;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!webhookSecret || !convexUrl) {
    throw new Error("Missing Stripe billing sync configuration");
  }

  const planKey = resolvePresentPlanKey(input.planLookupKey);
  const plan = getPresentPlanDefinition(planKey);

  const convex = new ConvexHttpClient(convexUrl);
  await convex.mutation(api.billing.syncUserBillingFromWebhook, {
    secret: webhookSecret,
    userId: input.userId,
    planSlug: plan.key,
    planLabel: plan.label,
    status: input.status,
    periodStartMs: input.periodStartMs,
    periodEndMs: input.periodEndMs,
    stripeSubscriptionId: input.stripeSubscriptionId ?? undefined,
    stripeCustomerId: input.stripeCustomerId,
  });
};

function getFallbackPeriodWindow() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return {
    periodStartMs: start.getTime(),
    periodEndMs: end.getTime(),
  };
}
