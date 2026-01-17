import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
  },
});

export const get = query({
  args: { serviceId: v.id("services") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.serviceId);
  },
});

export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("services", {
      orgId: args.orgId,
      name: args.name,
      date: args.date,
      items: [],
      createdAt: now,
    });
  },
});

export const addItem = mutation({
  args: {
    serviceId: v.id("services"),
    type: v.union(
      v.literal("song"),
      v.literal("media"),
      v.literal("scripture"),
    ),
    refId: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const service = await ctx.db.get(args.serviceId);
    if (!service) {
      throw new Error("Service not found");
    }
    const newItem = {
      type: args.type,
      refId: args.refId,
      label: args.label,
      addedAt: Date.now(),
    };
    await ctx.db.patch(args.serviceId, {
      items: [...service.items, newItem],
    });
    return args.serviceId;
  },
});

export const removeItem = mutation({
  args: {
    serviceId: v.id("services"),
    itemIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const service = await ctx.db.get(args.serviceId);
    if (!service) {
      throw new Error("Service not found");
    }
    const items = [...service.items];
    items.splice(args.itemIndex, 1);
    await ctx.db.patch(args.serviceId, { items });
    return args.serviceId;
  },
});

export const reorderItems = mutation({
  args: {
    serviceId: v.id("services"),
    fromIndex: v.number(),
    toIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const service = await ctx.db.get(args.serviceId);
    if (!service) {
      throw new Error("Service not found");
    }
    const items = [...service.items];
    const [removed] = items.splice(args.fromIndex, 1);
    items.splice(args.toIndex, 0, removed);
    await ctx.db.patch(args.serviceId, { items });
    return args.serviceId;
  },
});

export const update = mutation({
  args: {
    serviceId: v.id("services"),
    name: v.optional(v.string()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const service = await ctx.db.get(args.serviceId);
    if (!service) {
      throw new Error("Service not found");
    }
    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.date !== undefined) updates.date = args.date;
    await ctx.db.patch(args.serviceId, updates);
    return args.serviceId;
  },
});

export const rename = mutation({
  args: {
    serviceId: v.id("services"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const service = await ctx.db.get(args.serviceId);
    if (!service) {
      throw new Error("Service not found");
    }
    await ctx.db.patch(args.serviceId, { name: args.name });
    return args.serviceId;
  },
});

export const remove = mutation({
  args: { serviceId: v.id("services") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.serviceId);
  },
});
