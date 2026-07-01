declare const process: {
  env: Record<string, string | undefined>;
};

import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import {
  getPresentPlanDefinition,
  resolvePresentPlanKey,
  type PresentBillingStatus,
} from "../../shared/src/billing";

const DEFAULT_SPEECH_SESSION_MAX_SECONDS = 15 * 60;
const DEFAULT_ALLOWLISTED_SPEECH_QUOTA_SECONDS = 100 * 365 * 24 * 60 * 60;

function normalizeEmail(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

function getIdentityEmail(identity: unknown): string | null {
  const record = identity as
    | {
        email?: unknown;
        emailAddress?: unknown;
        email_address?: unknown;
      }
    | null
    | undefined;

  return (
    normalizeEmail(record?.email) ??
    normalizeEmail(record?.emailAddress) ??
    normalizeEmail(record?.email_address)
  );
}

async function resolveAllowlistedSpeechQuotaSeconds(
  ctx: any,
  email: string | null,
): Promise<number | null> {
  if (!email) {
    return null;
  }

  const allowlistEntry = await ctx.db
    .query("speechQuotaAllowlist")
    .withIndex("by_normalized_email", (q: any) => q.eq("normalizedEmail", email))
    .first();

  return allowlistEntry?.quotaSeconds ?? null;
}

function withSpeechQuotaOverride<T extends { quotaSeconds: number }>(
  billing: T,
  quotaSeconds: number | null,
): T {
  if (typeof quotaSeconds !== "number") {
    return billing;
  }

  return {
    ...billing,
    quotaSeconds: Math.max(billing.quotaSeconds, quotaSeconds),
  };
}

function getCurrentBillingPeriodWindow() {
  const now = new Date();
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );

  return {
    periodStartMs: periodStart.getTime(),
    periodEndMs: periodEnd.getTime(),
  };
}

function getPeriodKey(periodStartMs: number, periodEndMs: number) {
  return `${periodStartMs}:${periodEndMs}`;
}

function assertBillingSyncSecret(secret: string | undefined) {
  const expected = process.env.STRIPE_BILLING_SYNC_SECRET;
  if (!expected || secret !== expected) {
    throw new ConvexError("Unauthorized billing sync.");
  }
}

function clampSessionDurationSeconds(input: {
  startedAtMs: number;
  endedAtMs?: number;
  maxDurationSeconds: number;
}) {
  const endMs =
    typeof input.endedAtMs === "number" ? input.endedAtMs : Date.now();
  const elapsedSeconds = Math.max(
    0,
    Math.ceil((endMs - input.startedAtMs) / 1000),
  );
  return Math.min(input.maxDurationSeconds, elapsedSeconds);
}

async function resolveUserBillingState(
  ctx: any,
  userId: string,
  email?: string | null,
) {
  const allowlistedQuotaSeconds = await resolveAllowlistedSpeechQuotaSeconds(
    ctx,
    email ?? null,
  );
  const existing = await ctx.db
    .query("userBilling")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .first();

  if (existing) {
    return withSpeechQuotaOverride(existing, allowlistedQuotaSeconds);
  }

  const { periodStartMs, periodEndMs } = getCurrentBillingPeriodWindow();
  const freePlan = getPresentPlanDefinition("free");

  return withSpeechQuotaOverride({
    _id: null,
    _creationTime: 0,
    userId,
    planKey: freePlan.key,
    planLabel: freePlan.label,
    planSlug: freePlan.key,
    status: "active",
    quotaSeconds: freePlan.monthlySpeechLimitSeconds,
    periodStartMs,
    periodEndMs,
    stripeSubscriptionId: undefined,
    stripeCustomerId: undefined,
    updatedAt: 0,
  }, allowlistedQuotaSeconds);
}

