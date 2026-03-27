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

// Add a user to an existing organization
export const addUserToOrganization = mutation({
  args: {
    orgId: v.id("organizations"),
    userEmail: v.string(),
    role: v.optional(v.string()), // "admin" or "user"
    userRole: v.optional(v.string()), // functional role like "tech-director"
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    const currentUser = await ctx.db.get(identity.subject as Id<"users">);
    if (!currentUser) {
      throw new ConvexError("User not found");
    }

    // Check if current user is an admin of this organization
    const currentUserProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", currentUser._id))
      .filter((q) => q.eq(q.field("orgId"), args.orgId))
      .first();

    if (!currentUserProfile || currentUserProfile.role !== "admin") {
      throw new ConvexError("Only organization admins can add users");
    }

    // Find the user to add by email
    const userToAdd = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), args.userEmail))
      .first();

    if (!userToAdd) {
      throw new ConvexError(`No user found with email: ${args.userEmail}`);
    }

    // Check if user is already in the organization
    const existingProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userToAdd._id))
      .filter((q) => q.eq(q.field("orgId"), args.orgId))
      .first();

    if (existingProfile) {
      throw new ConvexError("User is already a member of this organization");
    }

    // Add user to organization
    const profileId = await ctx.db.insert("userProfiles", {
      userId: userToAdd._id,
      orgId: args.orgId,
      role: args.role || "user",
      userRole: args.userRole ?? undefined,
      createdAt: Date.now(),
    });

    return { profileId, userId: userToAdd._id };
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

    const currentUser = await ctx.db.get(identity.subject as Id<"users">);
    if (!currentUser) {
      return [];
    }

    // Check if current user is a member of this organization
    const currentUserProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", currentUser._id))
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

    // Get user details for each profile
    const members = await Promise.all(
      profiles.map(async (profile) => {
        const user = await ctx.db.get(profile.userId);
        if (!user) return null;

        return {
          userId: user._id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: profile.role,
          userRole: profile.userRole,
          joinedAt: profile.createdAt,
        };
      })
    );

    return members.filter((member) => member !== null);
  },
});

// Remove a user from an organization
export const removeUserFromOrganization = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    const currentUser = await ctx.db.get(identity.subject as Id<"users">);
    if (!currentUser) {
      throw new ConvexError("User not found");
    }

    // Check if current user is an admin of this organization
    const currentUserProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", currentUser._id))
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
