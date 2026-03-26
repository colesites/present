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
  const userId = await ctx.auth.getUserIdentity();
  if (!userId) {
    throw new ConvexError("Unauthenticated: User identity not found.");
  }

  // Find the user record in Convex using the userId from Convex Auth
  const user = await ctx.db
    .query("users")
    .filter((q) => q.eq(q.field("_id"), userId.subject as Id<"users">))
    .first();

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

  // If a workspaceId is provided, verify it's a valid organization ID and the user belongs to it
  if (user.orgId !== workspaceId) {
    throw new ConvexError("Unauthorized: You do not have access to this organization workspace.");
  }

  return {
    type: "organization",
    orgId: workspaceId as Id<"organizations">,
    userId: user._id,
  };
}
