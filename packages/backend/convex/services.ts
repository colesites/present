import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateWorkspace } from "./authUtils";

const getServiceLayoutItemKey = (item: {
  type: string;
  refId: string;
  addedAt: number;
  groupId?: string | null;
}) => [item.type, item.refId, item.addedAt, item.groupId ?? "standalone"].join(":");

export const list = query({
  args: {
    workspaceId: v.optional(v.string()),
    // Archived services are kept but out of the way. The sidebar asks for them
    // only when the operator goes looking.
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    try {
      const workspace = await validateWorkspace(ctx, args.workspaceId);
      const wanted = <T extends { archivedAt?: number; order?: number }>(
        services: T[],
      ): T[] =>
        services
          .filter((service) => args.includeArchived || !service.archivedAt)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      if (workspace.type === "personal") {
        const services = await ctx.db
          .query("personalServices")
          .withIndex("by_user", (q) => q.eq("userId", workspace.userId))
          .collect();
        return wanted(services);
      } else {
        const services = await ctx.db
          .query("services")
          .withIndex("by_org", (q) => q.eq("orgId", workspace.orgId))
          .collect();
        return wanted(services);
      }
    } catch (error) {
      // Return empty array if user is not authenticated yet
      return [];
    }
  },
});

export const get = query({
  args: { 
    workspaceId: v.optional(v.string()),
    serviceId: v.string() 
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);
    const serviceId = args.serviceId as any;

    if (workspace.type === "personal") {
      const service = (await ctx.db.get(serviceId as any)) as any;
      if (!service || service.userId !== workspace.userId) {
        throw new Error("Service not found or unauthorized");
      }
      return service;
    } else {
      const service = (await ctx.db.get(serviceId as any)) as any;
      if (!service || service.orgId !== workspace.orgId) {
        throw new Error("Service not found or unauthorized");
      }
      return service;
    }
  },
});

export const create = mutation({
  args: {
    workspaceId: v.optional(v.string()),
    name: v.string(),
    date: v.optional(v.string()),
    groups: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          order: v.number(),
        }),
      ),
    ),
    layout: v.optional(
      v.array(
        v.union(
          v.object({
            type: v.literal("group"),
            id: v.string(),
          }),
          v.object({
            type: v.literal("item"),
            key: v.string(),
          }),
        ),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);
    const now = Date.now();

    if (workspace.type === "personal") {
      const existing = await ctx.db
        .query("personalServices")
        .withIndex("by_user", (q) => q.eq("userId", workspace.userId))
        .collect();
      const maxOrder = existing.reduce((max, s) => Math.max(max, s.order ?? 0), 0);
      
      return await ctx.db.insert("personalServices", {
        userId: workspace.userId,
        name: args.name,
        date: args.date,
        order: maxOrder + 1,
        groups: args.groups ?? [],
        layout: args.layout ?? [],
        items: [],
        createdAt: now,
      });
    } else {
      const existing = await ctx.db
        .query("services")
        .withIndex("by_org", (q) => q.eq("orgId", workspace.orgId))
        .collect();
      const maxOrder = existing.reduce((max, s) => Math.max(max, s.order ?? 0), 0);

      return await ctx.db.insert("services", {
        orgId: workspace.orgId,
        name: args.name,
        date: args.date,
        order: maxOrder + 1,
        groups: args.groups ?? [],
        layout: args.layout ?? [],
        items: [],
        createdAt: now,
      });
    }
  },
});

