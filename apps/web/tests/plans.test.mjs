import assert from "node:assert/strict";
import test from "node:test";

const {
  betterPlan,
  effectivePlanKey,
  getPresentPlanDefinition,
  resolvePresentPlanKey,
} = await import("../../../packages/shared/src/billing.ts");

test("every Stripe price and product name finds its plan", () => {
  for (const [hint, plan] of [
    // The lookup keys the Stripe prices carry now, and the ones before.
    ["present_free_plan", "free"],
    ["present_pro_plan", "pro"],
    ["present_pro_plan_yr", "pro"],
    ["present_power_plan", "power"],
    ["present_power_plan_yr", "power"],
    ["free_plan", "free"],
    ["pro_plan_yr", "pro"],
    ["power_plan", "power"],
    // The product's `plan` metadata, and its name.
    ["free", "free"],
    ["pro", "pro"],
    ["power", "power"],
    ["Present Pro", "pro"],
    ["Power", "power"],
  ]) {
    assert.equal(resolvePresentPlanKey(hint), plan, hint);
  }
  assert.equal(resolvePresentPlanKey(null), "free");
  assert.equal(resolvePresentPlanKey("something else"), "free");
});

test("the plans hold what their Stripe feature lists promise", () => {
  const hours = (plan) => getPresentPlanDefinition(plan).monthlySpeechLimitSeconds / 3600;
  const gigabytes = (plan) => getPresentPlanDefinition(plan).cloudStorageBytes / 1024 ** 3;

  assert.equal(hours("free"), 0.5, "30 minutes of AI projection");
  assert.equal(hours("pro"), 4);
  assert.equal(hours("power"), 100);

  assert.deepEqual(
    ["free", "pro", "power"].map((plan) => getPresentPlanDefinition(plan).workspaceMembers),
    [2, 5, 20],
  );
  assert.deepEqual(
    ["free", "pro", "power"].map((plan) => getPresentPlanDefinition(plan).monthlyLyricsFixes),
    [5, 100, null],
    "Power's lyrics fixes are unlimited",
  );
  assert.equal(Math.round(gigabytes("free") * 1024), 500, "500 MB");
  assert.equal(gigabytes("pro"), 2);
  assert.equal(gigabytes("power"), 100);

  assert.equal(getPresentPlanDefinition("free").songAiProjection, false, "Free: Bible only");
  assert.equal(getPresentPlanDefinition("pro").songAiProjection, true);
  assert.equal(getPresentPlanDefinition("power").songAiProjection, true);
});

test("a subscription that is not being paid for gives Free", () => {
  for (const status of ["active", "trialing", "past_due"]) {
    assert.equal(effectivePlanKey("pro", status), "pro", status);
  }
  for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused", "", null]) {
    assert.equal(effectivePlanKey("power", status), "free", String(status));
  }
});

test("the better of two plans is the higher one", () => {
  assert.equal(betterPlan("free", "power"), "power");
  assert.equal(betterPlan("power", "pro"), "power");
  assert.equal(betterPlan("pro", "free"), "pro");
});
