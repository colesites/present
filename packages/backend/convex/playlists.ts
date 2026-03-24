import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("playlists")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
  },
});

export const createDefault = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("playlists")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();
    if (existing) {
      return existing._id;
    }
    const now = Date.now();
    return await ctx.db.insert("playlists", {
      orgId: args.orgId,
      name: "Service",
      itemIds: [],
      createdAt: now,
    });
  },
});

export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    itemIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("playlists", {
      orgId: args.orgId,
      name: args.name,
      itemIds: args.itemIds,
      createdAt: now,
    });
  },
});

export const addItem = mutation({
  args: {
    playlistId: v.id("playlists"),
    itemId: v.string(),
  },
  handler: async (ctx, args) => {
    const playlist = await ctx.db.get(args.playlistId);
    if (!playlist) {
      throw new Error("Playlist not found");
    }
    await ctx.db.patch(args.playlistId, {
      itemIds: [...playlist.itemIds, args.itemId],
    });
    return args.playlistId;
  },
});
