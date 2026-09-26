import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const backend = new URL("../../../packages/backend/convex/", import.meta.url);
const source = (name) => readFileSync(new URL(name, backend), "utf8");

test("nobody joins a workspace without accepting an invitation", () => {
  const users = source("users.ts");
  // Knowing a workspace's id was enough to join it, and an admin typing an
  // email added that person without asking them.
  assert.doesNotMatch(users, /export const joinOrganizationById\b/);
  assert.doesNotMatch(users, /export const addUserToOrganization\b/);
  assert.equal(
    existsSync(new URL("../src/app/api/organizations/join/route.ts", import.meta.url)),
    false,
  );

  // The only way in inserts a profile for the invitation's own address.
  const invites = source("invites.ts");
  const inserts = [...invites.matchAll(/ctx\.db\.insert\("userProfiles"/g)];
  assert.equal(inserts.length, 1);
  const accept = invites.slice(invites.indexOf("export const accept"));
  assert.match(accept, /invitationFor\(ctx, args\.token, me\.email\)/);
});
