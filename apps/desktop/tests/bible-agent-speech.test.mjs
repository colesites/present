// Ordinary speech and references, against the real Bibles: `bible-agent-eval/`.
import { measured } from "./bible-agent-eval/assert.mjs";

measured("none", ["speech-", "not-a-reference", "reference", "command"]);
// However sure the model is of a verse nobody named, real speech shows nothing.
measured("adversary", ["speech-real", "not-a-reference", "reference-spread", "command"]);
measured("answers", ["told-in-own-words", "reference-sideways", "model-sure-and-wrong"]);
