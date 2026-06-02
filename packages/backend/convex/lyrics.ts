import { action } from "./_generated/server";
import { v } from "convex/values";
import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const outputSchema = z.object({
  cleanedLyrics: z.string(),
  notes: z.string().optional(),
});

export const fixLyrics = action({
  args: { lyrics: v.string() },
  handler: async (_ctx, args) => {
    const gatewayKey = process.env.AI_GATEWAY_API_KEY;
    if (!gatewayKey) {
      return {
        cleanedLyrics: args.lyrics,
        notes: "AI_GATEWAY_API_KEY is not set",
      };
    }

    const openai = createOpenAI({
      apiKey: gatewayKey,
      baseURL:
        process.env.VERCEL_AI_GATEWAY_URL ?? "https://ai-gateway.vercel.sh/v1",
    });

    try {
      const result = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: outputSchema,
        prompt: [
          "You are a worship-lyric editor preparing text for live church",
          "presentation slides. The operator will project these lyrics on a",
          "screen, so structure matters as much as spelling.",
          "",
          "RULES:",
          "1. Correct spelling and capitalisation. Always capitalise deity",
          "   references (God, Lord, Jesus, Christ, Holy Spirit, Father, Son,",
          "   Saviour, Almighty) when used as proper nouns. Don't over-correct",
          "   incidental words like 'good' or 'lordship'.",
          "2. Keep section labels intact and on their OWN line. Recognise",
          "   [Verse 1], [Chorus], [Bridge], [Pre-Chorus], [Tag], [Intro],",
          "   [Outro], [Refrain], [Coda], [Hook], and language tags like",
          "   [Yoruba] / [Spanish]. If a label is missing where one is",
          "   obviously needed (e.g. a clearly repeating chorus), insert it.",
          "3. Re-arrange so each section's lines are grouped together with a",
          "   single blank line between sections. Drop duplicated repeats —",
          "   represent a repeat by appending a modifier label like",
          "   [Chorus: Repeat] rather than copy-pasting the whole chorus.",
          "4. Normalise punctuation and spacing: collapse multiple spaces,",
          "   trim every line, remove decorative junk (---, ===, ...., '*'",
          "   bullets, copyright lines, chord annotations like 'G/D', timing",
          "   marks like '(1:23)'). Strip artist / album metadata if present.",
          "5. Only bracketed text is section labels or translations. Strip",
          "   any other brackets and inline parenthetical chord/time hints.",
          "6. Break long lines that won't fit on a slide naturally at the",
          "   nearest punctuation or breath point. Aim for 1–2 lyrical phrases",
          "   per line.",
          "7. Preserve the original meaning and language. Don't paraphrase.",
          "",
          "Return JSON with `cleanedLyrics` (the rewritten lyrics, ready for",
          "slide breaking) and optional `notes` describing any non-trivial",
          "edits you made.",
          "",
          "Lyrics:",
          args.lyrics,
        ].join("\n"),
      });

      return result.object;
    } catch (error) {
      return {
        cleanedLyrics: args.lyrics,
        notes:
          error instanceof Error
            ? `AI Gateway request failed: ${error.message}`
            : "AI Gateway request failed.",
      };
    }
  },
});
