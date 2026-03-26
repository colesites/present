import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { Id } from "./_generated/dataModel";

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    
    // Return user info from Convex Auth identity
    return {
      _id: identity.subject as Id<"users">,
      name: identity.name,
      email: identity.email,
      image: identity.pictureUrl,
    };
  },
});

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    
    const user = await ctx.db.get(identity.subject as Id<"users">);
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

    const user = await ctx.db.get(identity.subject as Id<"users">);
    if (!user || !("orgId" in user)) {
      return null;
    }

    const org = await ctx.db.get(user.orgId);
    return { user, org };
  },
});

export const listMyOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    // For now, return the single organization the user belongs to
    const user = await ctx.db.get(identity.subject as Id<"users">);
    if (!user || !("orgId" in user)) {
      return [];
    }

    const org = await ctx.db.get(user.orgId);
    if (!org || !("name" in org)) {
      return [];
    }

    return [{
      id: org._id,
      name: org.name,
      slug: org.slug,
      logo: org.logo ?? null,
      role: user.role,
      createdAt: org.createdAt,
    }];
  },
});

export const ensureCurrent = mutation({
  args: {
    orgName: v.optional(v.string()),
    logo: v.optional(v.string()),
    orgType: v.optional(v.string()),
    userRole: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    // Check if user record already exists
    const existingUser = await ctx.db.get(identity.subject as Id<"users">);
    
    if (existingUser && "orgId" in existingUser) {
      // Update existing org if metadata provided
      if (args.orgName !== undefined || args.logo !== undefined || args.orgType !== undefined) {
        await ctx.db.patch(existingUser.orgId, {
          ...(args.orgName !== undefined ? { name: args.orgName } : {}),
          ...(args.logo !== undefined ? { logo: args.logo } : {}),
          ...(args.orgType !== undefined ? { orgType: args.orgType } : {}),
        });
      }

      // Update user role if provided
      if (args.userRole !== undefined) {
        await ctx.db.patch(existingUser._id, {
          userRole: args.userRole,
        });
      }

      return { userId: existingUser._id, orgId: existingUser.orgId };
    }

    // Create new organization and user
    const now = Date.now();
    const orgName = args.orgName || identity.name || identity.email || "Untitled Organization";
    
    const slug = orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");

    const orgId = await ctx.db.insert("organizations", {
      name: orgName,
      slug,
      ...(args.logo !== undefined ? { logo: args.logo } : {}),
      ...(args.orgType !== undefined ? { orgType: args.orgType } : {}),
      createdAt: now,
    });

    const newUserId = await ctx.db.insert("users", {
      orgId,
      email: identity.email ?? undefined,
      name: identity.name ?? undefined,
      role: "admin",
      userRole: args.userRole ?? undefined,
      createdAt: now,
    });

    return { userId: newUserId, orgId };
  },
});

export const createOrganization = mutation({
  args: {
    orgName: v.string(),
    logo: v.optional(v.string()),
    orgType: v.optional(v.string()),
    userRole: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    const now = Date.now();
    const slug = args.orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");

    const orgId = await ctx.db.insert("organizations", {
      name: args.orgName,
      slug,
      logo: args.logo ?? undefined,
      orgType: args.orgType ?? undefined,
      createdAt: now,
    });

    const newUserId = await ctx.db.insert("users", {
      orgId,
      email: identity.email ?? undefined,
      name: identity.name ?? undefined,
      role: "admin",
      userRole: args.userRole ?? undefined,
      createdAt: now,
    });

    return { userId: newUserId, orgId };
  },
});
