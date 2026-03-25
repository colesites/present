import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const services = await ctx.db
      .query("personalServices")
      .withIndex("by_user_order", (q) => q.eq("userId", args.userId))
      .collect();
    return services.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  },
});

export const get = query({
  args: { serviceId: v.id("personalServices") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.serviceId);
  },
});

export const create = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("personalServices")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const maxOrder = existing.reduce(
      (max, s) => Math.max(max, s.order ?? 0),
      0,
    );
    return await ctx.db.insert("personalServices", {
      userId: args.userId,
      name: args.name,
      date: args.date,
      order: maxOrder + 1,
      items: [],
      createdAt: now,
    });
  },
});

export const addItem = mutation({
  args: {
    serviceId: v.id("personalServices"),
    type: v.union(v.literal("song"), v.literal("media"), v.literal("scripture")),
    refId: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const service = await ctx.db.get(args.serviceId);
    if (!service) throw new Error("Service not found");
    const newItem = {
      type: args.type,
      refId: args.refId,
      label: args.label,
      addedAt: Date.now(),
    };
    await ctx.db.patch(args.serviceId, { items: [...service.items, newItem] });
    return args.serviceId;
  },
});

export const removeItem = mutation({
  args: { serviceId: v.id("personalServices"), itemIndex: v.number() },
  handler: async (ctx, args) => {
    const service = await ctx.db.get(args.serviceId);
    if (!service) throw new Error("Service not found");
    const items = [...service.items];
    items.splice(args.itemIndex, 1);
    await ctx.db.patch(args.serviceId, { items });
    return args.serviceId;
  },
});

export const reorderItems = mutation({
  args: {
    serviceId: v.id("personalServices"),
    fromIndex: v.number(),
    toIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const service = await ctx.db.get(args.serviceId);
    if (!service) throw new Error("Service not found");
    const items = [...service.items];
    const [removed] = items.splice(args.fromIndex, 1);
    items.splice(args.toIndex, 0, removed);
    await ctx.db.patch(args.serviceId, { items });
    return args.serviceId;
  },
});

export const update = mutation({
  args: {
    serviceId: v.id("personalServices"),
    name: v.optional(v.string()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const service = await ctx.db.get(args.serviceId);
    if (!service) throw new Error("Service not found");
    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.date !== undefined) updates.date = args.date;
    await ctx.db.patch(args.serviceId, updates);
    return args.serviceId;
  },
});

export const rename = mutation({
  args: { serviceId: v.id("personalServices"), name: v.string() },
  handler: async (ctx, args) => {
    const service = await ctx.db.get(args.serviceId);
    if (!service) throw new Error("Service not found");
    await ctx.db.patch(args.serviceId, { name: args.name });
    return args.serviceId;
  },
});

export const remove = mutation({
  args: { serviceId: v.id("personalServices") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.serviceId);
  },
});

export const reorderServices = mutation({
  args: {
    userId: v.id("users"),
    fromIndex: v.number(),
    toIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, fromIndex, toIndex } = args;
    if (fromIndex === toIndex) return;
    const services = await ctx.db
      .query("personalServices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const sorted = services.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (fromIndex < 0 || fromIndex >= sorted.length) return;
    if (toIndex < 0 || toIndex >= sorted.length) return;
    const [moved] = sorted.splice(fromIndex, 1);
    sorted.splice(toIndex, 0, moved);
    await Promise.all(
      sorted.map((service, index) => ctx.db.patch(service._id, { order: index })),
    );
  },
});

export async function removeItemsFromAllServices(
  ctx: MutationCtx,
  userId: Id<"users">,
  shouldRemove: (item: any) => boolean,
) {
  const services = await ctx.db
    .query("personalServices")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  for (const service of services) {
    const newItems = service.items.filter((item) => !shouldRemove(item));
    if (newItems.length !== service.items.length) {
      await ctx.db.patch(service._id, { items: newItems });
    }
  }
}