async function computeSpeechUsage(ctx: {
  db: {
    query: typeof query extends infer _T ? any : never;
  };
}, input: {
  userId: string;
  periodStartMs: number;
  periodEndMs: number;
}) {
  const periodKey = getPeriodKey(input.periodStartMs, input.periodEndMs);
  const sessions = (await ctx.db
    .query("speechUsageSessions")
    .withIndex("by_user_period", (q: any) =>
      q.eq("userId", input.userId).eq("periodKey", periodKey),
    )
    .collect()) as Array<{
    startedAtMs: number;
    endedAtMs?: number;
    maxDurationSeconds: number;
  }>;

  return sessions.reduce((total, session) => {
    return (
      total +
      clampSessionDurationSeconds({
        startedAtMs: session.startedAtMs,
        endedAtMs: session.endedAtMs,
        maxDurationSeconds: session.maxDurationSeconds,
      })
    );
  }, 0);
}

export const getMyBillingStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const billing = await resolveUserBillingState(
      ctx,
      identity.subject,
      getIdentityEmail(identity),
    );
    const usedSeconds = await computeSpeechUsage(ctx, {
      userId: identity.subject,
      periodStartMs: billing.periodStartMs,
      periodEndMs: billing.periodEndMs,
    });

    return {
      planKey: billing.planKey,
      planLabel: billing.planLabel,
      planSlug: billing.planSlug ?? null,
      status: billing.status as PresentBillingStatus,
      isPaid: billing.planKey !== "free",
      quotaSeconds: billing.quotaSeconds,
      usedSeconds,
      remainingSeconds: Math.max(0, billing.quotaSeconds - usedSeconds),
      periodStartMs: billing.periodStartMs,
      periodEndMs: billing.periodEndMs,
      updatedAt: billing.updatedAt,
    };
  },
});

