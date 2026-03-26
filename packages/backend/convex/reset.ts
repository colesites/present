import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const wipeAllOrganizations = mutation({
  args: {
    confirm: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (!args.confirm) {
      throw new Error("Must confirm wipe");
    }

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // 1. Delete all BetterAuth organization-related records
    const authOrgs = await ctx.db.query("organization").collect();
    for (const org of authOrgs) {
      await ctx.db.delete(org._id);
    }

    const members = await ctx.db.query("member").collect();
    for (const member of members) {
      await ctx.db.delete(member._id);
    }

    const invitations = await ctx.db.query("invitation").collect();
    for (const invitation of invitations) {
      await ctx.db.delete(invitation._id);
    }

    // 2. Delete all native organization records
    const nativeOrgs = await ctx.db.query("organizations").collect();
    for (const org of nativeOrgs) {
      await ctx.db.delete(org._id);
    }

    const links = await ctx.db.query("organizationLinks").collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }

    // 3. Delete all users associated with these organizations
    // Note: We might want to keep the "account" and "user" (auth) records
    // but the users table is specifically our organization membership table.
    const allUsers = await ctx.db.query("users").collect();
    for (const user of allUsers) {
      await ctx.db.delete(user._id);
    }

    return { 
      message: "Organization system wiped successfully", 
      deleted: {
        authOrgs: authOrgs.length,
        members: members.length,
        nativeOrgs: nativeOrgs.length,
        users: allUsers.length
      } 
    };
  },
});
