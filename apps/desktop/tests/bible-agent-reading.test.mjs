// A verse on screen being read, and read on from, against the real Bibles: `bible-agent-eval/`.
import { measured } from "./bible-agent-eval/assert.mjs";

// In the Bible on screen, in another Bible installed, and heard badly.
measured("none", ["reading-shared", "reading-any", "reading-misheard", "reading-from-another", "reading-then"], {
  least: { "reading-misheard": 138 },
});
// From a Bible that is not installed at all (two of the five measured; `run.mjs` runs all).
measured("none", ["reading-from-a-bible-not-installed"], {
  only: (id) => / read from (?:ESV|NLT)$/.test(id),
  least: { "reading-from-a-bible-not-installed": 50 },
});
// A model sure of another verse does not take the screen from one being read.
measured("adversary", [
  "reading-shared-words",
  "reading-any-verse",
  "reading-misheard",
  "reading-from-another-bible",
  "reading-then-talking",
]);