export const upsertSpeechQuotaAllowlistEntry = mutation({
  args: {
    secret: v.string(),
    email: v.string(),
    quotaSeconds: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertBillingSyncSecret(args.secret);

    const normalizedEmail = normalizeEmail(args.email);
    if (!normalizedEmail) {
      throw new ConvexError("Email is required.");
    }

    const now = Date.now();
    const quotaSeconds =
      args.quotaSeconds ?? DEFAULT_ALLOWLISTED_SPEECH_QUOTA_SECONDS;
    const existing = await ctx.db
      .query("speechQuotaAllowlist")
      .withIndex("by_normalized_email", (q) =>
        q.eq("normalizedEmail", normalizedEmail),
      )
      .first();

    const patch = {
      email: args.email.trim(),
      normalizedEmail,
      quotaSeconds,
      reason: args.reason?.trim() || undefined,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("speechQuotaAllowlist", {
      ...patch,
      createdAt: now,
    });
  },
});

export const syncUserBillingFromServer = mutation({
  args: {
    userId: v.string(),
    planSlug: v.optional(v.string()),
    planLabel: v.optional(v.string()),
    status: v.string(),
    periodStartMs: v.number(),
    periodEndMs: v.number(),
    stripeSubscriptionId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.subject !== args.userId) {
      throw new ConvexError("Unauthorized billing sync.");
    }

    const planKey = resolvePresentPlanKey(args.planSlug ?? args.planLabel);
    const plan = getPresentPlanDefinition(planKey);
    const existing = await ctx.db
      .query("userBilling")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const patch = {
      userId: args.userId,
      planKey,
      planLabel: args.planLabel?.trim() || plan.label,
      planSlug: args.planSlug?.trim() || plan.key,
      status: args.status,
      quotaSeconds: plan.monthlySpeechLimitSeconds,
      periodStartMs: args.periodStartMs,
      periodEndMs: args.periodEndMs,
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripeCustomerId: args.stripeCustomerId,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("userBilling", patch);
  },
});

export const syncUserBillingFromWebhook = mutation({
  args: {
    secret: v.string(),
    userId: v.string(),
    planSlug: v.optional(v.string()),
    planLabel: v.optional(v.string()),
    status: v.string(),
    periodStartMs: v.number(),
    periodEndMs: v.number(),
    stripeSubscriptionId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertBillingSyncSecret(args.secret);

    const planKey = resolvePresentPlanKey(args.planSlug ?? args.planLabel);
    const plan = getPresentPlanDefinition(planKey);
    const existing = await ctx.db
      .query("userBilling")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const patch = {
      userId: args.userId,
      planKey,
      planLabel: args.planLabel?.trim() || plan.label,
      planSlug: args.planSlug?.trim() || plan.key,
      status: args.status,
      quotaSeconds: plan.monthlySpeechLimitSeconds,
      periodStartMs: args.periodStartMs,
      periodEndMs: args.periodEndMs,
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripeCustomerId: args.stripeCustomerId,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("userBilling", patch);
  },
});

export const startSpeechUsageSession = mutation({
  args: {
    source: v.union(v.literal("bible"), v.literal("library")),
    requestedMaxDurationSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    const userId = identity.subject;
    const billing = await resolveUserBillingState(
      ctx,
      userId,
      getIdentityEmail(identity),
    );
    const usedSeconds = await computeSpeechUsage(ctx, {
      userId,
      periodStartMs: billing.periodStartMs,
      periodEndMs: billing.periodEndMs,
    });
    const remainingSeconds = Math.max(0, billing.quotaSeconds - usedSeconds);
    if (remainingSeconds <= 0) {
      throw new ConvexError("Speech-to-search quota exhausted for this billing period.");
    }

    const allowedDurationSeconds = Math.max(
      1,
      Math.min(
        remainingSeconds,
        args.requestedMaxDurationSeconds ?? DEFAULT_SPEECH_SESSION_MAX_SECONDS,
      ),
    );
    const now = Date.now();

    const sessionId = await ctx.db.insert("speechUsageSessions", {
      userId,
      source: args.source,
      periodKey: getPeriodKey(billing.periodStartMs, billing.periodEndMs),
      startedAtMs: now,
      maxDurationSeconds: allowedDurationSeconds,
      createdAt: now,
      updatedAt: now,
    });

    return {
      sessionId,
      allowedDurationSeconds,
      billing: {
        planKey: billing.planKey,
        planLabel: billing.planLabel,
        planSlug: billing.planSlug ?? null,
        status: billing.status as PresentBillingStatus,
        isPaid: billing.planKey !== "free",
        quotaSeconds: billing.quotaSeconds,
        usedSeconds,
        remainingSeconds,
        periodStartMs: billing.periodStartMs,
        periodEndMs: billing.periodEndMs,
      },
    };
  },
});

export const completeSpeechUsageSession = mutation({
  args: {
    sessionId: v.id("speechUsageSessions"),
    endedAtMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== identity.subject) {
      throw new ConvexError("Speech session not found.");
    }

    const boundedEndedAtMs = Math.max(
      session.startedAtMs,
      Math.min(
        typeof args.endedAtMs === "number" ? args.endedAtMs : Date.now(),
        session.startedAtMs + session.maxDurationSeconds * 1000,
      ),
    );

    await ctx.db.patch(args.sessionId, {
      endedAtMs: boundedEndedAtMs,
      updatedAt: Date.now(),
    });

    const billing = await resolveUserBillingState(
      ctx,
      identity.subject,
      getIdentityEmail(identity),
    );
    const usedSeconds = await computeSpeechUsage(ctx, {
      userId: identity.subject,
      periodStartMs: billing.periodStartMs,
      periodEndMs: billing.periodEndMs,
    });

    return {
      sessionId: args.sessionId,
      usedSeconds: clampSessionDurationSeconds({
        startedAtMs: session.startedAtMs,
        endedAtMs: boundedEndedAtMs,
        maxDurationSeconds: session.maxDurationSeconds,
      }),
      billing: {
        planKey: billing.planKey,
        planLabel: billing.planLabel,
        planSlug: billing.planSlug ?? null,
        status: billing.status as PresentBillingStatus,
        isPaid: billing.planKey !== "free",
        quotaSeconds: billing.quotaSeconds,
        usedSeconds,
        remainingSeconds: Math.max(0, billing.quotaSeconds - usedSeconds),
        periodStartMs: billing.periodStartMs,
        periodEndMs: billing.periodEndMs,
      },
    };
  },
});
