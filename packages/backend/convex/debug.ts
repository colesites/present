import { query } from "./_generated/server";

export const checkAuthState = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    
    return {
      isAuthenticated: !!identity,
      identity: identity ? {
        subject: identity.subject,
        email: identity.email,
        name: identity.name,
      } : null,
      timestamp: Date.now(),
    };
  },
});
