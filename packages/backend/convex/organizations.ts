import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { normalizeWorkspaceRole, WORKSPACE_TYPES } from "../../shared/src/workspace-roles";

/**
 * A workspace's own details, for its Settings page.
 *
 * This file used to hold a mutation from the Clerk-organizations days that
 * made its caller an admin of any organization whose Clerk id they passed,
 * and a query that returned any organization by that id to anyone. Nothing
 * called either; both are gone.
 */

/** Longest name a workspace can have. */
const MAX_NAME_LENGTH = 80;

/** A logo is a data URL; the setup page caps the file at 1 MB. */
const MAX_LOGO_LENGTH = 1_500_000;

const profileOf = async (
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  userId: string,
) =>
  ctx.db
    .query("userProfiles")
    .withIndex("by_user_org", (q) => q.eq("userId", userId).eq("orgId", orgId))
    .first();

/** The workspace and the caller's place in it, or `null` if they are not in it. */
export const get = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const [organization, profile] = await Promise.all([
      ctx.db.get(args.orgId),
      profileOf(ctx, args.orgId, identity.subject),
    ]);
    if (!organization || !profile) return null;
    const members = await ctx.db
      .query("userProfiles")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    return {
      id: organization._id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo ?? null,
      orgType: organization.orgType ?? null,
      createdAt: organization.createdAt,
      memberCount: members.length,
      adminCount: members.filter((member) => member.role === "admin").length,
      me: {
        role: profile.role === "admin" ? ("admin" as const) : ("user" as const),
        userRole: normalizeWorkspaceRole(profile.userRole),
        joinedAt: profile.createdAt,
      },
    };
  },
});

/** Rename a workspace, or change its logo or type. Admins only. */
export const update = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.optional(v.string()),
    // `null` removes the logo.
    logo: v.optional(v.union(v.string(), v.null())),
    orgType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in first.");
    const profile = await profileOf(ctx, args.orgId, identity.subject);
    if (!profile || profile.role !== "admin") {
      throw new ConvexError("Only a workspace admin can change its settings.");
    }

    const patch: { name?: string; logo?: string | undefined; orgType?: string } = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new ConvexError("Give the workspace a name.");
      if (name.length > MAX_NAME_LENGTH) {
        throw new ConvexError(`Keep the name under ${MAX_NAME_LENGTH} characters.`);
      }
      patch.name = name;
    }
    if (args.logo !== undefined) {
      if (args.logo === null) {
        patch.logo = undefined;
      } else {
        if (!args.logo.startsWith("data:image/")) {
          throw new ConvexError("The logo has to be an image.");
        }
        if (args.logo.length > MAX_LOGO_LENGTH) {
          throw new ConvexError("That logo is too large. Use an image under 1 MB.");
        }
        patch.logo = args.logo;
      }
    }
    if (args.orgType !== undefined) {
      patch.orgType = WORKSPACE_TYPES.some((type) => type.value === args.orgType)
        ? args.orgType
        : "other";
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.orgId, patch);
    }
    return { success: true };
  },
});

/**
 * Leave a workspace. The last admin cannot, while anyone else is still in
 * it: nobody would be left to manage it.
 */
export const leave = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in first.");
    const profile = await profileOf(ctx, args.orgId, identity.subject);
    if (!profile) return { success: true };

    if (profile.role === "admin") {
      const members = await ctx.db
        .query("userProfiles")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect();
      const otherAdmins = members.filter(
        (member) => member.role === "admin" && member._id !== profile._id,
      );
      if (otherAdmins.length === 0 && members.length > 1) {
        throw new ConvexError("Make someone else an admin before you leave.");
      }
    }
    await ctx.db.delete(profile._id);

    // Their next visit opens a workspace they are still in.
    const preference = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .first();
    if (preference && preference.workspaceOrgId === args.orgId) {
      await ctx.db.patch(preference._id, {
        workspaceType: "personal",
        workspaceOrgId: undefined,
        updatedAt: Date.now(),
      });
    }
    return { success: true };
  },
});
