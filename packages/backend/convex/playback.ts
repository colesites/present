import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("playbackState")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();
  },
});

export const setActiveSlide = mutation({
  args: {
    orgId: v.id("organizations"),
    activeSlideId: v.optional(v.string()),
    activeBackgroundId: v.optional(v.string()),
    isBlackedOut: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("playbackState")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        activeSlideId: args.activeSlideId ?? existing.activeSlideId,
        activeBackgroundId:
          args.activeBackgroundId ?? existing.activeBackgroundId,
        isBlackedOut: args.isBlackedOut ?? existing.isBlackedOut,
        updatedAt: now,
      });
      return existing._id;
    }

    const playbackId = await ctx.db.insert("playbackState", {
      orgId: args.orgId,
      isBlackedOut: args.isBlackedOut ?? false,
      updatedAt: now,
      ...(args.activeSlideId !== undefined
        ? { activeSlideId: args.activeSlideId }
        : {}),
      ...(args.activeBackgroundId !== undefined
        ? { activeBackgroundId: args.activeBackgroundId }
        : {}),
    });
    return playbackId;
  },
});

export const setFontStyle = mutation({
  args: {
    orgId: v.id("organizations"),
    fontFamily: v.optional(v.string()),
    fontSize: v.optional(v.number()),
    fontBold: v.optional(v.boolean()),
    fontItalic: v.optional(v.boolean()),
    fontUnderline: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("playbackState")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();

    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (args.fontFamily !== undefined) updates.fontFamily = args.fontFamily;
    if (args.fontSize !== undefined) updates.fontSize = args.fontSize;
    if (args.fontBold !== undefined) updates.fontBold = args.fontBold;
    if (args.fontItalic !== undefined) updates.fontItalic = args.fontItalic;
    if (args.fontUnderline !== undefined)
      updates.fontUnderline = args.fontUnderline;

    if (existing) {
      await ctx.db.patch(existing._id, updates);
      return existing._id;
    }

    const playbackId = await ctx.db.insert("playbackState", {
      orgId: args.orgId,
      isBlackedOut: false,
      ...updates,
      updatedAt: now,
    });
    return playbackId;
  },
});
