import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    return await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
  },
});

export const getCurrentWithOrg = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) {
      return null;
    }

    const org = await ctx.db.get(user.orgId);
    return { user, org };
  },
});

export const createForCurrent = mutation({
  args: {
    orgId: v.id("organizations"),
    role: v.optional(v.union(v.literal("admin"), v.literal("user"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (existing) {
      return existing._id;
    }

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      orgId: args.orgId,
      tokenIdentifier: identity.tokenIdentifier,
      email: identity.email ?? undefined,
      name: identity.name ?? identity.givenName ?? undefined,
      role: args.role ?? "user",
      createdAt: now,
    });
    return userId;
  },
});

export const ensureCurrent = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (existing) {
      return { userId: existing._id, orgId: existing.orgId };
    }

    const now = Date.now();
    const orgName =
      identity.name ??
      identity.email ??
      identity.nickname ??
      "Untitled Organization";
    const orgId = await ctx.db.insert("organizations", {
      name: orgName,
      createdAt: now,
    });

    const userId = await ctx.db.insert("users", {
      orgId,
      tokenIdentifier: identity.tokenIdentifier,
      email: identity.email ?? undefined,
      name: identity.name ?? identity.givenName ?? undefined,
      role: "admin",
      createdAt: now,
    });

    return { userId, orgId };
  },
});
