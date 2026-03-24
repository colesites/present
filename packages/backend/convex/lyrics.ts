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
        process.env.VERCEL_AI_GATEWAY_URL ?? "https://gateway.ai.vercel.com/v1",
    });

    try {
      const result = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: outputSchema,
        prompt: [
          "You are a worship lyric editor.",
          "Correct spelling, fix casing for deity references (God vs god),",
          "remove non-lyrical metadata, and keep bracketed section labels",
          "like [Verse 1] or [Chorus]. If line breaks separate verses, keep them.",
          "Normalize spacing: collapse multiple spaces into one, trim lines.",
          "Remove filler symbols like ...., --- or decorative punctuation.",
          "Only allow brackets for section labels or translations like [Yoruba].",
          "Return JSON with cleanedLyrics and optional notes.",
          `Lyrics:\n${args.lyrics}`,
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
