/**
 * The measured cases as tests (`dataset.mjs`, `run.mjs`): a group of them run
 * in one of the three worlds, and held to what the agent does today.
 *
 * Nothing wrong on the screen is the rule, in every group but the ones named
 * in `KNOWN`, each of which says why. A change that puts a wrong verse up
 * fails here with what was said and what went up.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { runAll, summarize } from "./run.mjs";

/**
 * Cases that still go wrong, by id and world, and why — so that they are
 * known, and so that one more is noticed.
 */
export const KNOWN = {};

const describeWrong = (results) =>
  results
    .filter((result) => result.outcome === "wrong")
    .map(
      (result) =>
        `${result.id}: ${result.wrong.map((each) => `"${each.said}" showed ${each.shown}`).join("; ")}`,
    )
    .join("\n");

/**
 * `groups`: group names, or their beginnings. `least`: for groups whose
 * target is hoped for and not owed, the fewest that must be found. `only`:
 * which cases of them to run, by id, where all of them would take minutes
 * (`run.mjs` runs them all).
 */
export function measured(world, groups, { least = {}, missed = 0, only = () => true } = {}) {
  for (const group of groups) {
    test(`${group} (${world === "none" ? "no model" : world === "answers" ? "the model answering" : "the model sure and wrong"})`, async () => {
      const results = (await runAll({ worlds: [world], group, only })).filter(
        (result) => !(result.id in KNOWN),
      );
      assert.ok(results.length > 0, "there are cases to run");
      assert.equal(describeWrong(results), "", "nothing wrong reached the screen");
      const notShown = results.filter((result) => result.outcome === "missed");
      assert.ok(
        notShown.length <= missed,
        `passages named or read that did not go up: ${notShown.map((result) => result.id).join(", ")}`,
      );
      for (const row of summarize(results)) {
        const floor = least[row.group];
        if (floor !== undefined) {
          assert.ok(row.found >= floor, `${row.group}: found ${row.found} of ${row.hoped}, at least ${floor} before`);
        }
      }
    });
  }
}
