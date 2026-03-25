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
    const orgId = await ctx.db.insert("organizations", {
      name: args.name,
      ...(args.logo !== undefined ? { logo: args.logo } : {}),
      createdAt: now,
    });
    return orgId;
  },
});

export const ensureForAuthOrganization = mutation({
  args: {
    authOrganizationId: v.string(),
    name: v.optional(v.string()),
    logo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const existingLink = await ctx.db
      .query("organizationLinks")
      .withIndex("by_auth_org", (q) => q.eq("authOrganizationId", args.authOrganizationId))
      .unique();

    if (existingLink) {
      return existingLink.orgId;
    }

    const now = Date.now();
    const orgId = await ctx.db.insert("organizations", {
      name: args.name ?? "Organization",
      ...(args.logo !== undefined ? { logo: args.logo } : {}),
      createdAt: now,
    });

    await ctx.db.insert("organizationLinks", {
      authOrganizationId: args.authOrganizationId,
      orgId,
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
      throw new Error("Current user was not found");
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

    await ctx.db.patch(user.orgId, updates);
    return user.orgId;
  },
});
