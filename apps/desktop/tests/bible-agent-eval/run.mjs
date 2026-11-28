/**
 * Run the Bible agent over `dataset.mjs` and say how it did.
 *
 *   node tests/bible-agent-eval/run.mjs [--out file.json] [--world none|answers|adversary] [--group name] [--show wrong|missed]
 *
 * Every case is run in three worlds, because the model is the one part that
 * cannot be run here:
 *
 * - `none`: no model at all — offline, or nobody signed in.
 * - `answers`: the model answers what a case says it does, and is silent on
 *   the rest.
 * - `adversary`: for every case that does not say otherwise, the model is
 *   sure, every time it is asked, of the verse elsewhere in the Bible whose
 *   words are most like what was heard. Nothing wrong may reach the screen
 *   however sure it is.
 *
 * "box n": how many cases of a group had a passage suggested in the box —
 * never on screen. Owed where a case says `box`; elsewhere, what the operator
 * is offered and passes over.
 */

import { writeFileSync } from "node:fs";

import { bible, createTab, verseSearch, withoutVersion } from "./harness.mjs";
import { cases } from "./dataset.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : null;
};

const STOP = new Set(
  "a an and are as at be but by for from had has have he her him his i in is it me my not of on or our she so that the their them then there they this to unto us was we were what when which who will with ye you your thou thy thee shall said".split(
    " ",
  ),
);

/** The verse whose words are most like what was heard, other than `not`. */
function mostAlike(code, heard, not) {
  const { index } = bible(code);
  const tally = new Map();
  const words = new Set(verseSearch.normalizeVerseSearchText(heard).split(" "));
  for (const word of words) {
    if (word.length < 3 || STOP.has(word)) continue;
    const list = index.postings.get(word);
    if (!list || list.length > 1500) continue;
    const weight = Math.log2(index.entries.length / list.length);
    for (const at of list) tally.set(at, (tally.get(at) ?? 0) + weight);
  }
  let best = null;
  let bestScore = 0;
  for (const [at, score] of tally) {
    const verse = index.entries[at].verse;
    const reference = `${verse.bookName} ${verse.chapter}:${verse.verse}`;
    if (reference === not) continue;
    if (score > bestScore) {
      best = reference;
      bestScore = score;
    }
  }
  return best;
}

const adversary = (version) => {
  let asked = 0;
  return (heard, open) => {
    asked += 1;
    const reference = mostAlike(version, heard, open);
    return reference
      ? { reference, confidence: 1, story: asked % 2 === 0, intent: "SCRIPTURE_READING" }
      : null;
  };
};

const modelFor = (world, testCase) => {
  if (world === "none") return null;
  if (testCase.model) return testCase.model;
  return world === "adversary" ? adversary(testCase.version) : () => null;
};

export async function runCase(testCase, world) {
  const tab = createTab({
    version: testCase.version,
    model: modelFor(world, testCase),
    ...(testCase.installed ? { installed: testCase.installed } : {}),
  });
  const wrong = [];
  const missed = [];
  const hoped = [];
  let expected = null;
  const everywhere = new Set(testCase.allowAnywhere ?? []);
  for (const [at, turn] of testCase.turns.entries()) {
    const before = tab.screen.length;
    await tab.say(turn.say);
    const allowed = new Set([...(turn.allow ?? []), ...everywhere]);
    if (expected) allowed.add(expected);
    if (turn.screen) allowed.add(turn.screen);
    if (turn.hope) allowed.add(turn.hope);
    for (const shown of tab.screen.slice(before).map(withoutVersion)) {
      if (!allowed.has(shown)) wrong.push({ turn: at, said: turn.say, shown });
    }
    if (turn.hope) hoped.push(tab.showing() === turn.hope || (turn.orNext !== undefined && tab.showing() === turn.orNext));
    if (turn.screenVersion !== undefined) {
      const inBible = tab.screen.at(-1)?.match(/\s([A-Z]{2,5})$/)?.[1] ?? null;
      if (inBible !== turn.screenVersion) {
        // Into a Bible nobody asked for is as wrong as a wrong verse; not
        // into the one asked for, missed.
        (turn.screenVersion === testCase.version && inBible !== null ? wrong : missed).push({
          turn: at,
          said: turn.say,
          wantedIn: turn.screenVersion,
          shownIn: inBible,
        });
      }
    }
    // A suggestion owed in the box, where the operator can show it.
    if (turn.box !== undefined && tab.box !== turn.box) {
      missed.push({ turn: at, said: turn.say, wantedInBox: turn.box, box: tab.box });
    }
    if (turn.screen !== undefined) {
      const showing = tab.showing();
      // The turn ends the verse: the verse after it, put up at its last word,
      // is as right as the verse itself.
      if (showing !== turn.screen && !(turn.orNext && showing === turn.orNext)) {
        if (showing === null || showing === expected || allowed.has(showing)) {
          missed.push({ turn: at, said: turn.say, wanted: turn.screen, showing });
        } else if (!wrong.some((entry) => entry.turn === at)) {
          wrong.push({ turn: at, said: turn.say, shown: showing, wanted: turn.screen });
        }
      }
      expected = turn.orNext && tab.showing() === turn.orNext ? turn.orNext : turn.screen;
    } else if (tab.showing() !== null) {
      expected = tab.showing();
    }
  }
  return {
    id: testCase.id,
    group: testCase.group,
    world,
    outcome: wrong.length > 0 ? "wrong" : missed.length > 0 ? "missed" : "ok",
    wrong,
    missed,
    hoped: hoped.length,
    found: hoped.filter(Boolean).length,
    suggested: tab.notes.filter((note) => note.startsWith("suggested:")).length,
    notes: tab.notes,
  };
}

