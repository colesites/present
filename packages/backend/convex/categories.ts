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
      await ctx.db.insert("categories", {
        orgId: args.orgId,
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
    // Move items in this category to uncategorized
    const items = await ctx.db
      .query("libraries")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .collect();

    for (const item of items) {
      await ctx.db.patch(item._id, { categoryId: undefined });
    }

    await ctx.db.delete(args.categoryId);
  },
});
