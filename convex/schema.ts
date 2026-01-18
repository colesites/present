import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  organizations: defineTable({
    name: v.string(),
    createdAt: v.number(),
  }).index("by_name", ["name"]),
  users: defineTable({
    orgId: v.id("organizations"),
    tokenIdentifier: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    role: v.union(v.literal("admin"), v.literal("user")),
    createdAt: v.number(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_org", ["orgId"]),
  // Categories for organizing songs (Songs, Flows, Hymns, custom)
  categories: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    isDefault: v.boolean(), // true for Songs, Flows, Hymns
    order: v.number(),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),
  songs: defineTable({
    orgId: v.id("organizations"),
    categoryId: v.optional(v.id("categories")),
    title: v.string(),
    lyrics: v.string(),
    slides: v.array(
      v.object({
        text: v.string(),
        label: v.optional(v.string()),
        modifier: v.optional(v.string()), // e.g. "x3", "2x"
        backgroundId: v.optional(v.string()),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_category", ["categoryId"]),
  // Services (folders for worship services)
  services: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    date: v.optional(v.string()),
    order: v.optional(v.number()),
    items: v.array(
      v.object({
        type: v.union(
          v.literal("song"),
          v.literal("media"),
          v.literal("scripture")
        ),
        refId: v.string(),
        label: v.optional(v.string()),
        addedAt: v.number(),
      })
    ),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_order", ["orgId", "order"]),
  // Keep playlists for backward compat
  playlists: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    itemIds: v.array(v.string()),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),
  playbackState: defineTable({
    orgId: v.id("organizations"),
    activeSlideId: v.optional(v.string()),
    activeBackgroundId: v.optional(v.string()),
    isBlackedOut: v.boolean(),
    // Font styling for output
    fontFamily: v.optional(v.string()),
    fontSize: v.optional(v.number()), // in pixels
    fontBold: v.optional(v.boolean()),
    fontItalic: v.optional(v.boolean()),
    fontUnderline: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),
});
