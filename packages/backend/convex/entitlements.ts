/**
 * What a person is entitled to, worked out in one place.
 *
 * Billing, the signed-in user, AI lyrics fixes, speech sessions and workspace
 * members all ask the same question, and each used to answer it a little
 * differently: the allowlist only raised the AI projection limit, a cancelled
 * subscription kept its paid plan, the limit a plan gave was the one saved
 * when the subscription last synced rather than the plan's own, and someone
 * with no subscription had their usage counted over a period that never
 * matched their sessions. Everything now reads it from here.
 *
 * The plans themselves are `packages/shared/src/billing.ts`.
 */

import type { QueryCtx } from "./_generated/server";
import {
  betterPlan,
  effectivePlanKey,
  getPresentPlanDefinition,
  resolvePresentPlanKey,
  UNLIMITED_SPEECH_QUOTA_SECONDS,
  type PresentPlanDefinition,
  type PresentPlanKey,
} from "../../shared/src/billing";

type Reader = Pick<QueryCtx, "db">;

export const normalizeEmail = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;

export const identityEmail = (identity: unknown): string | null => {
  const record = identity as
    | { email?: unknown; emailAddress?: unknown; email_address?: unknown }
    | null
    | undefined;
  return (
    normalizeEmail(record?.email) ??
    normalizeEmail(record?.emailAddress) ??
    normalizeEmail(record?.email_address)
  );
};

/** The calendar month, for anyone whose usage no subscription period bounds. */
export const calendarMonth = (now = Date.now()) => {
  const date = new Date(now);
  return {
    periodStartMs: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
    periodEndMs: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  };
};

export const periodKeyOf = (period: { periodStartMs: number; periodEndMs: number }) =>
  `${period.periodStartMs}:${period.periodEndMs}`;

export type Entitlements = {
  planKey: PresentPlanKey;
  planLabel: string;
  planSlug: string;
  status: string;
  isPaid: boolean;
  /** On the allowlist: Power, with its own AI projection allowance. */
  allowlisted: boolean;
  plan: PresentPlanDefinition;
  quotaSeconds: number;
  periodStartMs: number;
  periodEndMs: number;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
};

const allowlistEntryFor = async (ctx: Reader, email: string | null) => {
  if (!email) return null;
  return await ctx.db
    .query("speechQuotaAllowlist")
    .withIndex("by_normalized_email", (q) => q.eq("normalizedEmail", email))
    .first();
};

/** What `userId` gets now. `email` is theirs, for the allowlist. */
export const entitlementsFor = async (
  ctx: Reader,
  userId: string,
  email: string | null,
  now = Date.now(),
): Promise<Entitlements> => {
  const [record, allowlistEntry] = await Promise.all([
    ctx.db
      .query("userBilling")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first(),
    allowlistEntryFor(ctx, email),
  ]);

  // A subscription's own period while it runs; the calendar month otherwise,
  // including once a cancelled subscription's last period has ended.
  const period =
    record && record.periodStartMs > 0 && record.periodEndMs > now
      ? { periodStartMs: record.periodStartMs, periodEndMs: record.periodEndMs }
      : calendarMonth(now);

  const subscribed = record
    ? effectivePlanKey(resolvePresentPlanKey(record.planKey), record.status)
    : "free";
  const allowlisted = Boolean(allowlistEntry) || record?.allowlisted === true;
  const planKey = allowlisted ? betterPlan(subscribed, "power") : subscribed;
  const plan = getPresentPlanDefinition(planKey);

  return {
    planKey,
    planLabel: plan.label,
    planSlug: plan.key,
    status: record?.status ?? "active",
    isPaid: plan.isPaid,
    allowlisted,
    plan,
    quotaSeconds: allowlisted
      ? Math.max(allowlistEntry?.quotaSeconds ?? 0, UNLIMITED_SPEECH_QUOTA_SECONDS)
      : plan.monthlySpeechLimitSeconds,
    periodStartMs: period.periodStartMs,
    periodEndMs: period.periodEndMs,
    stripeSubscriptionId: record?.stripeSubscriptionId,
    stripeCustomerId: record?.stripeCustomerId,
  };
};

