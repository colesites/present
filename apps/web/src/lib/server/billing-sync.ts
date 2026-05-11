import "server-only";

import { clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../packages/backend/convex/_generated/api";
import {
  getPresentPlanDefinition,
  resolvePresentPlanKey,
} from "../../../../../packages/shared/src/billing";

type ClerkSubscriptionItem = {
  id?: string | null;
  status?: string | null;
  periodStart?: number | Date | string | null;
  periodEnd?: number | Date | string | null;
  plan?: {
    slug?: string | null;
    name?: string | null;
  } | null;
};

const toTimestampMs = (
  value: number | Date | string | null | undefined,
): number | null => {
  if (!value) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value !== "string") {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const getFallbackPeriodWindow = () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    periodStartMs: start.getTime(),
    periodEndMs: end.getTime(),
  };
};

const pickPrimarySubscriptionItem = (
  items: ClerkSubscriptionItem[],
): ClerkSubscriptionItem | null => {
  const active =
    items.find((item) => item.status === "active") ??
    items.find((item) => item.status === "canceled") ??
    items.find((item) => item.status === "past_due") ??
    items[0];

  return active ?? null;
};

export const syncUserBillingToConvex = async (input: {
  userId: string;
  convexToken: string;
}) => {
  const client = await clerkClient();
  const subscription = await client.billing.getUserBillingSubscription(input.userId);
  const selectedItem = pickPrimarySubscriptionItem(
    (((subscription as unknown) as { subscriptionItems?: ClerkSubscriptionItem[] }).subscriptionItems ??
      []) as ClerkSubscriptionItem[],
  );

  const planSlug = selectedItem?.plan?.slug ?? null;
  const planLabel = selectedItem?.plan?.name ?? null;
  const planKey = resolvePresentPlanKey(planSlug ?? planLabel);
  const plan = getPresentPlanDefinition(planKey);
  const fallbackPeriod = getFallbackPeriodWindow();
  const periodStartMs =
    toTimestampMs(selectedItem?.periodStart) ?? fallbackPeriod.periodStartMs;
  const periodEndMs =
    toTimestampMs(selectedItem?.periodEnd) ?? fallbackPeriod.periodEndMs;

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
  }

  const convex = new ConvexHttpClient(convexUrl, { auth: input.convexToken });
  await convex.mutation(api.billing.syncUserBillingFromServer, {
    userId: input.userId,
    planSlug: planSlug ?? plan.key,
    planLabel: planLabel ?? plan.label,
    status: selectedItem?.status ?? "active",
    periodStartMs,
    periodEndMs,
    clerkSubscriptionId:
      (subscription as { id?: string | null }).id ?? undefined,
    clerkSubscriptionItemId: selectedItem?.id ?? undefined,
  });
};

export const syncUserBillingToConvexFromWebhook = async (input: {
  userId: string;
}) => {
  const webhookSecret = process.env.CLERK_BILLING_SYNC_SECRET;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!webhookSecret || !convexUrl) {
    throw new Error("Missing Clerk billing sync configuration");
  }

  const client = await clerkClient();
  const subscription = await client.billing.getUserBillingSubscription(input.userId);
  const selectedItem = pickPrimarySubscriptionItem(
    (((subscription as unknown) as { subscriptionItems?: ClerkSubscriptionItem[] }).subscriptionItems ??
      []) as ClerkSubscriptionItem[],
  );

  const planSlug = selectedItem?.plan?.slug ?? null;
  const planLabel = selectedItem?.plan?.name ?? null;
  const planKey = resolvePresentPlanKey(planSlug ?? planLabel);
  const plan = getPresentPlanDefinition(planKey);
  const fallbackPeriod = getFallbackPeriodWindow();
  const periodStartMs =
    toTimestampMs(selectedItem?.periodStart) ?? fallbackPeriod.periodStartMs;
  const periodEndMs =
    toTimestampMs(selectedItem?.periodEnd) ?? fallbackPeriod.periodEndMs;

  const convex = new ConvexHttpClient(convexUrl);
  await convex.mutation(api.billing.syncUserBillingFromWebhook, {
    secret: webhookSecret,
    userId: input.userId,
    planSlug: planSlug ?? plan.key,
    planLabel: planLabel ?? plan.label,
    status: selectedItem?.status ?? "active",
    periodStartMs,
    periodEndMs,
    clerkSubscriptionId:
      (subscription as { id?: string | null }).id ?? undefined,
    clerkSubscriptionItemId: selectedItem?.id ?? undefined,
  });
};
