import { mutation, query, type MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { Id } from "./_generated/dataModel";
import { getPresentPlanDefinition } from "../../shared/src/billing";
import { normalizeWorkspaceRole } from "../../shared/src/workspace-roles";
import {
  billingSummary,
  calendarMonth,
  entitlementsFor,
  identityEmail,
} from "./entitlements";

/**
 * Note on the person's billing record whether they are on the allowlist.
 *
 * The allowlist is by email, which only their own token carries, so without
 * this a workspace could not count an allowlisted admin while somebody else
 * was the one joining it. Refreshed every time they sign in.
 */
const recordAllowlist = async (ctx: MutationCtx, userId: string, email: string | null) => {
  const entry = email
    ? await ctx.db
        .query("speechQuotaAllowlist")
        .withIndex("by_normalized_email", (q) => q.eq("normalizedEmail", email))
        .first()
    : null;
  const allowlisted = Boolean(entry);
  const record = await ctx.db
    .query("userBilling")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (record) {
    if ((record.allowlisted ?? false) !== allowlisted) {
      await ctx.db.patch(record._id, { allowlisted });
    }
    return;
  }
  if (!allowlisted) return;
  const free = getPresentPlanDefinition("free");
  await ctx.db.insert("userBilling", {
    userId,
    planKey: free.key,
    planLabel: free.label,
    planSlug: free.key,
    status: "active",
    quotaSeconds: free.monthlySpeechLimitSeconds,
    ...calendarMonth(),
    allowlisted: true,
    updatedAt: Date.now(),
  });
};


const isOrganizationDocument = (
  value: unknown,
): value is {
  _id: Id<"organizations">;
  name: string;
  slug: string;
  logo?: string;
  createdAt: number;
} => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    name?: unknown;
    slug?: unknown;
    createdAt?: unknown;
  };

  return (
    typeof candidate.name === "string" &&
    typeof candidate.slug === "string" &&
    typeof candidate.createdAt === "number"
  );
};

const buildOrganizationSlug = (name: string) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

  return slug || "organization";
};

const resolveOrganization = async (
  ctx: { db: { get: (id: Id<"organizations">) => Promise<unknown> } },
  orgId: Id<"organizations">,
) => {
  const organization = await ctx.db.get(orgId);
  return isOrganizationDocument(organization) ? organization : null;
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const userId = identity.subject;
    const userProfiles = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const organizations = await Promise.all(
      userProfiles.map(async (profile) => {
        const organization = await resolveOrganization(ctx, profile.orgId);
        if (!organization) {
          return null;
        }
        
        // Handle logo: if it's already a data URL or regular URL, use it as-is
        // If it's a storageId, convert it to a URL
        let logoUrl: string | null = null;
        if (organization.logo) {
          // Check if it's already a URL (starts with http/https/data:)
          if (organization.logo.startsWith('http') || organization.logo.startsWith('data:')) {
            logoUrl = organization.logo;
          } else {
            // It's a storageId, convert it
            logoUrl = await ctx.storage.getUrl(organization.logo);
          }
        }
        
        return {
          id: organization._id,
          name: organization.name,
          type: "organization" as const,
          logo: logoUrl,
        };
      }),
    );

    const filteredOrganizations = organizations.filter(
      (organization) => organization !== null,
    );

    const billing = await billingSummary(
      ctx,
      userId,
      await entitlementsFor(ctx, userId, identityEmail(identity)),
    );

    // Pull the user's saved workspace preference (the active org selection
    // that should follow them across devices). If it doesn't exist yet, or
    // points to an organization they're no longer a member of, fall back to
    // the first available org. "personal" is always valid for any signed-in
    // user.
    const preference = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const memberOrgIds = new Set(filteredOrganizations.map((o) => o.id));
    let currentWorkspaceType: "personal" | "organization" =
      filteredOrganizations.length === 0 ? "personal" : "organization";
    let currentWorkspaceOrgId: string | null =
      filteredOrganizations[0]?.id ?? null;

    if (preference) {
      if (preference.workspaceType === "personal") {
        currentWorkspaceType = "personal";
        currentWorkspaceOrgId = null;
      } else if (
        preference.workspaceType === "organization" &&
        preference.workspaceOrgId &&
        memberOrgIds.has(preference.workspaceOrgId)
      ) {
        currentWorkspaceType = "organization";
        currentWorkspaceOrgId = preference.workspaceOrgId;
      }
    }

    return {
      user: {
        id: userId,
        name: identity.name ?? "Account",
        email: identity.email ?? "",
        billing,
      },
      organizations: filteredOrganizations,
      // Legacy field kept so older builds still pick *something*.
      currentOrgId: currentWorkspaceOrgId,
      // New: the workspace that should be active across devices.
      currentWorkspace: {
        type: currentWorkspaceType,
        orgId: currentWorkspaceOrgId,
      },
    };
  },
});

