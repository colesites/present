/**
 * The Bible agent in the Bible tab (`lib/heard-scripture.ts`), asking the
 * model through the Rust core with the operator's session.
 */

import { useEffect, useState } from "react";

import { noteBibleAgent, understandSpokenScripture } from "../../../renderer/tauri/scripture";
import { createHeardScripture, type HeardScriptureInput } from "../lib/heard-scripture";

type Input = Omit<HeardScriptureInput, "understand"> & { sessionToken: string | null };

const withModel = ({ sessionToken, ...rest }: Input): HeardScriptureInput => ({
  ...rest,
  note: noteBibleAgent,
  understand: sessionToken
    ? (heard, earlier, openPassage) =>
        understandSpokenScripture(sessionToken, heard, rest.books, openPassage, earlier)
    : null,
});

export function useHeardScripture(input: Input): ReturnType<typeof createHeardScripture> {
  const [heard] = useState(() => createHeardScripture(withModel(input)));
  useEffect(() => {
    heard.update(withModel(input));
  });
  return heard;
}
