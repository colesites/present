import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { validateWorkspace, type WorkspaceContext } from "./authUtils";
import { identityEmail, themeTierFor } from "./entitlements";
import type { PresentThemeTier } from "../../shared/src/billing";

/**
 * The themes people save. The ones Present comes with are in the desktop app
 * (`features/themes/theme-look.mjs`); these are a workspace's own, or one
 * person's outside a workspace.
 *
 * Reading them needs only membership. Saving one needs a plan with custom
 * themes (Pro and Power), and one with a gradient needs Power. The rows the
 * old Themes modal made, a `style` and a colour with no `look`, still load.
 */

const TIER_RANK: Record<PresentThemeTier, number> = { basic: 0, custom: 1, advanced: 2 };
const MAX_THEMES = 200;
const MAX_LOOK_CHARACTERS = 8_000;
const MAX_NAME_CHARACTERS = 60;

const workspaceArg = v.optional(v.union(v.string(), v.null()));

type Ctx = QueryCtx | MutationCtx;

const themesIn = (ctx: Ctx, workspace: WorkspaceContext) =>
  workspace.type === "organization"
    ? ctx.db
        .query("themes")
        .withIndex("by_org_order", (q) => q.eq("orgId", workspace.orgId))
        .collect()
    : ctx.db
        .query("themes")
        .withIndex("by_owner_order", (q) => q.eq("ownerUserId", workspace.userId))
        .collect();

const tierOf = async (ctx: Ctx, workspace: WorkspaceContext) => {
  const identity = await ctx.auth.getUserIdentity();
  return themeTierFor(ctx, workspace.type === "organization" ? workspace.orgId : null, {
    userId: workspace.userId,
    email: identityEmail(identity),
  });
};

/** What a look needs: a gradient is Power's; anything else, Pro's. */
const tierNeededFor = (look: unknown): PresentThemeTier => {
  const text = (look as { text?: { gradient?: unknown } } | null)?.text;
  return text?.gradient ? "advanced" : "custom";
};

const checkLook = (look: unknown) => {
  if (!look || typeof look !== "object" || Array.isArray(look)) {
    throw new ConvexError("That theme couldn't be read.");
  }
  if (JSON.stringify(look).length > MAX_LOOK_CHARACTERS) {
    throw new ConvexError("That theme is too large to save.");
  }
};

const requireTierFor = async (ctx: Ctx, workspace: WorkspaceContext, look: unknown) => {
  const needed = tierNeededFor(look);
  const tier = await tierOf(ctx, workspace);
  if (TIER_RANK[tier] < TIER_RANK[needed]) {
    throw new ConvexError(
      needed === "advanced"
        ? "Gradient themes come with Power."
        : "Saving your own themes comes with Pro and Power.",
    );
  }
};

const cleanName = (name: string) => name.trim().slice(0, MAX_NAME_CHARACTERS) || "Theme";

/** A theme, and the workspace the caller reaches it through. */
const themeFor = async (ctx: Ctx, themeId: Id<"themes">) => {
  const theme = await ctx.db.get(themeId);
  if (!theme) throw new ConvexError("That theme was deleted.");
  const workspace = await validateWorkspace(ctx, theme.orgId ?? null);
  if (workspace.type === "personal" && theme.ownerUserId !== workspace.userId) {
    throw new ConvexError("That theme was deleted.");
  }
  return { theme, workspace };
};

/**
 * A workspace's saved themes, in order, and the tier of themes the caller
 * can use there. `null` when they cannot see the workspace (signed out, or
 * not a member), so a cached copy is not taken for an empty list.
 */
export const list = query({
  args: { workspaceId: workspaceArg },
  handler: async (
    ctx,
    args,
  ): Promise<{ tier: PresentThemeTier; themes: Doc<"themes">[] } | null> => {
    let workspace: WorkspaceContext;
    try {
      workspace = await validateWorkspace(ctx, args.workspaceId ?? null);
    } catch {
      return null;
    }
    const [themes, tier] = await Promise.all([themesIn(ctx, workspace), tierOf(ctx, workspace)]);
    return { tier, themes: themes.sort((left, right) => left.order - right.order) };
  },
});

/** The old Themes modal's list, for app versions from before `list`. */
export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    try {
      const workspace = await validateWorkspace(ctx, args.orgId);
      return await themesIn(ctx, workspace);
    } catch {
      return [];
    }
  },
});

export const create = mutation({
  args: {
    workspaceId: workspaceArg,
    // How app versions from before `workspaceId` name the workspace.
    orgId: v.optional(v.id("organizations")),
    name: v.string(),
    look: v.optional(v.any()),
    style: v.optional(v.any()),
    backgroundColor: v.optional(v.string()),
    previewColor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId ?? args.orgId ?? null);
    if (args.look !== undefined) {
      checkLook(args.look);
      await requireTierFor(ctx, workspace, args.look);
    }
    const existing = await themesIn(ctx, workspace);
    if (existing.length >= MAX_THEMES) {
      throw new ConvexError(`A workspace can keep ${MAX_THEMES} themes. Delete one to save another.`);
    }
    const now = Date.now();
    const order = existing.reduce((max, theme) => Math.max(max, theme.order), -1) + 1;
    return ctx.db.insert("themes", {
      ...(workspace.type === "organization"
        ? { orgId: workspace.orgId }
        : { ownerUserId: workspace.userId }),
      createdBy: workspace.userId,
      name: cleanName(args.name),
      look: args.look,
      style: args.style ?? {},
      backgroundColor: args.backgroundColor,
      previewColor: args.previewColor ?? "#1f2030",
      order,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    themeId: v.id("themes"),
    name: v.optional(v.string()),
    look: v.optional(v.any()),
    style: v.optional(v.any()),
    backgroundColor: v.optional(v.string()),
    previewColor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspace } = await themeFor(ctx, args.themeId);
    const patch: Partial<Doc<"themes">> = { updatedAt: Date.now() };
    if (args.look !== undefined) {
      checkLook(args.look);
      await requireTierFor(ctx, workspace, args.look);
      patch.look = args.look;
    }
    if (args.name !== undefined) patch.name = cleanName(args.name);
    if (args.style !== undefined) patch.style = args.style;
    if (args.backgroundColor !== undefined) patch.backgroundColor = args.backgroundColor;
    if (args.previewColor !== undefined) patch.previewColor = args.previewColor;
    await ctx.db.patch(args.themeId, patch);
    return args.themeId;
  },
});

export const remove = mutation({
  args: { themeId: v.id("themes") },
  handler: async (ctx, args) => {
    await themeFor(ctx, args.themeId);
    await ctx.db.delete(args.themeId);
    return args.themeId;
  },
});

/** Put a workspace's themes in this order. Ids it doesn't hold are ignored. */
export const reorder = mutation({
  args: { workspaceId: workspaceArg, themeIds: v.array(v.id("themes")) },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId ?? null);
    const mine = new Map((await themesIn(ctx, workspace)).map((theme) => [theme._id, theme]));
    let order = 0;
    for (const themeId of args.themeIds) {
      if (!mine.has(themeId)) continue;
      await ctx.db.patch(themeId, { order: order++ });
    }
  },
});