// Persist the user's active workspace selection. Called whenever the user
// switches organization (or to/from Personal) so the choice follows them to
// other devices.
export const setCurrentWorkspace = mutation({
  args: {
    workspaceType: v.union(v.literal("personal"), v.literal("organization")),
    workspaceOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }
    const userId = identity.subject;

    if (args.workspaceType === "organization") {
      if (!args.workspaceOrgId) {
        throw new ConvexError("workspaceOrgId is required for organization workspace");
      }
      // Verify the user is actually a member of this org before persisting.
      const membership = await ctx.db
        .query("userProfiles")
        .withIndex("by_user_org", (q) =>
          q.eq("userId", userId).eq("orgId", args.workspaceOrgId as Id<"organizations">),
        )
        .first();
      if (!membership) {
        throw new ConvexError("User is not a member of this organization");
      }
    }

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const patch = {
      userId,
      workspaceType: args.workspaceType,
      workspaceOrgId:
        args.workspaceType === "organization" ? args.workspaceOrgId : undefined,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { _id: existing._id };
    }
    const _id = await ctx.db.insert("userPreferences", patch);
    return { _id };
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

    const org = await resolveOrganization(ctx, userProfile.orgId);
    if (!org) {
      return null;
    }

    return {
      user: {
        _id: userId,
        name: identity.name,
        email: identity.email,
        image: identity.pictureUrl,
      },
      org,
      userProfile,
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
        const org = await resolveOrganization(ctx, profile.orgId);
        if (!org) return null;

        // Handle logo: if it's already a data URL or regular URL, use it as-is
        // If it's a storageId, convert it to a URL
        let logoUrl: string | null = null;
        if (org.logo) {
          // Check if it's already a URL (starts with http/https/data:)
          if (org.logo.startsWith('http') || org.logo.startsWith('data:')) {
            logoUrl = org.logo;
          } else {
            // It's a storageId, convert it
            logoUrl = await ctx.storage.getUrl(org.logo);
          }
        }

        return {
          id: org._id,
          name: org.name,
          slug: org.slug,
          logo: logoUrl,
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
    await recordAllowlist(ctx, userId, identityEmail(identity));

    // Check if user already has a profile
    const existingProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existingProfile) {
      let orgId = existingProfile.orgId;
      const existingOrg = await resolveOrganization(ctx, existingProfile.orgId);

      if (!existingOrg) {
        const now = Date.now();
        const orgName =
          args.orgName || identity.name || identity.email || "Untitled Organization";

        orgId = await ctx.db.insert("organizations", {
          name: orgName,
          slug: buildOrganizationSlug(orgName),
          ...(args.logo !== undefined ? { logo: args.logo } : {}),
          ...(args.orgType !== undefined ? { orgType: args.orgType } : {}),
          createdAt: now,
        });

        await ctx.db.patch(existingProfile._id, { orgId });
      }

      // Update existing org if metadata provided
      if (args.orgName !== undefined || args.logo !== undefined || args.orgType !== undefined) {
        await ctx.db.patch(orgId, {
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

      return { userId, orgId };
    }

    // Create new organization and user profile
    const now = Date.now();
    const orgName = args.orgName || identity.name || identity.email || "Untitled Organization";

    const slug = buildOrganizationSlug(orgName);

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

/**
 * Change what someone does in a workspace, or what they may change in it.
 *
 * Anyone can say what they do themselves (`userRole`). Changing anyone
 * else's, or anyone's admin access (`role`), takes an admin; and the last
 * admin cannot give theirs up, or nobody could manage the workspace again.
 */
export const updateMember = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.string(),
    userRole: v.optional(v.string()),
    role: v.optional(v.union(v.literal("admin"), v.literal("user"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }
    const profileOf = (userId: string) =>
      ctx.db
        .query("userProfiles")
        .withIndex("by_user_org", (q) => q.eq("userId", userId).eq("orgId", args.orgId))
        .first();

    const mine = await profileOf(identity.subject);
    if (!mine) {
      throw new ConvexError("You are not a member of this organization");
    }
    const isSelf = args.userId === identity.subject;
    const target = isSelf ? mine : await profileOf(args.userId);
    if (!target) {
      throw new ConvexError("User is not a member of this organization");
    }
    if ((!isSelf || args.role !== undefined) && mine.role !== "admin") {
      throw new ConvexError("Only organization admins can change someone's role or access");
    }

    const patch: { userRole?: string; role?: string } = {};
    if (args.userRole !== undefined) {
      patch.userRole = normalizeWorkspaceRole(args.userRole);
    }
    if (args.role !== undefined && args.role !== target.role) {
      if (target.role === "admin" && args.role !== "admin") {
        const admins = await ctx.db
          .query("userProfiles")
          .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
          .filter((q) => q.eq(q.field("role"), "admin"))
          .collect();
        if (admins.length <= 1) {
          throw new ConvexError("Make someone else an admin first. A workspace needs at least one.");
        }
      }
      patch.role = args.role;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(target._id, patch);
    }
    return { success: true };
  },
});
