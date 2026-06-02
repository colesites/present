import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

const positionValidator = v.union(v.literal("top"), v.literal("bottom"));
const dismissValidator = v.union(
  v.literal("manual"),
  v.literal("after-10s"),
  v.literal("after-30s"),
);
const animationValidator = v.union(
  v.literal("static"),
  v.literal("marquee-left"),
  v.literal("marquee-right"),
);

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_org_order", (q) => q.eq("orgId", args.orgId))
      .collect();
  },
});

export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    title: v.string(),
    body: v.optional(v.string()),
    themeKey: v.optional(v.string()),
    position: v.optional(positionValidator),
    dismissMode: v.optional(dismissValidator),
    allowWebNotifications: v.optional(v.boolean()),
    animation: v.optional(animationValidator),
    speedSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const now = Date.now();
    // Append to the end of the user's list by default.
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_org_order", (q) => q.eq("orgId", args.orgId))
      .collect();
    const nextOrder =
      existing.reduce((max, m) => (m.order > max ? m.order : max), -1) + 1;

    return await ctx.db.insert("messages", {
      orgId: args.orgId,
      title: args.title.trim() || "New Message",
      body: args.body ?? "",
      themeKey: args.themeKey ?? "default",
      position: args.position ?? "bottom",
      dismissMode: args.dismissMode ?? "manual",
      allowWebNotifications: args.allowWebNotifications ?? false,
      animation: args.animation ?? "static",
      speedSeconds: args.speedSeconds ?? 12,
      order: nextOrder,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    messageId: v.id("messages"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    themeKey: v.optional(v.string()),
    position: v.optional(positionValidator),
    dismissMode: v.optional(dismissValidator),
    allowWebNotifications: v.optional(v.boolean()),
    animation: v.optional(animationValidator),
    speedSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const existing = await ctx.db.get(args.messageId);
    if (!existing) throw new ConvexError("Message not found");

    const patch: Partial<typeof existing> = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = args.title;
    if (args.body !== undefined) patch.body = args.body;
    if (args.themeKey !== undefined) patch.themeKey = args.themeKey;
    if (args.position !== undefined) patch.position = args.position;
    if (args.dismissMode !== undefined) patch.dismissMode = args.dismissMode;
    if (args.allowWebNotifications !== undefined) {
      patch.allowWebNotifications = args.allowWebNotifications;
    }
    if (args.animation !== undefined) patch.animation = args.animation;
    if (args.speedSeconds !== undefined) patch.speedSeconds = args.speedSeconds;

    await ctx.db.patch(args.messageId, patch);
    return args.messageId;
  },
});

export const remove = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    await ctx.db.delete(args.messageId);
    return args.messageId;
  },
});