export const addItem = mutation({
  args: {
    workspaceId: v.optional(v.string()),
    serviceId: v.string(),
    type: v.union(
      v.literal("library"),
      v.literal("media"),
      v.literal("scripture"),
      v.literal("presentation"),
      v.literal("group"),
    ),
    refId: v.string(),
    label: v.optional(v.string()),
    labelIsCustom: v.optional(v.boolean()),
    groupId: v.optional(v.union(v.string(), v.null())),
    addedAt: v.optional(v.number()),
    presentation: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);
    const serviceId = args.serviceId as any;

    const service = await ctx.db.get(serviceId);
    if (!service) throw new Error("Service not found");

    // Verify ownership
    if (workspace.type === "personal" && (service as any).userId !== workspace.userId) throw new Error("Unauthorized");
    if (workspace.type === "organization" && (service as any).orgId !== workspace.orgId) throw new Error("Unauthorized");

    const normalizedPresentation =
      args.type === "presentation" && args.presentation && typeof args.presentation === "object"
        ? {
            title:
              typeof (args.presentation as { title?: unknown }).title === "string"
                ? (args.presentation as { title: string }).title
                : args.label ?? "Presentation",
            sourceType:
              (args.presentation as { sourceType?: unknown }).sourceType === "pdf" ||
              (args.presentation as { sourceType?: unknown }).sourceType === "pptx"
                ? ((args.presentation as { sourceType: "pdf" | "pptx" }).sourceType)
                : "pptx",
          }
        : undefined;

    const newItem = {
      type: args.type,
      refId: args.refId,
      label: args.type === "group" ? (args.label ?? "Group") : args.label,
      labelIsCustom: args.labelIsCustom,
      groupId: args.groupId ?? undefined,
      presentation: args.type === "presentation" ? normalizedPresentation : undefined,
      addedAt: args.addedAt ?? Date.now(),
    };

    const currentLayout = Array.isArray((service as any).layout)
      ? [...(service as any).layout]
      : [];
    const newItemLayoutKey = getServiceLayoutItemKey(newItem);
    const layout = newItem.groupId
      ? currentLayout
      : currentLayout.some(
            (entry: any) => entry?.type === "item" && entry.key === newItemLayoutKey,
          )
        ? currentLayout
        : [
            ...currentLayout,
            { type: "item" as const, key: newItemLayoutKey },
          ];

    await ctx.db.patch(serviceId, {
      items: [...(service as any).items, newItem],
      layout,
    });
    return serviceId;
  },
});

export const removeItem = mutation({
  args: { 
    workspaceId: v.optional(v.string()),
    serviceId: v.string(), 
    itemIndex: v.number() 
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);
    const serviceId = args.serviceId as any;

    const service = await ctx.db.get(serviceId);
    if (!service) throw new Error("Service not found");

    // Verify ownership
    if (workspace.type === "personal" && (service as any).userId !== workspace.userId) throw new Error("Unauthorized");
    if (workspace.type === "organization" && (service as any).orgId !== workspace.orgId) throw new Error("Unauthorized");

    const items = [...(service as any).items];
    const [removed] = items.splice(args.itemIndex, 1);
    const removedKey = removed ? getServiceLayoutItemKey(removed) : null;
    const layout = Array.isArray((service as any).layout)
      ? (service as any).layout.filter(
          (entry: any) => !(entry?.type === "item" && entry.key === removedKey),
        )
      : undefined;
    await ctx.db.patch(serviceId, {
      items,
      ...(layout ? { layout } : {}),
    });
    return serviceId;
  },
});

export const update = mutation({
  args: {
    workspaceId: v.optional(v.string()),
    serviceId: v.string(),
    name: v.optional(v.string()),
    date: v.optional(v.string()),
    // `null` un-archives; omitted leaves the archive state alone, so an
    // ordinary rename does not quietly bring a service back into the list.
    archivedAt: v.optional(v.union(v.number(), v.null())),
    groups: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          order: v.number(),
        }),
      ),
    ),
    layout: v.optional(
      v.array(
        v.union(
          v.object({
            type: v.literal("group"),
            id: v.string(),
          }),
          v.object({
            type: v.literal("item"),
            key: v.string(),
          }),
        ),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);
    const serviceId = args.serviceId as any;

    const service = await ctx.db.get(serviceId);
    if (!service) throw new Error("Service not found");

    // Verify ownership
    if (workspace.type === "personal" && (service as any).userId !== workspace.userId) throw new Error("Unauthorized");
    if (workspace.type === "organization" && (service as any).orgId !== workspace.orgId) throw new Error("Unauthorized");

    const updates: any = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.date !== undefined) updates.date = args.date;
    if (args.groups !== undefined) updates.groups = args.groups;
    if (args.layout !== undefined) updates.layout = args.layout;
    if (args.archivedAt !== undefined) {
      updates.archivedAt = args.archivedAt ?? undefined;
    }

    await ctx.db.patch(serviceId, updates);
    return serviceId;
  },
});

