import { query } from "./_generated/server";

export const checkAuthState = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { error: "No identity" };

    const users = await ctx.db.query("users").collect();
    const organizations = await ctx.db.query("organizations").collect();
    
    return {
      identity,
      rootUsers: users.length,
      rootOrgs: organizations.length,
    };
  },
});
