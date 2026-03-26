import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("organizations").collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    logo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const slug = args.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");

    const orgId = await ctx.db.insert("organizations", {
      name: args.name,
      slug,
      ...(args.logo !== undefined ? { logo: args.logo } : {}),
      createdAt: now,
    });

    return orgId;
  },
});

export const updateCurrent = mutation({
  args: {
    name: v.optional(v.string()),
    logo: v.optional(v.string()),
    clearLogo: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const userId = identity.subject as any;
    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Get user profile to find their organization
    const userProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!userProfile) {
      throw new Error("User profile not found");
    }

    const updates: Record<string, string | undefined> = {};

    if (args.name !== undefined) {
      updates.name = args.name;
    }

    if (args.clearLogo) {
      updates.logo = undefined;
    } else if (args.logo !== undefined) {
      updates.logo = args.logo;
    }

    await ctx.db.patch(userProfile.orgId, updates);
    return userProfile.orgId;
  },
});

