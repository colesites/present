import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateWorkspace } from "./authUtils";

export const list = query({
  args: { workspaceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);

    if (workspace.type === "personal") {
      const services = await ctx.db
        .query("personalServices")
        .withIndex("by_user", (q) => q.eq("userId", workspace.userId))
        .collect();
      return services.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    } else {
      const services = await ctx.db
        .query("services")
        .withIndex("by_org", (q) => q.eq("orgId", workspace.orgId))
        .collect();
      return services.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
    type: v.union(v.literal("library"), v.literal("media"), v.literal("scripture")),
    refId: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspace = await validateWorkspace(ctx, args.workspaceId);
    const serviceId = args.serviceId as any;

    const service = await ctx.db.get(serviceId);
    if (!service) throw new Error("Service not found");

    // Verify ownership
    if (workspace.type === "personal" && (service as any).userId !== workspace.userId) throw new Error("Unauthorized");
    if (workspace.type === "organization" && (service as any).orgId !== workspace.orgId) throw new Error("Unauthorized");

    const newItem = {
      type: args.type,
      refId: args.refId,
      label: args.label,
      addedAt: Date.now(),
    };

    await ctx.db.patch(serviceId, { items: [...(service as any).items, newItem] });
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
    items.splice(args.itemIndex, 1);
    await ctx.db.patch(serviceId, { items });
    return serviceId;
  },
});

export const update = mutation({
  args: {
    workspaceId: v.optional(v.string()),
    serviceId: v.string(),
    name: v.optional(v.string()),
    date: v.optional(v.string()),
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
          (item) => !(item.type === "media" && item.refId.startsWith(`${args.folderId}:`))
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
          (item) => !(item.type === "media" && item.refId.startsWith(`${args.folderId}:`))
        );
        if (remainingItems.length !== service.items.length) {
          await ctx.db.patch(service._id, { items: remainingItems });
        }
      }
    }
  },
});
