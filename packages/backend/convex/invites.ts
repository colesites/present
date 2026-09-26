declare const process: {
  env: Record<string, string | undefined>;
};

/**
 * Joining a workspace: by invitation, and accepted by the person invited.
 *
 * It used to be two shortcuts. An admin typing someone's email added them on
 * the spot, without asking; and anybody who knew a workspace's id could join
 * it themselves, with no one's say-so, and read its library. Both are gone.
 * An admin invites an email address; the invitation arrives by email when the
 * deployment can send one (`RESEND_API_KEY`), and is always waiting in the
 * website and the desktop app for whoever signs in with that address; only
 * they can accept it, and only while the workspace has room on its plan.
 */

import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { identityEmail, normalizeEmail, workspaceSeats } from "./entitlements";
import { normalizeWorkspaceRole } from "../../shared/src/workspace-roles";

/** How long an invitation can be accepted for. */
const INVITE_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/** Where invitation links point when the deployment does not say. */
const DEFAULT_SITE_URL = "https://present.multivrs.space";

const siteUrl = () => (process.env.PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_URL).replace(/\/+$/, "");

export const inviteUrl = (token: string) => `${siteUrl()}/invite/${token}`;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 32 random bytes, URL-safe: the secret an invitation link carries. */
const newToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** "j•••@example.com", for showing an address to someone it may not be. */
const maskEmail = (email: string) => {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(3, name.length - 1)))}@${domain}`;
};

const isOpen = (invite: Doc<"workspaceInvites">, now = Date.now()) =>
  invite.status === "pending" && invite.expiresAt > now;

const requireIdentity = async (ctx: QueryCtx | MutationCtx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in first.");
  return { userId: identity.subject, email: identityEmail(identity), name: identity.name ?? null };
};

const requireAdmin = async (ctx: QueryCtx | MutationCtx, orgId: Id<"organizations">, userId: string) => {
  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_user_org", (q) => q.eq("userId", userId).eq("orgId", orgId))
    .first();
  if (!profile || profile.role !== "admin") {
    throw new ConvexError("Only a workspace admin can do that.");
  }
};

/** Invite `email` to `orgId`. Inviting the same address again re-sends it. */
export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    email: v.string(),
    role: v.optional(v.string()),
    userRole: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireIdentity(ctx);
    await requireAdmin(ctx, args.orgId, me.userId);

    const email = normalizeEmail(args.email);
    if (!email || !EMAIL_SHAPE.test(email)) {
      throw new ConvexError("Enter a valid email address.");
    }
    if (email === me.email) {
      throw new ConvexError("You're already in this workspace.");
    }
    const role = args.role === "admin" ? "admin" : "user";
    const userRole = normalizeWorkspaceRole(args.userRole);
    const now = Date.now();

    const existing = (
      await ctx.db
        .query("workspaceInvites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect()
    ).find((invite) => invite.orgId === args.orgId && isOpen(invite, now));

    if (existing) {
      await ctx.db.patch(existing._id, {
        role,
        userRole,
        expiresAt: now + INVITE_LIFETIME_MS,
        emailError: undefined,
      });
      await ctx.scheduler.runAfter(0, internal.invites.sendEmail, { inviteId: existing._id });
      return { inviteId: existing._id, token: existing.token, url: inviteUrl(existing.token), resent: true };
    }

    const seats = await workspaceSeats(ctx, args.orgId, me, now);
    if (seats.members + seats.pendingInvites >= seats.limit) {
      throw new ConvexError(
        seats.pendingInvites > 0
          ? `This workspace can have ${seats.limit} people on ${seats.planLabel}, counting the ${seats.pendingInvites} invitation${seats.pendingInvites === 1 ? "" : "s"} still open. Revoke one or upgrade to invite more.`
          : `This workspace already has its ${seats.limit} people on ${seats.planLabel}. Upgrade to invite more.`,
      );
    }

    const token = newToken();
    const inviteId = await ctx.db.insert("workspaceInvites", {
      orgId: args.orgId,
      email,
      role,
      userRole,
      token,
      invitedBy: me.userId,
      invitedByName: me.name ?? undefined,
      status: "pending",
      createdAt: now,
      expiresAt: now + INVITE_LIFETIME_MS,
    });
    await ctx.scheduler.runAfter(0, internal.invites.sendEmail, { inviteId });
    return { inviteId, token, url: inviteUrl(token), resent: false };
  },
});

/**
 * The invitations still open for a workspace, for its admins. `null` for
 * anyone else, rather than an error: a query that throws takes the whole
 * page down with it.
 */
export const listForWorkspace = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const me = { userId: identity.subject, email: identityEmail(identity) };
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user_org", (q) => q.eq("userId", me.userId).eq("orgId", args.orgId))
      .first();
    if (!profile || profile.role !== "admin") return null;
    const now = Date.now();
    const invites = await ctx.db
      .query("workspaceInvites")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const seats = await workspaceSeats(ctx, args.orgId, me, now);
    return {
      seats,
      invites: invites
        .filter((invite) => isOpen(invite, now))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((invite) => ({
          id: invite._id,
          email: invite.email,
          role: invite.role,
          userRole: invite.userRole ?? null,
          invitedByName: invite.invitedByName ?? null,
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
          url: inviteUrl(invite.token),
          emailSent: typeof invite.emailSentAt === "number",
          emailError: invite.emailError ?? null,
        })),
    };
  },
});

export const revoke = mutation({
  args: { inviteId: v.id("workspaceInvites") },
  handler: async (ctx, args) => {
    const me = await requireIdentity(ctx);
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) return;
    await requireAdmin(ctx, invite.orgId, me.userId);
    if (invite.status === "pending") {
      await ctx.db.patch(invite._id, { status: "revoked", respondedAt: Date.now() });
    }
  },
});

/** What someone signed in is invited to, wherever they are signed in. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const email = identity ? identityEmail(identity) : null;
    if (!email) return [];
    const now = Date.now();
    const invites = (
      await ctx.db
        .query("workspaceInvites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect()
    ).filter((invite) => isOpen(invite, now));
    const listed = await Promise.all(
      invites.map(async (invite) => {
        const organization = await ctx.db.get(invite.orgId);
        if (!organization) return null;
        return {
          id: invite._id,
          token: invite.token,
          orgId: invite.orgId,
          orgName: organization.name,
          orgLogo: organization.logo ?? null,
          invitedByName: invite.invitedByName ?? null,
          role: invite.role,
          userRole: invite.userRole ?? null,
          createdAt: invite.createdAt,
        };
      }),
    );
    return listed.filter((invite) => invite !== null);
  },
});

/**
 * What an invitation link is, for the page it opens, which may be seen before
 * anyone has signed in. The token is the secret; the address is only hinted.
 */
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("workspaceInvites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!invite) return null;
    const organization = await ctx.db.get(invite.orgId);
    const identity = await ctx.auth.getUserIdentity();
    const signedInEmail = identity ? identityEmail(identity) : null;
    return {
      orgName: organization?.name ?? "A workspace",
      orgLogo: organization?.logo ?? null,
      invitedByName: invite.invitedByName ?? null,
      role: invite.role,
      userRole: invite.userRole ?? null,
      emailHint: maskEmail(invite.email),
      state:
        invite.status !== "pending"
          ? invite.status
          : invite.expiresAt <= Date.now()
            ? "expired"
            : "pending",
      isForSignedInUser: signedInEmail === invite.email,
    };
  },
});

const invitationFor = async (ctx: MutationCtx, token: string, email: string | null) => {
  const invite = await ctx.db
    .query("workspaceInvites")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  if (!invite) throw new ConvexError("This invitation doesn't exist.");
  if (invite.status === "revoked") throw new ConvexError("This invitation was withdrawn.");
  if (invite.status === "declined") throw new ConvexError("This invitation was declined.");
  if (invite.status === "pending" && invite.expiresAt <= Date.now()) {
    throw new ConvexError("This invitation has expired. Ask for a new one.");
  }
  if (email !== invite.email) {
    throw new ConvexError(
      `This invitation is for ${maskEmail(invite.email)}. Sign in with that email to accept it.`,
    );
  }
  return invite;
};

/** Join the workspace an invitation is for, as the person it was sent to. */
export const accept = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const me = await requireIdentity(ctx);
    const invite = await invitationFor(ctx, args.token, me.email);
    const organization = await ctx.db.get(invite.orgId);
    if (!organization) throw new ConvexError("That workspace no longer exists.");

    const already = await ctx.db
      .query("userProfiles")
      .withIndex("by_user_org", (q) => q.eq("userId", me.userId).eq("orgId", invite.orgId))
      .first();
    if (!already) {
      // This invitation's own place was counted when it was sent; checked
      // again in case the plan changed since.
      const seats = await workspaceSeats(ctx, invite.orgId, me);
      const othersOpen = Math.max(0, seats.pendingInvites - (invite.status === "pending" ? 1 : 0));
      if (seats.members + othersOpen >= seats.limit) {
        throw new ConvexError(
          `${organization.name} is full on its plan (${seats.limit} people). Ask an admin to make room.`,
        );
      }
      await ctx.db.insert("userProfiles", {
        userId: me.userId,
        orgId: invite.orgId,
        role: invite.role,
        userRole: invite.userRole,
        createdAt: Date.now(),
      });
    }
    if (invite.status === "pending") {
      await ctx.db.patch(invite._id, { status: "accepted", respondedAt: Date.now() });
    }

    // The workspace they just joined is the one they will want to see, on
    // every device (`users.setCurrentWorkspace`).
    const preference = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", me.userId))
      .first();
    const workspace = { workspaceType: "organization" as const, workspaceOrgId: invite.orgId, updatedAt: Date.now() };
    if (preference) await ctx.db.patch(preference._id, workspace);
    else await ctx.db.insert("userPreferences", { userId: me.userId, ...workspace });

    return { orgId: invite.orgId, orgName: organization.name };
  },
});

export const decline = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const me = await requireIdentity(ctx);
    const invite = await invitationFor(ctx, args.token, me.email);
    if (invite.status === "pending") {
      await ctx.db.patch(invite._id, { status: "declined", respondedAt: Date.now() });
    }
  },
});

// --- The email --------------------------------------------------------------

export const forEmail = internalQuery({
  args: { inviteId: v.id("workspaceInvites") },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (!invite || !isOpen(invite)) return null;
    const organization = await ctx.db.get(invite.orgId);
    return { invite, orgName: organization?.name ?? "a workspace" };
  },
});

export const recordEmail = internalMutation({
  args: { inviteId: v.id("workspaceInvites"), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.inviteId, args.error
      ? { emailError: args.error }
      : { emailSentAt: Date.now(), emailError: undefined });
  },
});

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Send the invitation by email, through Resend's HTTP API.
 *
 * Nothing to install and nothing to send without `RESEND_API_KEY`: the
 * invitation still waits for them in the app and on the website, and the
 * admin can copy its link. `INVITE_EMAIL_FROM` is the sender, on a domain
 * verified with Resend.
 */
export const sendEmail = internalAction({
  args: { inviteId: v.id("workspaceInvites") },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.invites.forEmail, args);
    if (!found) return;
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      await ctx.runMutation(internal.invites.recordEmail, {
        inviteId: args.inviteId,
        error: "Email isn't set up yet. Copy the link and send it yourself.",
      });
      return;
    }

    const { invite, orgName } = found;
    const who = invite.invitedByName ?? "Someone";
    const url = inviteUrl(invite.token);
    const subject = `${who} invited you to ${orgName} on Present`;
    const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:36px">
<tr><td style="font-size:14px;font-weight:600;color:#5227ff;letter-spacing:.02em">Present</td></tr>
<tr><td style="padding-top:20px;font-size:22px;font-weight:600;line-height:1.3">You're invited to ${escapeHtml(orgName)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#52525b">${escapeHtml(who)} invited you to join ${escapeHtml(orgName)} on Present, to share its songs, services and themes.</td></tr>
<tr><td style="padding-top:28px"><a href="${url}" style="display:inline-block;background:#5227ff;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 22px;border-radius:10px">Accept invitation</a></td></tr>
<tr><td style="padding-top:24px;font-size:13px;line-height:1.6;color:#71717a">Or open this link: <a href="${url}" style="color:#5227ff">${url}</a><br>It works for 14 days, for ${escapeHtml(invite.email)}. If you weren't expecting it, you can ignore this email.</td></tr>
</table></td></tr></table></body></html>`;

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.INVITE_EMAIL_FROM?.trim() || "Present <invites@present.multivrs.space>",
          to: [invite.email],
          subject,
          html,
          text: `${who} invited you to join ${orgName} on Present.\n\nAccept: ${url}\n\nThe link works for 14 days.`,
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Resend answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      }
      await ctx.runMutation(internal.invites.recordEmail, { inviteId: args.inviteId });
    } catch (error) {
      await ctx.runMutation(internal.invites.recordEmail, {
        inviteId: args.inviteId,
        error: "The email couldn't be sent. Copy the link and send it yourself.",
      });
      console.error("[Invites] email failed", error);
    }
  },
});
