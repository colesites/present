import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    
    // 1. Try by token (BetterAuth ID or Clerk ID)
    let user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    // 2. If not found, try by email (migration/linking logic)
    if (!user && identity.email) {
      user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", identity.email))
        .unique();
    }
    
    return user;
  },
});

export const getCurrentWithOrg = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    // Use our linking logic
    let user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (!user && identity.email) {
      user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", identity.email))
        .unique();
    }

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

    // Check for existing by token
    let existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    // Migration: If not found by token, check by email
    if (!existing && identity.email) {
      existing = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", identity.email))
        .unique();
      
      // If found by email, link the new tokenIdentifier to this existing record
      if (existing) {
        await ctx.db.patch(existing._id, {
          tokenIdentifier: identity.tokenIdentifier,
          name: identity.name ?? existing.name,
        });
        return existing._id;
      }
    }

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
  args: {
    orgName: v.optional(v.string()),
    logo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Try by token
    let existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    // Migration logic: Link by email if token differs
    if (!existing && identity.email) {
      existing = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", identity.email))
        .unique();
      
      if (existing) {
        await ctx.db.patch(existing._id, {
          tokenIdentifier: identity.tokenIdentifier,
        });
      }
    }

    if (existing) {
      if (args.orgName !== undefined || args.logo !== undefined) {
        await ctx.db.patch(existing.orgId, {
          ...(args.orgName !== undefined ? { name: args.orgName } : {}),
          ...(args.logo !== undefined ? { logo: args.logo } : {}),
        });
      }
      return { userId: existing._id, orgId: existing.orgId };
    }

    const now = Date.now();
    const orgName =
      args.orgName ??
      identity.name ??
      identity.email ??
      identity.nickname ??
      "Untitled Organization";
    
    // Create new organization for the new user
    const orgId = await ctx.db.insert("organizations", {
      name: orgName,
      ...(args.logo !== undefined ? { logo: args.logo } : {}),
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
