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
    
    // Get user from Convex Auth's users table
    const user = await ctx.db.get(identity.subject as Id<"users">);
    if (!user) {
      return null;
    }
    
    // Return user info from Convex Auth identity
    return {
      _id: identity.subject as Id<"users">,
      name: user.name ?? identity.name,
      email: user.email ?? identity.email,
      image: user.image ?? identity.pictureUrl,
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
    if (!user) {
      return null;
    }

    // Get user profile which has the orgId
    const userProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!userProfile) {
      return null;
    }

    const org = await ctx.db.get(userProfile.orgId);
    return { user, org, userProfile };
  },
});

export const listMyOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const user = await ctx.db.get(identity.subject as Id<"users">);
    if (!user) {
      return [];
    }

    // Get all user profiles for this user (they might belong to multiple orgs)
    const userProfiles = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const organizations = await Promise.all(
      userProfiles.map(async (profile) => {
        const org = await ctx.db.get(profile.orgId);
        if (!org) return null;
        
        return {
          id: org._id,
          name: org.name,
          slug: org.slug,
          logo: org.logo ?? null,
          role: profile.role,
          createdAt: org.createdAt,
        };
      })
    );

    return organizations.filter((org) => org !== null);
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

    const user = await ctx.db.get(identity.subject as Id<"users">);
    if (!user) {
      throw new ConvexError("User not found");
    }

    // Check if user already has a profile
    const existingProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    
    if (existingProfile) {
      // Update existing org if metadata provided
      if (args.orgName !== undefined || args.logo !== undefined || args.orgType !== undefined) {
        await ctx.db.patch(existingProfile.orgId, {
          ...(args.orgName !== undefined ? { name: args.orgName } : {}),
          ...(args.logo !== undefined ? { logo: args.logo } : {}),
          ...(args.orgType !== undefined ? { orgType: args.orgType } : {}),
        });
      }

      // Update user role if provided
      if (args.userRole !== undefined) {
        await ctx.db.patch(existingProfile._id, {
          userRole: args.userRole,
        });
      }

      return { userId: user._id, orgId: existingProfile.orgId };
    }

    // Create new organization and user profile
    const now = Date.now();
    const orgName = args.orgName || user.name || user.email || "Untitled Organization";
    
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

    const profileId = await ctx.db.insert("userProfiles", {
      userId: user._id,
      orgId,
      role: "admin",
      userRole: args.userRole ?? undefined,
      createdAt: now,
    });

    return { userId: user._id, orgId, profileId };
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

    const user = await ctx.db.get(identity.subject as Id<"users">);
    if (!user) {
      throw new ConvexError("User not found");
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

    const profileId = await ctx.db.insert("userProfiles", {
      userId: user._id,
      orgId,
      role: "admin",
      userRole: args.userRole ?? undefined,
      createdAt: now,
    });

    return { userId: user._id, orgId, profileId };
  },
});
