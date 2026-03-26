import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { tables as betterAuthTables } from "./betterAuth/schema";

export default defineSchema({
  ...betterAuthTables,

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    logo: v.optional(v.string()),
    orgType: v.optional(v.string()), // e.g. "church", "school", "business"
    createdAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_slug", ["slug"]),

  // Link Better Auth organizations (string IDs) to Convex organizations (Id<"organizations">).
  organizationLinks: defineTable({
    authOrganizationId: v.string(),
    orgId: v.id("organizations"),
    createdAt: v.number(),
  })
    .index("by_auth_org", ["authOrganizationId"])
    .index("by_org", ["orgId"]),
  users: defineTable({
    orgId: v.id("organizations"),
    tokenIdentifier: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    role: v.string(), // "admin", "user", or custom roles like "pastor"
    userRole: v.optional(v.string()), // The specific functional role like "tech-director"
    createdAt: v.number(),
  })

    .index("by_token", ["tokenIdentifier"])
    .index("by_org", ["orgId"])
    .index("by_email", ["email"]),
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

  // -------------------------
  // Personal (user-scoped) data
  // -------------------------
  personalCategories: defineTable({
    userId: v.id("users"),
    name: v.string(),
    isDefault: v.boolean(),
    order: v.number(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  personalSongs: defineTable({
    userId: v.id("users"),
    categoryId: v.optional(v.id("personalCategories")),
    title: v.string(),
    lyrics: v.string(),
    slides: v.array(
      v.object({
        text: v.string(),
        label: v.optional(v.string()),
        modifier: v.optional(v.string()),
        backgroundId: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_category", ["categoryId"]),

  personalServices: defineTable({
    userId: v.id("users"),
    name: v.string(),
    date: v.optional(v.string()),
    order: v.optional(v.number()),
    items: v.array(
      v.object({
        type: v.union(v.literal("song"), v.literal("media"), v.literal("scripture")),
        refId: v.string(),
        label: v.optional(v.string()),
        addedAt: v.number(),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_order", ["userId", "order"]),
});
