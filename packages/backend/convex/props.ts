import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

const positionValidator = v.union(
  v.literal("top-left"),
  v.literal("top-right"),
  v.literal("bottom-left"),
  v.literal("bottom-right"),
  v.literal("center"),
  v.literal("full"),
);

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) =>
    ctx.db
      .query("props")
      .withIndex("by_org_order", (q) => q.eq("orgId", args.orgId))
      .collect(),
});

export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    kind: v.union(v.literal("image"), v.literal("text")),
    imageUrl: v.optional(v.string()),
    text: v.optional(v.string()),
    position: v.optional(positionValidator),
    opacity: v.optional(v.number()),
    sizePercent: v.optional(v.number()),
    color: v.optional(v.string()),
    fontSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const now = Date.now();
    const existing = await ctx.db
      .query("props")
      .withIndex("by_org_order", (q) => q.eq("orgId", args.orgId))
      .collect();
    const order =
      existing.reduce((max, p) => (p.order > max ? p.order : max), -1) + 1;
    return ctx.db.insert("props", {
      orgId: args.orgId,
      name: args.name.trim() || "Prop",
      kind: args.kind,
      imageUrl: args.imageUrl,
      text: args.text,
      position: args.position ?? "bottom-right",
      opacity: args.opacity ?? 1,
      sizePercent: args.sizePercent ?? 20,
      color: args.color,
      fontSize: args.fontSize,
      order,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    propId: v.id("props"),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    text: v.optional(v.string()),
    position: v.optional(positionValidator),
    opacity: v.optional(v.number()),
    sizePercent: v.optional(v.number()),
    color: v.optional(v.string()),
    fontSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const existing = await ctx.db.get(args.propId);
    if (!existing) throw new ConvexError("Prop not found");
    const patch: Partial<typeof existing> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name;
    if (args.imageUrl !== undefined) patch.imageUrl = args.imageUrl;
    if (args.text !== undefined) patch.text = args.text;
    if (args.position !== undefined) patch.position = args.position;
    if (args.opacity !== undefined) patch.opacity = args.opacity;
    if (args.sizePercent !== undefined) patch.sizePercent = args.sizePercent;
    if (args.color !== undefined) patch.color = args.color;
    if (args.fontSize !== undefined) patch.fontSize = args.fontSize;
    await ctx.db.patch(args.propId, patch);
    return args.propId;
  },
});

export const remove = mutation({
  args: { propId: v.id("props") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    await ctx.db.delete(args.propId);
    return args.propId;
  },
});
