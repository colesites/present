import { query } from "./_generated/server";
import { authComponent } from "./auth";

export const checkAuthState = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { error: "No identity" };

    // This is a bit tricky since these tables are in a component
    // But we can try to query them if they are registered or via some internal API
    // For now, let's just see what the root see
    const users = await ctx.db.query("users").collect();
    const organizations = await ctx.db.query("organizations").collect();
    
    return {
      identity,
      rootUsers: users.length,
      rootOrgs: organizations.length,
    };
  },
});