/** Listening time used in this period, each session capped at its limit. */
export const speechSecondsUsed = async (
  ctx: Reader,
  userId: string,
  period: { periodStartMs: number; periodEndMs: number },
  now = Date.now(),
): Promise<number> => {
  const sessions = await ctx.db
    .query("speechUsageSessions")
    .withIndex("by_user_period", (q) =>
      q.eq("userId", userId).eq("periodKey", periodKeyOf(period)),
    )
    .collect();
  return sessions.reduce((total, session) => {
    const endMs = typeof session.endedAtMs === "number" ? session.endedAtMs : now;
    const elapsed = Math.max(0, Math.ceil((endMs - session.startedAtMs) / 1000));
    return total + Math.min(session.maxDurationSeconds, elapsed);
  }, 0);
};

/** AI lyrics fixes used in this period. */
export const lyricsFixesUsed = async (
  ctx: Reader,
  userId: string,
  period: { periodStartMs: number; periodEndMs: number },
): Promise<number> => {
  const usage = await ctx.db
    .query("aiLyricsFixUsage")
    .withIndex("by_user_period", (q) =>
      q.eq("userId", userId).eq("periodKey", periodKeyOf(period)),
    )
    .first();
  return usage?.count ?? 0;
};

/**
 * What the app shows about a plan: the limits, and how much is used. The one
 * shape every billing answer takes, so the desktop and the website read the
 * same fields.
 */
export const billingSummary = async (
  ctx: Reader,
  userId: string,
  entitlements: Entitlements,
) => {
  const [usedSeconds, usedLyricsFixes] = await Promise.all([
    speechSecondsUsed(ctx, userId, entitlements),
    lyricsFixesUsed(ctx, userId, entitlements),
  ]);
  const { plan } = entitlements;
  return {
    planKey: entitlements.planKey,
    planLabel: entitlements.planLabel,
    planSlug: entitlements.planSlug,
    status: entitlements.status,
    isPaid: entitlements.isPaid,
    quotaSeconds: entitlements.quotaSeconds,
    usedSeconds,
    remainingSeconds: Math.max(0, entitlements.quotaSeconds - usedSeconds),
    periodStartMs: entitlements.periodStartMs,
    periodEndMs: entitlements.periodEndMs,
    limits: {
      songAiProjection: plan.songAiProjection,
      monthlyLyricsFixes: plan.monthlyLyricsFixes,
      workspaceMembers: plan.workspaceMembers,
      cloudStorageBytes: plan.cloudStorageBytes,
      themes: plan.themes,
    },
    usedLyricsFixes,
  };
};

/**
 * The most people `orgId` may hold: what the best plan among its admins
 * allows, since whichever admin pays is the one who raised it. The caller is
 * counted too if they are an admin, with their allowlist checked by email.
 */
export const workspaceMemberLimit = async (
  ctx: Reader,
  orgId: string,
  caller: { userId: string; email: string | null },
): Promise<{ limit: number; planLabel: string }> => {
  const profiles = await ctx.db
    .query("userProfiles")
    .withIndex("by_org", (q) => q.eq("orgId", orgId as never))
    .collect();
  let best: PresentPlanKey = "free";
  for (const profile of profiles.filter((each) => each.role === "admin")) {
    const email = profile.userId === caller.userId ? caller.email : null;
    const entitlements = await entitlementsFor(ctx, profile.userId, email);
    best = betterPlan(best, entitlements.planKey);
  }
  const plan = getPresentPlanDefinition(best);
  return { limit: plan.workspaceMembers, planLabel: plan.label };
};

/**
 * How full a workspace is: its members, the invitations still open, and how
 * many its plan allows. Open invitations count, so an admin cannot invite
 * past the limit and leave the last people to find it full.
 */
export const workspaceSeats = async (
  ctx: Reader,
  orgId: string,
  caller: { userId: string; email: string | null },
  now = Date.now(),
) => {
  const [{ limit, planLabel }, members, invites] = await Promise.all([
    workspaceMemberLimit(ctx, orgId, caller),
    ctx.db
      .query("userProfiles")
      .withIndex("by_org", (q) => q.eq("orgId", orgId as never))
      .collect(),
    ctx.db
      .query("workspaceInvites")
      .withIndex("by_org", (q) => q.eq("orgId", orgId as never))
      .collect(),
  ]);
  const pending = invites.filter((invite) => invite.status === "pending" && invite.expiresAt > now);
  return { limit, planLabel, members: members.length, pendingInvites: pending.length };
};