export const reorderItems = mutation({
  args: {
    workspaceId: v.optional(v.string()),
    serviceId: v.string(),
    fromIndex: v.number(),
    toIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);
    const serviceId = args.serviceId as any;

    const service = await ctx.db.get(serviceId);
    if (!service) throw new Error("Service not found");

    // Verify ownership
    if (workspace.type === "personal" && (service as any).userId !== workspace.userId) throw new Error("Unauthorized");
    if (workspace.type === "organization" && (service as any).orgId !== workspace.orgId) throw new Error("Unauthorized");

    const items = [...(service as any).items];
    const [removed] = items.splice(args.fromIndex, 1);
    items.splice(args.toIndex, 0, removed);
    await ctx.db.patch(serviceId, { items });
    return serviceId;
  },
});

export const remove = mutation({
  args: { 
    workspaceId: v.optional(v.string()),
    serviceId: v.string() 
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);
    const serviceId = args.serviceId as any;

    const service = await ctx.db.get(serviceId);
    if (!service) return;

    // Verify ownership
    if (workspace.type === "personal" && (service as any).userId !== workspace.userId) throw new Error("Unauthorized");
    if (workspace.type === "organization" && (service as any).orgId !== workspace.orgId) throw new Error("Unauthorized");

    await ctx.db.delete(serviceId);
  },
});

/**
 * Archive a service, or bring it back.
 *
 * Not deletion: a church keeps last year's Carol Service and wants it out of
 * this Sunday's list, not gone. Everything in it stays.
 */
export const setArchived = mutation({
  args: {
    workspaceId: v.optional(v.string()),
    serviceIds: v.array(v.string()),
    archived: v.boolean(),
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);
    const archivedAt = args.archived ? Date.now() : undefined;

    for (const id of args.serviceIds) {
      const serviceId = id as any;
      const service = await ctx.db.get(serviceId);
      if (!service) continue;
      if (workspace.type === "personal" && (service as any).userId !== workspace.userId) continue;
      if (workspace.type === "organization" && (service as any).orgId !== workspace.orgId) continue;
      await ctx.db.patch(serviceId, { archivedAt });
    }
  },
});

/**
 * Delete several services at once.
 *
 * One at a time meant one confirmation each, which is how a tidy-up becomes
 * twenty clicks. A service that is not the operator's is skipped rather than
 * failing the whole run — the rest of the selection was still meant.
 */
export const removeMany = mutation({
  args: {
    workspaceId: v.optional(v.string()),
    serviceIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);
    let removed = 0;

    for (const id of args.serviceIds) {
      const serviceId = id as any;
      const service = await ctx.db.get(serviceId);
      if (!service) continue;
      if (workspace.type === "personal" && (service as any).userId !== workspace.userId) continue;
      if (workspace.type === "organization" && (service as any).orgId !== workspace.orgId) continue;
      await ctx.db.delete(serviceId);
      removed += 1;
    }
    return removed;
  },
});

