import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("categories")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
  },
});

export const ensureDefaults = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("categories")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();

    if (existing) return;

    const now = Date.now();
    const defaults = ["Songs", "Flows", "Hymns"];

    for (let i = 0; i < defaults.length; i++) {
      await ctx.db.insert("categories", {
        orgId: args.orgId,
        name: defaults[i],
        isDefault: true,
        order: i,
        createdAt: now,
      });
    }
  },
});

export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("categories")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    const now = Date.now();
    return await ctx.db.insert("categories", {
      orgId: args.orgId,
      name: args.name,
      isDefault: false,
      order: existing.length,
      createdAt: now,
    });
  },
});

export const update = mutation({
  args: {
    categoryId: v.id("categories"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.categoryId, { name: args.name });
    return args.categoryId;
  },
});

export const remove = mutation({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    // Move songs in this category to uncategorized
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .collect();

    for (const song of songs) {
      await ctx.db.patch(song._id, { categoryId: undefined });
    }

    await ctx.db.delete(args.categoryId);
  },
});
