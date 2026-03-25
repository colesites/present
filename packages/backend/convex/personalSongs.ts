import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("personalSongs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const listByCategory = query({
  args: { categoryId: v.id("personalCategories") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("personalSongs")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .collect();
  },
});

export const get = query({
  args: { songId: v.id("personalSongs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.songId);
  },
});

export const create = mutation({
  args: {
    userId: v.id("users"),
    categoryId: v.optional(v.id("personalCategories")),
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
    return await ctx.db.insert("personalSongs", {
      userId: args.userId,
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
    songId: v.id("personalSongs"),
    categoryId: v.optional(v.id("personalCategories")),
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

export async function removeItemsFromAllPersonalServices(
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

export const remove = mutation({
  args: { songId: v.id("personalSongs") },
  handler: async (ctx, args) => {
    const song = await ctx.db.get(args.songId);
    if (song) {
      await removeItemsFromAllPersonalServices(
        ctx,
        song.userId,
        (item) => item.type === "song" && item.refId === args.songId,
      );
    }
    await ctx.db.delete(args.songId);
  },
});

