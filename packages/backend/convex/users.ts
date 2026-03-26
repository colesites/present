import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    
    // 1. Try by token (BetterAuth ID or Clerk ID)
    let user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    // 2. If not found, try by email (migration/linking logic)
    if (!user && identity.email) {
      user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", identity.email))
        .unique();
    }
    
    return user;
  },
});

export const getCurrentWithOrg = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    // Use our linking logic
    let user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (!user && identity.email) {
      user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", identity.email))
        .unique();
    }

    if (!user) {
      return null;
    }

    const org = await ctx.db.get(user.orgId);
    return { user, org };
  },
});

export const listMyOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const members = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .collect();

    const orgs = await Promise.all(
      members.map(async (member) => {
        const org = await ctx.db.get(member.orgId);
        if (!org) return null;
        const link = await ctx.db
          .query("organizationLinks")
          .withIndex("by_org", (q) => q.eq("orgId", org._id))
          .first();


        return {
          id: org._id,
          authOrganizationId: link?.authOrganizationId ?? null,
          name: org.name,
          slug: org.slug,
          logo: org.logo ?? null,
          role: member.role,
          createdAt: org.createdAt,
        };

      })
    );

    return orgs.filter((o): o is NonNullable<typeof o> => o !== null);
  },
});


export const createForCurrent = mutation({
  args: {
    orgId: v.id("organizations"),
    role: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    // Check for existing by token
    let existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    // Migration: If not found by token, check by email
    if (!existing && identity.email) {
      existing = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", identity.email))
        .unique();
      
      // If found by email, link the new tokenIdentifier to this existing record
      if (existing) {
        await ctx.db.patch(existing._id, {
          tokenIdentifier: identity.tokenIdentifier,
          name: identity.name ?? existing.name,
        });
        return existing._id;
      }
    }

    if (existing) {
      return existing._id;
    }

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      orgId: args.orgId,
      tokenIdentifier: identity.tokenIdentifier,
      email: identity.email ?? undefined,
      name: identity.name ?? identity.givenName ?? undefined,
      role: args.role ?? "user",
      createdAt: now,
    });
    return userId;
  },
});

export const ensureCurrent = mutation({
  args: {
    orgName: v.optional(v.string()),
    logo: v.optional(v.string()),
    authOrganizationId: v.optional(v.string()),
    orgType: v.optional(v.string()),
    userRole: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    // Try by token - use first() to support multiple org associations for the same token
    let existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .first();

    // Migration logic: Link by email if token differs
    if (!existing && identity.email) {
      existing = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", identity.email))
        .first();
      
      if (existing) {
        await ctx.db.patch(existing._id, {
          tokenIdentifier: identity.tokenIdentifier,
        });
      }
    }

    if (existing) {
      // Update existing org if metadata provided
      if (args.orgName !== undefined || args.logo !== undefined || args.orgType !== undefined) {
        await ctx.db.patch(existing.orgId, {
          ...(args.orgName !== undefined ? { name: args.orgName } : {}),
          ...(args.logo !== undefined ? { logo: args.logo } : {}),
          ...(args.orgType !== undefined ? { orgType: args.orgType } : {}),
        });
      }

      // Update existing user record if functional role provided
      if (args.userRole !== undefined) {
        await ctx.db.patch(existing._id, {
          userRole: args.userRole,
        });
      }

      // Ensure link exists if authOrganizationId provided
      if (args.authOrganizationId) {
        const existingLink = await ctx.db
          .query("organizationLinks")
          .withIndex("by_auth_org", (q) => q.eq("authOrganizationId", args.authOrganizationId!))
          .first();
        
        if (!existingLink) {
          await ctx.db.insert("organizationLinks", {
            authOrganizationId: args.authOrganizationId,
            orgId: existing.orgId,
            createdAt: Date.now(),
          });
        }
      }

      return { userId: existing._id, orgId: existing.orgId };
    }

    // No existing user found, create new organization and user
    const now = Date.now();
    const orgName =
      args.orgName ??
      identity.name ??
      identity.email ??
      "Untitled Organization";
    
    const slug = orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");

    // Create new organization
    let orgId: any;
    const existingOrgBySlug = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();

    if (existingOrgBySlug) {
      orgId = existingOrgBySlug._id;
      if (args.logo || args.orgType) {
        await ctx.db.patch(orgId, { 
          ...(args.logo ? { logo: args.logo } : {}),
          ...(args.orgType ? { orgType: args.orgType } : {})
        });
      }
    } else {
      orgId = await ctx.db.insert("organizations", {
        name: orgName,
        slug,
        ...(args.logo !== undefined ? { logo: args.logo } : {}),
        ...(args.orgType !== undefined ? { orgType: args.orgType } : {}),
        createdAt: now,
      });
    }

    const userId = await ctx.db.insert("users", {
      orgId,
      tokenIdentifier: identity.tokenIdentifier,
      email: identity.email ?? undefined,
      name: identity.name ?? identity.givenName ?? undefined,
      role: "admin",
      userRole: args.userRole ?? undefined,
      createdAt: now,
    });

    if (args.authOrganizationId) {
      await ctx.db.insert("organizationLinks", {
        authOrganizationId: args.authOrganizationId,
        orgId,
        createdAt: now,
      });
    }

    return { userId, orgId };
  },
});

export const createOrganization = mutation({
  args: {
    orgName: v.string(),
    logo: v.optional(v.string()),
    authOrganizationId: v.optional(v.string()),
    orgType: v.optional(v.string()),
    userRole: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    console.log("createOrganization called by:", identity?.tokenIdentifier);
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    const now = Date.now();
    const slug = args.orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");

    // 1. Create native organization
    console.log("Creating native organization:", { name: args.orgName, slug });
    const orgId = await ctx.db.insert("organizations", {
      name: args.orgName,
      slug,
      logo: args.logo ?? undefined,
      orgType: args.orgType ?? undefined,
      createdAt: now,
    });
    console.log("Native organization created:", orgId);

    // 2. Link to BetterAuth if ID provided
    if (args.authOrganizationId) {
      console.log("Linking to BetterAuth organization:", args.authOrganizationId);
      await ctx.db.insert("organizationLinks", {
        authOrganizationId: args.authOrganizationId,
        orgId,
        createdAt: now,
      });
    }

    // 3. Create native user record for THIS organization
    console.log("Creating native user record for:", identity.email);
    const userId = await ctx.db.insert("users", {
      orgId,
      tokenIdentifier: identity.tokenIdentifier,
      email: identity.email ?? undefined,
      name: identity.name ?? identity.givenName ?? undefined,
      role: "admin",
      userRole: args.userRole ?? undefined,
      createdAt: now,
    });
    console.log("Native user record created:", userId);


    return { userId, orgId };
  },
});

export const linkAuthOrganization = mutation({
  args: {
    orgId: v.id("organizations"),
    authOrganizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    // Check if already linked
    const existingLink = await ctx.db
      .query("organizationLinks")
      .withIndex("by_auth_org", (q) => q.eq("authOrganizationId", args.authOrganizationId))
      .first();

    if (existingLink) {
      return { linked: true, existing: true };
    }

    await ctx.db.insert("organizationLinks", {
      authOrganizationId: args.authOrganizationId,
      orgId: args.orgId,
      createdAt: Date.now(),
    });

    return { linked: true, existing: false };
  },
});
