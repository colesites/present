// Speech, quotes and readings in the other Bibles in `apps/desktop/bible/`: `bible-agent-eval/`.
// Four of the ten here; `node tests/bible-agent-eval/run.mjs --group other-bible` runs them all.
import { measured } from "./bible-agent-eval/assert.mjs";

measured("none", ["other-bible-"], {
  only: (id) => /\/(?:ESV|NLT|GNT|MSG) /.test(id),
  least: { "other-bible-quote-first-words": 60 },
});
