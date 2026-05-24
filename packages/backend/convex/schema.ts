import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Organization-specific user profile data
  // userId is the Clerk user ID (string)
  userProfiles: defineTable({
    userId: v.string(), // Clerk user ID
    orgId: v.id("organizations"),
    role: v.string(), // "admin", "user", or custom roles like "pastor"
    userRole: v.optional(v.string()), // The specific functional role like "tech-director"
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["orgId"])
    .index("by_user_org", ["userId", "orgId"]),

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    clerkOrgId: v.optional(v.string()), // Clerk organization ID
    logo: v.optional(v.string()),
    orgType: v.optional(v.string()), // e.g. "church", "school", "business"
    createdAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_slug", ["slug"])
    .index("by_clerk_org", ["clerkOrgId"]),

  // Per-user, cross-device workspace preference (so the active organization
  // selection follows the user from machine to machine). Without this every
  // new login defaults to "the first organization the server happened to
  // return", which hides data the user actually had on another device.
  userPreferences: defineTable({
    userId: v.string(), // Clerk user ID
    workspaceType: v.union(v.literal("personal"), v.literal("organization")),
    workspaceOrgId: v.optional(v.id("organizations")),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  userBilling: defineTable({
    userId: v.string(),
    planKey: v.string(),
    planLabel: v.string(),
    planSlug: v.optional(v.string()),
    status: v.string(),
    quotaSeconds: v.number(),
    periodStartMs: v.number(),
    periodEndMs: v.number(),
    stripeSubscriptionId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    // Deprecated Clerk fields kept temporarily for migration
    clerkSubscriptionId: v.optional(v.string()),
    clerkSubscriptionItemId: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  speechUsageSessions: defineTable({
    userId: v.string(),
    source: v.string(),
    periodKey: v.string(),
    startedAtMs: v.number(),
    endedAtMs: v.optional(v.number()),
    maxDurationSeconds: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_period", ["userId", "periodKey"]),

  // Categories for organizing library items (Songs, Flows, Hymns, custom)
  categories: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    isDefault: v.boolean(), // true for Songs, Flows, Hymns
    order: v.number(),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  libraries: defineTable({
    orgId: v.id("organizations"),
    categoryId: v.optional(v.id("categories")),
    title: v.string(),
    body: v.string(),
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
          v.literal("library"),
          v.literal("media"),
          v.literal("scripture"),
          v.literal("presentation"),
        ),
        refId: v.string(),
        label: v.optional(v.string()),
        presentation: v.optional(v.any()),
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
    userId: v.string(), // Clerk user ID
    name: v.string(),
    isDefault: v.boolean(),
    order: v.number(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  personalLibraries: defineTable({
    userId: v.string(), // Clerk user ID
    categoryId: v.optional(v.id("personalCategories")),
    title: v.string(),
    body: v.string(),
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
    userId: v.string(), // Clerk user ID
    name: v.string(),
    date: v.optional(v.string()),
    order: v.optional(v.number()),
    items: v.array(
      v.object({
        type: v.union(
          v.literal("library"),
          v.literal("media"),
          v.literal("scripture"),
          v.literal("presentation"),
        ),
        refId: v.string(),
        label: v.optional(v.string()),
        presentation: v.optional(v.any()),
        addedAt: v.number(),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_order", ["userId", "order"]),
});
