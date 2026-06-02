import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) =>
    ctx.db
      .query("slideMasters")
      .withIndex("by_org_order", (q) => q.eq("orgId", args.orgId))
      .collect(),
});

export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    color: v.optional(v.string()),
    body: v.optional(v.string()),
    slide: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const now = Date.now();
    const existing = await ctx.db
      .query("slideMasters")
      .withIndex("by_org_order", (q) => q.eq("orgId", args.orgId))
      .collect();
    const order =
      existing.reduce((max, m) => (m.order > max ? m.order : max), -1) + 1;
    return ctx.db.insert("slideMasters", {
      orgId: args.orgId,
      name: args.name.trim() || "Master",
      color: args.color ?? "#1f6feb",
      body: args.body ?? "",
      slide: args.slide ?? undefined,
      order,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    masterId: v.id("slideMasters"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    body: v.optional(v.string()),
    slide: v.optional(v.any()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const existing = await ctx.db.get(args.masterId);
    if (!existing) throw new ConvexError("Master not found");
    const patch: Partial<typeof existing> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name;
    if (args.color !== undefined) patch.color = args.color;
    if (args.body !== undefined) patch.body = args.body;
    if (args.slide !== undefined) patch.slide = args.slide;
    if (args.order !== undefined) patch.order = args.order;
    await ctx.db.patch(args.masterId, patch);
    return args.masterId;
  },
});

export const remove = mutation({
  args: { masterId: v.id("slideMasters") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    await ctx.db.delete(args.masterId);
    return args.masterId;
  },
});
