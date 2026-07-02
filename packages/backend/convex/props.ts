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

const propKindValidator = v.union(
  v.literal("image"),
  v.literal("text"),
  v.literal("video"),
  v.literal("youtube"),
  v.literal("ndi"),
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
    kind: propKindValidator,
    imageUrl: v.optional(v.string()),
    mediaUrl: v.optional(v.string()),
    youtubeUrl: v.optional(v.string()),
    ndiSourceName: v.optional(v.string()),
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
      mediaUrl: args.mediaUrl,
      youtubeUrl: args.youtubeUrl,
      ndiSourceName: args.ndiSourceName,
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
    mediaUrl: v.optional(v.string()),
    youtubeUrl: v.optional(v.string()),
    ndiSourceName: v.optional(v.string()),
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
    if (args.mediaUrl !== undefined) patch.mediaUrl = args.mediaUrl;
    if (args.youtubeUrl !== undefined) patch.youtubeUrl = args.youtubeUrl;
    if (args.ndiSourceName !== undefined) patch.ndiSourceName = args.ndiSourceName;
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

export const move = mutation({
  args: {
    propId: v.id("props"),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const existing = await ctx.db.get(args.propId);
    if (!existing) throw new ConvexError("Prop not found");

    const props = await ctx.db
      .query("props")
      .withIndex("by_org_order", (q) => q.eq("orgId", existing.orgId))
      .collect();
    const sorted = [...props].sort((left, right) => left.order - right.order);
    const index = sorted.findIndex((item) => item._id === args.propId);
    const targetIndex = args.direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) {
      return args.propId;
    }

    const target = sorted[targetIndex];
    await ctx.db.patch(existing._id, {
      order: target.order,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(target._id, {
      order: existing.order,
      updatedAt: Date.now(),
    });
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
