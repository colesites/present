import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("personalCategories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const ensureDefaults = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("personalCategories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const now = Date.now();
    const defaults = ["Songs", "Flows", "Hymns", "Notes"];
    const existingByName = new Set(existing.map((category) => category.name.toLowerCase()));
    let nextOrder =
      existing.length > 0
        ? Math.max(...existing.map((category) => category.order ?? 0)) + 1
        : 0;

    for (const defaultName of defaults) {
      if (existingByName.has(defaultName.toLowerCase())) {
        continue;
      }
      await ctx.db.insert("personalCategories", {
        userId: args.userId,
        name: defaultName,
        isDefault: true,
        order: nextOrder,
        createdAt: now,
      });
      nextOrder += 1;
    }
  },
});

export const create = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("personalCategories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const now = Date.now();
    return await ctx.db.insert("personalCategories", {
      userId: args.userId,
      name: args.name,
      isDefault: false,
      order: existing.length,
      createdAt: now,
    });
  },
});

export const update = mutation({
  args: {
    categoryId: v.id("personalCategories"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.categoryId, { name: args.name });
    return args.categoryId;
  },
});

export const remove = mutation({
  args: { categoryId: v.id("personalCategories") },
  handler: async (ctx, args) => {
    // Move songs in this category to uncategorized
    const songs = await ctx.db
      .query("personalSongs")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .collect();

    for (const song of songs) {
      await ctx.db.patch(song._id, { categoryId: undefined });
    }

    await ctx.db.delete(args.categoryId);
  },
});

