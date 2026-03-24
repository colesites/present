import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { removeItemsFromAllServices } from "./services";

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("songs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
  },
});

export const listByCategory = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("songs")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .collect();
  },
});

export const get = query({
  args: { songId: v.id("songs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.songId);
  },
});

export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    categoryId: v.optional(v.id("categories")),
    title: v.string(),
    lyrics: v.string(),
    slides: v.array(
      v.object({
        text: v.string(),
        label: v.optional(v.string()),
        modifier: v.optional(v.string()),
        backgroundId: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("songs", {
      orgId: args.orgId,
      categoryId: args.categoryId,
      title: args.title,
      lyrics: args.lyrics,
      slides: args.slides,
      createdAt: now,
    });
  },
});

export const update = mutation({
  args: {
    songId: v.id("songs"),
    categoryId: v.optional(v.id("categories")),
    title: v.optional(v.string()),
    lyrics: v.optional(v.string()),
    slides: v.optional(
      v.array(
        v.object({
          text: v.string(),
          label: v.optional(v.string()),
          modifier: v.optional(v.string()),
          backgroundId: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const song = await ctx.db.get(args.songId);
    if (!song) {
      throw new Error("Song not found");
    }
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.categoryId !== undefined) updates.categoryId = args.categoryId;
    if (args.title !== undefined) updates.title = args.title;
    if (args.lyrics !== undefined) updates.lyrics = args.lyrics;
    if (args.slides !== undefined) updates.slides = args.slides;
    await ctx.db.patch(args.songId, updates);
    return args.songId;
  },
});

export const remove = mutation({
  args: { songId: v.id("songs") },
  handler: async (ctx, args) => {
    const song = await ctx.db.get(args.songId);
    if (song) {
      await removeItemsFromAllServices(
        ctx,
        song.orgId,
        (item) => item.type === "song" && item.refId === args.songId
      );
    }
    await ctx.db.delete(args.songId);
  },
});