export const reorderServices = mutation({
  args: {
    workspaceId: v.optional(v.string()),
    fromIndex: v.number(),
    toIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);
    if (args.fromIndex === args.toIndex) return;

    if (workspace.type === "personal") {
      const services = await ctx.db
        .query("personalServices")
        .withIndex("by_user", (q) => q.eq("userId", workspace.userId))
        .collect();
      const sorted = services.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      if (args.fromIndex < 0 || args.fromIndex >= sorted.length) return;
      if (args.toIndex < 0 || args.toIndex >= sorted.length) return;
      
      const [moved] = sorted.splice(args.fromIndex, 1);
      sorted.splice(args.toIndex, 0, moved);
      
      await Promise.all(
        sorted.map((service, index) => ctx.db.patch(service._id, { order: index }))
      );
    } else {
      const services = await ctx.db
        .query("services")
        .withIndex("by_org", (q) => q.eq("orgId", workspace.orgId))
        .collect();
      const sorted = services.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      if (args.fromIndex < 0 || args.fromIndex >= sorted.length) return;
      if (args.toIndex < 0 || args.toIndex >= sorted.length) return;

      const [moved] = sorted.splice(args.fromIndex, 1);
      sorted.splice(args.toIndex, 0, moved);

      await Promise.all(
        sorted.map((service, index) => ctx.db.patch(service._id, { order: index }))
      );
    }
  },
});

export const removeMediaForFolder = mutation({
  args: {
    workspaceId: v.optional(v.string()),
    folderId: v.string(),
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);

    if (workspace.type === "personal") {
      const services = await ctx.db
        .query("personalServices")
        .withIndex("by_user", (q) => q.eq("userId", workspace.userId))
        .collect();

      for (const service of services) {
        const remainingItems = service.items.filter(
          (item) =>
            !(
              item.type === "media" &&
              (item.refId.startsWith(`${args.folderId}-`) ||
                item.refId.startsWith(`${args.folderId}:`))
            )
        );
        if (remainingItems.length !== service.items.length) {
          await ctx.db.patch(service._id, { items: remainingItems });
        }
      }
    } else {
      const services = await ctx.db
        .query("services")
        .withIndex("by_org", (q) => q.eq("orgId", workspace.orgId))
        .collect();

      for (const service of services) {
        const remainingItems = service.items.filter(
          (item) =>
            !(
              item.type === "media" &&
              (item.refId.startsWith(`${args.folderId}-`) ||
                item.refId.startsWith(`${args.folderId}:`))
            )
        );
        if (remainingItems.length !== service.items.length) {
          await ctx.db.patch(service._id, { items: remainingItems });
        }
      }
    }
  },
});

/**
 * A new service with another one's running order: its groups, items and
 * layout, under a new name and date. What most weeks start from.
 */
export const duplicate = mutation({
  args: {
    workspaceId: v.optional(v.string()),
    serviceId: v.string(),
    name: v.string(),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);
    const source = (await ctx.db.get(args.serviceId as any)) as any;
    if (!source) throw new Error("Service not found");
    if (workspace.type === "personal" && source.userId !== workspace.userId) throw new Error("Unauthorized");
    if (workspace.type === "organization" && source.orgId !== workspace.orgId) throw new Error("Unauthorized");

    const table = workspace.type === "personal" ? "personalServices" : "services";
    const existing =
      workspace.type === "personal"
        ? await ctx.db
            .query("personalServices")
            .withIndex("by_user", (q) => q.eq("userId", workspace.userId))
            .collect()
        : await ctx.db
            .query("services")
            .withIndex("by_org", (q) => q.eq("orgId", workspace.orgId))
            .collect();
    const maxOrder = existing.reduce((max, s) => Math.max(max, s.order ?? 0), 0);

    return await ctx.db.insert(table as any, {
      ...(workspace.type === "personal" ? { userId: workspace.userId } : { orgId: workspace.orgId }),
      name: args.name.trim() || source.name,
      date: args.date,
      order: maxOrder + 1,
      groups: source.groups ?? [],
      layout: source.layout ?? [],
      items: source.items ?? [],
      createdAt: Date.now(),
    } as any);
  },
});
