import { mutation } from "./_generated/server";
import { v } from "convex/values";

// This file is for development/testing only
// It wipes organization data but NOT Convex Auth tables

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

    // Delete all native organization records
    const nativeOrgs = await ctx.db.query("organizations").collect();
    for (const org of nativeOrgs) {
      await ctx.db.delete(org._id);
    }

    // Delete all users associated with these organizations
    const allUsers = await ctx.db.query("users").collect();
    for (const user of allUsers) {
      await ctx.db.delete(user._id);
    }

    return { 
      message: "Organization system wiped successfully", 
      deleted: {
        nativeOrgs: nativeOrgs.length,
        users: allUsers.length
      } 
    };
  },
});
