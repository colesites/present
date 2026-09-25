declare const process: {
  env: Record<string, string | undefined>;
};

/**
 * "How can we help?": a message from anyone on the site to the Present team.
 *
 * Every message is stored (`supportRequests`) so none depends on email
 * working, and sent to SUPPORT_INBOX through Resend when both it and
 * RESEND_API_KEY are set, with the sender as the reply-to address. Anyone can
 * send one, so it is capped per address and a filled-in trap field is
 * thanked and dropped.
 */

import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { identityEmail, normalizeEmail } from "./entitlements";

const TOPICS = ["question", "problem", "billing", "idea"] as const;
const MAX_MESSAGE = 5000;
const PER_HOUR = 5;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const send = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    topic: v.string(),
    message: v.string(),
    page: v.optional(v.string()),
    /** Hidden from people; only a bot fills it in. */
    website: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.website?.trim()) return { ok: true };

    const identity = await ctx.auth.getUserIdentity();
    const email = normalizeEmail(args.email) ?? (identity ? identityEmail(identity) : null);
    if (!email || !EMAIL_SHAPE.test(email)) throw new ConvexError("Enter an email address we can reply to.");
    const message = args.message.trim();
    if (message.length < 5) throw new ConvexError("Tell us a little more.");
    if (message.length > MAX_MESSAGE) throw new ConvexError(`Keep it under ${MAX_MESSAGE} characters.`);
    const topic = (TOPICS as readonly string[]).includes(args.topic) ? args.topic : "question";

    const since = Date.now() - 60 * 60 * 1000;
    const recent = await ctx.db
      .query("supportRequests")
      .withIndex("by_email_created", (q) => q.eq("email", email).gte("createdAt", since))
      .collect();
    if (recent.length >= PER_HOUR) {
      throw new ConvexError("We have your messages. We'll reply by email soon.");
    }

    const requestId = await ctx.db.insert("supportRequests", {
      email,
      name: args.name?.trim().slice(0, 120) || identity?.name || undefined,
      topic,
      message,
      page: args.page?.slice(0, 300),
      userId: identity?.subject,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.support.deliver, { requestId });
    return { ok: true };
  },
});

export const forDelivery = internalQuery({
  args: { requestId: v.id("supportRequests") },
  handler: async (ctx, args) => ctx.db.get(args.requestId),
});

export const recordDelivery = internalMutation({
  args: { requestId: v.id("supportRequests"), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.requestId, args.error ? { emailError: args.error } : { emailSentAt: Date.now(), emailError: undefined });
  },
});

export const deliver = internalAction({
  args: { requestId: v.id("supportRequests") },
  handler: async (ctx, args) => {
    const request = await ctx.runQuery(internal.support.forDelivery, args);
    if (!request) return;
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const inbox = process.env.SUPPORT_INBOX?.trim();
    if (!apiKey || !inbox) {
      await ctx.runMutation(internal.support.recordDelivery, { requestId: args.requestId, error: "SUPPORT_INBOX or RESEND_API_KEY is not set" });
      return;
    }
    const from = process.env.SUPPORT_EMAIL_FROM?.trim() || process.env.INVITE_EMAIL_FROM?.trim() || "Present <invites@present.multivrs.space>";
    const topic = request.topic.charAt(0).toUpperCase() + request.topic.slice(1);
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [inbox],
          reply_to: request.email,
          subject: `[${topic}] ${request.message.split("\n")[0].slice(0, 70)}`,
          text: [
            `From: ${request.name ? `${request.name} <${request.email}>` : request.email}`,
            request.userId ? `Account: ${request.userId}` : "Not signed in",
            request.page ? `Page: ${request.page}` : null,
            "",
            request.message,
          ]
            .filter((line) => line !== null)
            .join("\n"),
        }),
      });
      if (!response.ok) throw new Error(`Resend answered ${response.status}`);
      await ctx.runMutation(internal.support.recordDelivery, { requestId: args.requestId });
    } catch (error) {
      console.error("[Support] email failed", error);
      await ctx.runMutation(internal.support.recordDelivery, { requestId: args.requestId, error: "The email couldn't be sent" });
    }
  },
});
