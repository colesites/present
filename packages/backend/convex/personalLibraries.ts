import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { removeItemsFromAllPersonalServices } from "./personalSongs";

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
  args: { libraryId: v.id("personalSongs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.libraryId);
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
    libraryId: v.id("personalSongs"),
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
    const library = await ctx.db.get(args.libraryId);
    if (!library) {
      throw new Error("Library item not found");
    }
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.categoryId !== undefined) updates.categoryId = args.categoryId;
    if (args.title !== undefined) updates.title = args.title;
    if (args.lyrics !== undefined) updates.lyrics = args.lyrics;
    if (args.slides !== undefined) updates.slides = args.slides;
    await ctx.db.patch(args.libraryId, updates);
    return args.libraryId;
  },
});

export const remove = mutation({
  args: { libraryId: v.id("personalSongs") },
  handler: async (ctx, args) => {
    const library = await ctx.db.get(args.libraryId);
    if (library) {
      await removeItemsFromAllPersonalServices(
        ctx,
        library.userId,
        (item) => item.type === "song" && item.refId === args.libraryId,
      );
    }
    await ctx.db.delete(args.libraryId);
  },
});

