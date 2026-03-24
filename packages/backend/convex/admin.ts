import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { components } from "./_generated/api";

const firstPage: { numItems: number; cursor: string | null } = {
  numItems: 100,
  cursor: null,
};

export const listBetterAuthOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const result = await ctx.runQuery(components.auth.adapter.findMany, {
      model: "organization",
      paginationOpts: firstPage as any,
    });

    return result.page.map((organization: any) => ({
      id: String(organization._id),
      name: String(organization.name),
      slug: String(organization.slug),
      logo: typeof organization.logo === "string" ? organization.logo : null,
    }));
  },
});

export const deleteBetterAuthOrganization = mutation({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const organizations = await ctx.runQuery(components.auth.adapter.findMany, {
      model: "organization",
      where: [{ field: "slug", operator: "eq", value: args.slug }],
      paginationOpts: firstPage as any,
    });

    const organization = organizations.page[0] as any;
    if (!organization) {
      throw new Error(`Better Auth organization not found for slug: ${args.slug}`);
    }

    const organizationId = String(organization._id);

    await ctx.runMutation(components.auth.adapter.deleteMany, {
      input: {
      model: "invitation",
      where: [{ field: "organizationId", operator: "eq", value: organizationId }],
      },
      paginationOpts: firstPage as any,
    });

    await ctx.runMutation(components.auth.adapter.deleteMany, {
      input: {
      model: "member",
      where: [{ field: "organizationId", operator: "eq", value: organizationId }],
      },
      paginationOpts: firstPage as any,
    });

    await ctx.runMutation(components.auth.adapter.updateMany, {
      input: {
      model: "session",
      where: [{ field: "activeOrganizationId", operator: "eq", value: organizationId }],
      update: { activeOrganizationId: null },
      },
      paginationOpts: firstPage as any,
    });

    await ctx.runMutation(components.auth.adapter.deleteMany, {
      input: {
      model: "organization",
      where: [{ field: "slug", operator: "eq", value: args.slug }],
      },
      paginationOpts: firstPage as any,
    });

    return {
      deletedSlug: args.slug,
      deletedOrganizationId: organizationId,
    };
  },
});
