// Scripture read aloud with no reference named, against the real Bibles: `bible-agent-eval/`.
import { measured } from "./bible-agent-eval/assert.mjs";

measured("none", ["quote-"], {
  least: { "quote-first-words": 140, "quote-middle-words": 105, "quote-misheard": 165 },
});
