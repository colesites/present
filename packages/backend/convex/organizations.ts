import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

export const updateMetadata = mutation({
  args: {
    clerkOrgId: v.string(),
    orgType: v.optional(v.string()),
    location: v.optional(v.string()),
    userRole: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    const userId = identity.subject;

    // Find or create organization
    let org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_org", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .first();

    const now = Date.now();

    if (!org) {
      // Create new organization
      const orgId = await ctx.db.insert("organizations", {
        name: "Organization", // Will be updated from Clerk
        slug: `org-${Date.now()}`,
        clerkOrgId: args.clerkOrgId,
        orgType: args.orgType,
        createdAt: now,
      });

      // Create user profile
      await ctx.db.insert("userProfiles", {
        userId,
        orgId,
        role: "admin",
        userRole: args.userRole,
        createdAt: now,
      });

      return { orgId };
    }

    // Update existing organization
    await ctx.db.patch(org._id, {
      orgType: args.orgType,
    });

    // Update or create user profile
    const userProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user_org", (q) => q.eq("userId", userId).eq("orgId", org._id))
      .first();

    if (userProfile) {
      await ctx.db.patch(userProfile._id, {
        userRole: args.userRole,
      });
    } else {
      await ctx.db.insert("userProfiles", {
        userId,
        orgId: org._id,
        role: "admin",
        userRole: args.userRole,
        createdAt: now,
      });
    }

    return { orgId: org._id };
  },
});

export const getByClerkId = query({
  args: {
    clerkOrgId: v.string(),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_org", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .first();

    return org;
  },
});
