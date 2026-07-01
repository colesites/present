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

  speechQuotaAllowlist: defineTable({
    email: v.string(),
    normalizedEmail: v.string(),
    quotaSeconds: v.number(),
    reason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_normalized_email", ["normalizedEmail"]),

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
        sectionRepeat: v.optional(v.string()), // e.g. "x2" for the full section
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
    groups: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          order: v.number(),
        }),
      ),
    ),
    items: v.array(
      v.object({
        type: v.union(
          v.literal("library"),
          v.literal("media"),
          v.literal("scripture"),
          v.literal("presentation"),
          v.literal("group"),
        ),
        refId: v.string(),
        label: v.optional(v.string()),
        groupId: v.optional(v.union(v.string(), v.null())),
        presentation: v.optional(v.any()),
        addedAt: v.number(),
      })
    ),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_order", ["orgId", "order"]),

  // Operator-authored banner messages that can be sent to the audience output
  // as a top/bottom overlay. Stored per-org so the operator's draft messages
  // follow them across devices.
  messages: defineTable({
    orgId: v.id("organizations"),
    title: v.string(),
    body: v.string(), // raw template with {token} placeholders
    themeKey: v.string(), // e.g. "default", "checkered", "warning", "info"
    position: v.union(v.literal("top"), v.literal("bottom")),
    dismissMode: v.union(
      v.literal("manual"),
      v.literal("after-10s"),
      v.literal("after-30s"),
    ),
    allowWebNotifications: v.boolean(),
    // Animation mode for the banner. "static" = stationary; "marquee-left" /
    // "marquee-right" scroll the text across the screen at `speedSeconds`
    // per full pass. Optional for back-compat with v1 documents.
    animation: v.optional(
      v.union(
        v.literal("static"),
        v.literal("marquee-left"),
        v.literal("marquee-right"),
      ),
    ),
    speedSeconds: v.optional(v.number()),
    // Font-size multiplier for the banner text (1 = default). Optional for
    // back-compat with documents created before this field existed.
    fontScale: v.optional(v.number()),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_order", ["orgId", "order"]),

  // Master slides ("Macros" in some apps): one-click slide templates the
  // operator can drop on the live output. Each is essentially a saved slide
  // (color + optional body text + optional background) named for fast recall
  // during a service ("Blank Stream", "Pre-Service", "Sermon Point", etc.).
  slideMasters: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    color: v.string(), // hex like "#dc2626"
    body: v.optional(v.string()),
    // The underlying slide payload (matches LibrarySlide shape from the
    // shared types). Stored opaquely so we don't need to migrate the schema
    // every time the slide format gains a field.
    slide: v.optional(v.any()),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_order", ["orgId", "order"]),

  // Props / layer overlays — image or text overlays composited above the
  // active slide on the output window. Stored per-org so the same logo /
  // ticker is available across the operator's devices.
  props: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    kind: v.union(v.literal("image"), v.literal("text")),
    // For image props: a data URL (small) or an external URL. We don't
    // store binaries in Convex storage at this scope.
    imageUrl: v.optional(v.string()),
    // For text props: the literal text rendered on screen.
    text: v.optional(v.string()),
    // Position preset on the slide canvas.
    position: v.union(
      v.literal("top-left"),
      v.literal("top-right"),
      v.literal("bottom-left"),
      v.literal("bottom-right"),
      v.literal("center"),
      v.literal("full"),
    ),
    opacity: v.number(), // 0..1
    sizePercent: v.number(), // 0..100 of slide width
    color: v.optional(v.string()), // text color for text props
    fontSize: v.optional(v.number()), // px for text props
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_order", ["orgId", "order"]),

  // Lyric / slide theme presets — fonts, colors, alignment that can be
  // applied to a slide via the Themes modal in the editor.
  themes: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    // Opaque style payload; matches the SlideElementStyle shape so the
    // editor can apply it directly to text elements without translation.
    style: v.any(),
    backgroundColor: v.optional(v.string()),
    // Preview swatch for the Themes modal grid.
    previewColor: v.string(),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
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
        sectionRepeat: v.optional(v.string()),
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
    groups: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          order: v.number(),
        }),
      ),
    ),
    items: v.array(
      v.object({
        type: v.union(
          v.literal("library"),
          v.literal("media"),
          v.literal("scripture"),
          v.literal("presentation"),
          v.literal("group"),
        ),
        refId: v.string(),
        label: v.optional(v.string()),
        groupId: v.optional(v.union(v.string(), v.null())),
        presentation: v.optional(v.any()),
        addedAt: v.number(),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_order", ["userId", "order"]),

  personalMessages: defineTable({
    userId: v.string(),
    title: v.string(),
    body: v.string(),
    themeKey: v.string(),
    position: v.union(v.literal("top"), v.literal("bottom")),
    dismissMode: v.union(
      v.literal("manual"),
      v.literal("after-10s"),
      v.literal("after-30s"),
    ),
    allowWebNotifications: v.boolean(),
    animation: v.optional(
      v.union(
        v.literal("static"),
        v.literal("marquee-left"),
        v.literal("marquee-right"),
      ),
    ),
    speedSeconds: v.optional(v.number()),
    fontScale: v.optional(v.number()),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_order", ["userId", "order"]),
});
