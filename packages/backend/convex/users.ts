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
    
    // With Clerk, user data comes from the JWT token
    return {
      _id: identity.subject,
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
    
    return {
      _id: identity.subject,
      name: identity.name,
      email: identity.email,
      image: identity.pictureUrl,
    };
  },
});

export const getCurrentWithOrg = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const userId = identity.subject;

    // Get user profile which has the orgId
    const userProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!userProfile) {
      return null;
    }

    const org = await ctx.db.get(userProfile.orgId);
    return { 
      user: {
        _id: userId,
        name: identity.name,
        email: identity.email,
        image: identity.pictureUrl,
      }, 
      org, 
      userProfile 
    };
  },
});

export const listMyOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const userId = identity.subject;

    // Get all user profiles for this user (they might belong to multiple orgs)
    const userProfiles = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
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

    const userId = identity.subject;

    // Check if user already has a profile
    const existingProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
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

      return { userId, orgId: existingProfile.orgId };
    }

    // Create new organization and user profile
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

    const profileId = await ctx.db.insert("userProfiles", {
      userId,
      orgId,
      role: "admin",
      userRole: args.userRole ?? undefined,
      createdAt: now,
    });

    return { userId, orgId, profileId };
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

    const userId = identity.subject;

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
      userId,
      orgId,
      role: "admin",
      userRole: args.userRole ?? undefined,
      createdAt: now,
    });

    return { userId, orgId, profileId };
  },
});

// Add a user to an existing organization (by Clerk user ID)
export const addUserToOrganization = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.string(), // Clerk user ID
    role: v.optional(v.string()), // "admin" or "user"
    userRole: v.optional(v.string()), // functional role like "tech-director"
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    const currentUserId = identity.subject;

    // Check if current user is an admin of this organization
    const currentUserProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", currentUserId))
      .filter((q) => q.eq(q.field("orgId"), args.orgId))
      .first();

    if (!currentUserProfile || currentUserProfile.role !== "admin") {
      throw new ConvexError("Only organization admins can add users");
    }

    // Check if user is already in the organization
    const existingProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("orgId"), args.orgId))
      .first();

    if (existingProfile) {
      throw new ConvexError("User is already a member of this organization");
    }

    // Add user to organization
    const profileId = await ctx.db.insert("userProfiles", {
      userId: args.userId,
      orgId: args.orgId,
      role: args.role || "user",
      userRole: args.userRole ?? undefined,
      createdAt: Date.now(),
    });

    return { profileId, userId: args.userId };
  },
});

// List all members of an organization
export const listOrganizationMembers = query({
  args: {
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const currentUserId = identity.subject;

    // Check if current user is a member of this organization
    const currentUserProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", currentUserId))
      .filter((q) => q.eq(q.field("orgId"), args.orgId))
      .first();

    if (!currentUserProfile) {
      throw new ConvexError("You are not a member of this organization");
    }

    // Get all user profiles for this organization
    const profiles = await ctx.db
      .query("userProfiles")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    // Return profile data (user details come from Clerk on the frontend)
    return profiles.map((profile) => ({
      userId: profile.userId,
      role: profile.role,
      userRole: profile.userRole,
      joinedAt: profile.createdAt,
    }));
  },
});

// Remove a user from an organization
export const removeUserFromOrganization = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.string(), // Clerk user ID
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    const currentUserId = identity.subject;

    // Check if current user is an admin of this organization
    const currentUserProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", currentUserId))
      .filter((q) => q.eq(q.field("orgId"), args.orgId))
      .first();

    if (!currentUserProfile || currentUserProfile.role !== "admin") {
      throw new ConvexError("Only organization admins can remove users");
    }

    // Find the user profile to remove
    const profileToRemove = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("orgId"), args.orgId))
      .first();

    if (!profileToRemove) {
      throw new ConvexError("User is not a member of this organization");
    }

    // Don't allow removing the last admin
    if (profileToRemove.role === "admin") {
      const adminProfiles = await ctx.db
        .query("userProfiles")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .filter((q) => q.eq(q.field("role"), "admin"))
        .collect();

      if (adminProfiles.length <= 1) {
        throw new ConvexError("Cannot remove the last admin from the organization");
      }
    }

    await ctx.db.delete(profileToRemove._id);
    return { success: true };
  },
});