export async function runAll({
  worlds = ["none", "answers", "adversary"],
  group = null,
  only = () => true,
} = {}) {
  const results = [];
  for (const world of worlds) {
    for (const testCase of cases) {
      if (group && !testCase.group.startsWith(group)) continue;
      if (!only(testCase.id)) continue;
      // A case about what the model answers says nothing without a model.
      if (testCase.needsModel && world === "none") continue;
      results.push(await runCase(testCase, world));
    }
  }
  return results;
}

export function summarize(results) {
  const table = new Map();
  for (const { group, world, outcome, hoped, found, suggested } of results) {
    const key = `${group}|${world}`;
    const row = table.get(key)
      ?? { group, world, cases: 0, ok: 0, missed: 0, wrong: 0, hoped: 0, found: 0, suggested: 0 };
    row.cases += 1;
    row[outcome] += 1;
    row.hoped += hoped;
    row.found += found;
    row.suggested += suggested ? 1 : 0;
    table.set(key, row);
  }
  return [...table.values()];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const world = option("world");
  const started = Date.now();
  const results = await runAll({ worlds: world ? [world] : undefined, group: option("group") });
  const rows = summarize(results);
  const worlds = [...new Set(rows.map((row) => row.world))];
  const groups = [...new Set(rows.map((row) => row.group))];
  const pad = (value, width) => String(value).padEnd(width);
  console.log(`${pad("", 34)}${worlds.map((name) => pad(`${name}: ok/missed/WRONG of n`, 48)).join("")}`);
  for (const group of groups) {
    const cells = worlds.map((name) => {
      const row = rows.find((candidate) => candidate.group === group && candidate.world === name);
      const found = row?.hoped ? `  found ${row.found}/${row.hoped}` : "";
      const suggested = row?.suggested ? `  box ${row.suggested}` : "";
      return pad(row ? `${row.ok}/${row.missed}/${row.wrong} of ${row.cases}${found}${suggested}` : "-", 48);
    });
    console.log(`${pad(group, 34)}${cells.join("")}`);
  }
  for (const name of worlds) {
    const inWorld = results.filter((result) => result.world === name);
    const count = (outcome) => inWorld.filter((result) => result.outcome === outcome).length;
    console.log(
      `${name}: ${inWorld.length} cases, ${count("ok")} ok, ${count("missed")} missed, ${count("wrong")} WRONG`,
    );
  }
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`);
  const show = option("show");
  if (show) {
    for (const result of results.filter((candidate) => candidate.outcome === show).slice(0, Number(option("limit") ?? 40))) {
      console.log(`\n[${result.world}] ${result.id}`);
      for (const entry of result[show]) console.log("  ", JSON.stringify(entry));
    }
  }
  const out = option("out");
  if (out) {
    writeFileSync(out, JSON.stringify({ rows, results: results.map(({ notes, ...rest }) => rest) }, null, 1));
  }
}
