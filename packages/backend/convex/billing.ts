declare const process: {
  env: Record<string, string | undefined>;
};

import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import {
  getPresentPlanDefinition,
  resolvePresentPlanKey,
  UNLIMITED_SPEECH_QUOTA_SECONDS,
} from "../../shared/src/billing";
import {
  billingSummary,
  entitlementsFor,
  identityEmail,
  lyricsFixesUsed,
  normalizeEmail,
  periodKeyOf,
  speechSecondsUsed,
} from "./entitlements";

const DEFAULT_SPEECH_SESSION_MAX_SECONDS = 15 * 60;
const DEFAULT_ALLOWLISTED_SPEECH_QUOTA_SECONDS = UNLIMITED_SPEECH_QUOTA_SECONDS;

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

export const getMyBillingStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const entitlements = await entitlementsFor(
      ctx,
      identity.subject,
      identityEmail(identity),
    );
    return await billingSummary(ctx, identity.subject, entitlements);
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

/**
 * What Stripe says the plan is. The record keeps the subscription's plan and
 * state as Stripe reported them; what that entitles someone to — cancelled
 * means Free, the allowlist means Power — is decided when it is read
 * (`entitlements.ts`), so a change of plan limits reaches every account at
 * once instead of at each account's next sync.
 */
export const syncUserBillingFromServer = mutation({
  args: {
    userId: v.string(),
    secret: v.optional(v.string()),
    email: v.optional(v.string()),
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
    if (args.email !== undefined) {
      assertBillingSyncSecret(args.secret);
    }
    return await writeBilling(ctx, args);
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
    return await writeBilling(ctx, args);
  },
});

const writeBilling = async (
  ctx: MutationCtx,
  args: {
    userId: string;
    planSlug?: string;
    planLabel?: string;
    status: string;
    periodStartMs: number;
    periodEndMs: number;
    stripeSubscriptionId?: string;
    stripeCustomerId?: string;
  },
) => {
  const planKey = resolvePresentPlanKey(args.planSlug ?? args.planLabel);
  const plan = getPresentPlanDefinition(planKey);
  const existing = await ctx.db
    .query("userBilling")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .first();

  const patch = {
    userId: args.userId,
    planKey,
    planLabel: plan.label,
    planSlug: plan.key,
    status: args.status,
    // Kept for older readers; the limit that applies is the plan's own.
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
};

export const startSpeechUsageSession = mutation({
  args: {
    // "song" is the library's voice search. "library" is what the AI
    // operator and older desktops send.
    source: v.union(v.literal("bible"), v.literal("library"), v.literal("song")),
    requestedMaxDurationSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    const userId = identity.subject;
    const entitlements = await entitlementsFor(ctx, userId, identityEmail(identity));
    if (args.source === "song" && !entitlements.plan.songAiProjection) {
      throw new ConvexError(
        "Finding songs by voice is part of Pro and Power. On Free, AI projection finds Bible verses.",
      );
    }

    const usedSeconds = await speechSecondsUsed(ctx, userId, entitlements);
    const remainingSeconds = Math.max(0, entitlements.quotaSeconds - usedSeconds);
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
      periodKey: periodKeyOf(entitlements),
      startedAtMs: now,
      maxDurationSeconds: allowedDurationSeconds,
      createdAt: now,
      updatedAt: now,
    });

    return {
      sessionId,
      allowedDurationSeconds,
      billing: await billingSummary(ctx, userId, entitlements),
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

    const entitlements = await entitlementsFor(
      ctx,
      identity.subject,
      identityEmail(identity),
    );

    return {
      sessionId: args.sessionId,
      usedSeconds: clampSessionDurationSeconds({
        startedAtMs: session.startedAtMs,
        endedAtMs: boundedEndedAtMs,
        maxDurationSeconds: session.maxDurationSeconds,
      }),
      billing: await billingSummary(ctx, identity.subject, entitlements),
    };
  },
});

/**
 * Take one AI lyrics fix from this period's allowance, or refuse.
 *
 * Taken before the model runs, so two fixes started at once cannot both slip
 * under the limit; `returnLyricsFix` gives it back if the model then fails.
 */
export const takeLyricsFix = internalMutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Sign in to fix lyrics with AI.");
    }
    const userId = identity.subject;
    const entitlements = await entitlementsFor(ctx, userId, identityEmail(identity));
    const allowance = entitlements.plan.monthlyLyricsFixes;
    const used = await lyricsFixesUsed(ctx, userId, entitlements);
    if (allowance !== null && used >= allowance) {
      throw new ConvexError(
        `You've used your ${allowance} AI lyrics fixes for this month on ${entitlements.planLabel}. Upgrade for more.`,
      );
    }

    const periodKey = periodKeyOf(entitlements);
    const existing = await ctx.db
      .query("aiLyricsFixUsage")
      .withIndex("by_user_period", (q) => q.eq("userId", userId).eq("periodKey", periodKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { count: existing.count + 1, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("aiLyricsFixUsage", { userId, periodKey, count: 1, updatedAt: Date.now() });
    }
    return { periodKey };
  },
});

/** Give back a fix the model did not deliver. */
export const returnLyricsFix = internalMutation({
  args: { periodKey: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return;
    const existing = await ctx.db
      .query("aiLyricsFixUsage")
      .withIndex("by_user_period", (q) =>
        q.eq("userId", identity.subject).eq("periodKey", args.periodKey),
      )
      .first();
    if (existing && existing.count > 0) {
      await ctx.db.patch(existing._id, { count: existing.count - 1, updatedAt: Date.now() });
    }
  },
});
