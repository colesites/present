import { GenericQueryCtx, GenericMutationCtx } from "convex/server";
import { ConvexError } from "convex/values";
import { Id } from "./_generated/dataModel";

export type WorkspaceContext = 
  | { type: "personal"; userId: Id<"users"> }
  | { type: "organization"; orgId: Id<"organizations">; userId: Id<"users"> };

/**
 * Validates the user's identity and ensures they have access to the requested workspace.
 * 
 * @param ctx Convex context (query or mutation)
 * @param workspaceId Optional organization ID. If provided, checks for organization membership.
 *                    If null/undefined, defaults to the user's personal workspace.
 * @returns WorkspaceContext containing the validated IDs and workspace type.
 */
export async function validateWorkspace(
  ctx: GenericQueryCtx<any> | GenericMutationCtx<any>,
  workspaceId?: string | null
): Promise<WorkspaceContext> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Unauthenticated: User identity not found.");
  }

  // Get the user from Convex Auth
  const user = await ctx.db.get(identity.subject as Id<"users">);
  if (!user) {
    throw new ConvexError("User record not found in Convex. Please complete onboarding.");
  }

  // If no workspaceId is provided, we are in personal context
  if (!workspaceId) {
    return {
      type: "personal",
      userId: user._id,
    };
  }

  // If a workspaceId is provided, verify the user has a profile for that organization
  const userProfile = await ctx.db
    .query("userProfiles")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .filter((q) => q.eq(q.field("orgId"), workspaceId as Id<"organizations">))
    .first();

  if (!userProfile) {
    throw new ConvexError("Unauthorized: You do not have access to this organization workspace.");
  }

  return {
    type: "organization",
    orgId: workspaceId as Id<"organizations">,
    userId: user._id,
  };
}
