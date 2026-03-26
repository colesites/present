import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateWorkspace } from "./authUtils";

export const list = query({
  args: { workspaceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);

    if (workspace.type === "personal") {
      return await ctx.db
        .query("personalLibraries")
        .withIndex("by_user", (q) => q.eq("userId", workspace.userId))
        .collect();
    } else {
      return await ctx.db
        .query("libraries")
        .withIndex("by_org", (q) => q.eq("orgId", workspace.orgId))
        .collect();
    }
  },
});

export const create = mutation({
  args: {
    workspaceId: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    title: v.string(),
    body: v.string(),
    slides: v.array(
      v.object({
        text: v.string(),
        label: v.optional(v.string()),
        modifier: v.optional(v.string()),
        backgroundId: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);
    const now = Date.now();

    if (workspace.type === "personal") {
      return await ctx.db.insert("personalLibraries", {
        userId: workspace.userId,
        categoryId: args.categoryId as any,
        title: args.title,
        body: args.body,
        slides: args.slides,
        createdAt: now,
      });
    } else {
      return await ctx.db.insert("libraries", {
        orgId: workspace.orgId,
        categoryId: args.categoryId as any,
        title: args.title,
        body: args.body,
        slides: args.slides,
        createdAt: now,
      });
    }
  },
});

export const update = mutation({
  args: {
    workspaceId: v.optional(v.string()),
    libraryId: v.string(),
    categoryId: v.optional(v.string()),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    slides: v.optional(
      v.array(
        v.object({
          text: v.string(),
          label: v.optional(v.string()),
          modifier: v.optional(v.string()),
          backgroundId: v.optional(v.string()),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);
    const updates: any = { updatedAt: Date.now() };
    if (args.categoryId !== undefined) updates.categoryId = args.categoryId;
    if (args.title !== undefined) updates.title = args.title;
    if (args.body !== undefined) updates.body = args.body;
    if (args.slides !== undefined) updates.slides = args.slides;

    if (workspace.type === "personal") {
      const libraryId = args.libraryId as any;
      const existing = await ctx.db.get(libraryId);
      if (!existing || !("userId" in existing) || existing.userId !== workspace.userId) {
        throw new Error("Library item not found or unauthorized");
      }
      await ctx.db.patch(libraryId, updates);
      return libraryId;
    } else {
      const libraryId = args.libraryId as any;
      const existing = await ctx.db.get(libraryId);
      if (!existing || !("orgId" in existing) || existing.orgId !== workspace.orgId) {
        throw new Error("Library item not found or unauthorized");
      }
      await ctx.db.patch(libraryId, updates);
      return libraryId;
    }
  },
});

export const remove = mutation({
  args: {
    workspaceId: v.optional(v.string()),
    libraryId: v.string(),
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);

    if (workspace.type === "personal") {
      const libraryId = args.libraryId as any;
      const existing = await ctx.db.get(libraryId);
      if (!existing || !("userId" in existing) || existing.userId !== workspace.userId) {
        throw new Error("Library item not found or unauthorized");
      }
      await ctx.db.delete(libraryId);
    } else {
      const libraryId = args.libraryId as any;
      const existing = await ctx.db.get(libraryId);
      if (!existing || !("orgId" in existing) || existing.orgId !== workspace.orgId) {
        throw new Error("Library item not found or unauthorized");
      }
      await ctx.db.delete(libraryId);
    }
  },
});
