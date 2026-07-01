import assert from "node:assert/strict";
import test from "node:test";
import { resolveVerifiedOrganizationId } from "../src/renderer/shared/lib/organization-scope-policy.mjs";

const organizations = [
  { id: "personal", name: "Personal", type: "personal" },
  { id: "org-valid", name: "Church", type: "organization" },
];

test("cached organization IDs stay out of Convex queries until verified", () => {
  assert.equal(
    resolveVerifiedOrganizationId({
      desktopOrganizationId: "playback-state-id",
      hasVerifiedOrganizationScope: false,
      organizations: [
        ...organizations,
        {
          id: "playback-state-id",
          name: "Stale value",
          type: "organization",
        },
      ],
      workspaceOrganizationId: "playback-state-id",
      workspaceType: "organization",
    }),
    null,
  );
});

test("verified organization IDs are selected from the authoritative list", () => {
  assert.equal(
    resolveVerifiedOrganizationId({
      desktopOrganizationId: "org-valid",
      hasVerifiedOrganizationScope: true,
      organizations,
      workspaceOrganizationId: null,
      workspaceType: "personal",
    }),
    "org-valid",
  );
});

test("a stale selection falls back to the first verified organization", () => {
  assert.equal(
    resolveVerifiedOrganizationId({
      desktopOrganizationId: "stale-id",
      hasVerifiedOrganizationScope: true,
      organizations,
      workspaceOrganizationId: "stale-id",
      workspaceType: "organization",
    }),
    "org-valid",
  );
});
