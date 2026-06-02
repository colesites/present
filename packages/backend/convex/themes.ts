import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) =>
    ctx.db
      .query("themes")
      .withIndex("by_org_order", (q) => q.eq("orgId", args.orgId))
      .collect(),
});

export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    style: v.any(),
    backgroundColor: v.optional(v.string()),
    previewColor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const now = Date.now();
    const existing = await ctx.db
      .query("themes")
      .withIndex("by_org_order", (q) => q.eq("orgId", args.orgId))
      .collect();
    const order =
      existing.reduce((max, t) => (t.order > max ? t.order : max), -1) + 1;
    return ctx.db.insert("themes", {
      orgId: args.orgId,
      name: args.name.trim() || "Theme",
      style: args.style ?? {},
      backgroundColor: args.backgroundColor,
      previewColor: args.previewColor ?? "#1f2030",
      order,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    themeId: v.id("themes"),
    name: v.optional(v.string()),
    style: v.optional(v.any()),
    backgroundColor: v.optional(v.string()),
    previewColor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const existing = await ctx.db.get(args.themeId);
    if (!existing) throw new ConvexError("Theme not found");
    const patch: Partial<typeof existing> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name;
    if (args.style !== undefined) patch.style = args.style;
    if (args.backgroundColor !== undefined) {
      patch.backgroundColor = args.backgroundColor;
    }
    if (args.previewColor !== undefined) patch.previewColor = args.previewColor;
    await ctx.db.patch(args.themeId, patch);
    return args.themeId;
  },
});

export const remove = mutation({
  args: { themeId: v.id("themes") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    await ctx.db.delete(args.themeId);
    return args.themeId;
  },
});
