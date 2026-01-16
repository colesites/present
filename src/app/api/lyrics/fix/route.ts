import { NextResponse } from "next/server";

type FixLyricsPayload = {
  lyrics: string;
};

/**
 * Extract clean lyrics from AI response, handling various formats:
 * - Plain text lyrics
 * - JSON wrapped lyrics
 * - Multiple levels of JSON nesting
 */
function extractCleanLyrics(content: string, fallback: string): string {
  let result = content.trim();

  // Try to extract from JSON up to 3 levels deep (AI sometimes double/triple wraps)
  for (let i = 0; i < 3; i++) {
    // Check if it looks like JSON
    if (!result.startsWith("{") && !result.startsWith("```")) {
      break; // It's plain text, we're done
    }

    // Remove markdown code blocks if present
    if (result.startsWith("```")) {
      result = result.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }

    // Try to parse as JSON
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) break;

      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.cleanedLyrics === "string") {
        result = parsed.cleanedLyrics;
      } else if (typeof parsed === "string") {
        result = parsed;
      } else {
        break; // Can't extract further
      }
    } catch {
      break; // Not valid JSON, use as-is
    }
  }

  // Final cleanup - ensure proper whitespace regardless of what AI returned
  result = result
    .split("\n")
    .map((line) => {
      // Remove trailing whitespace from each line
      let cleaned = line.trimEnd();
      // Collapse multiple spaces to single space
      cleaned = cleaned.replace(/  +/g, " ");
      return cleaned;
    })
    .join("\n")
    .trim(); // Remove leading/trailing empty lines

  // If we still have JSON-looking content, something went wrong - use fallback
  if (result.startsWith("{") && result.includes("cleanedLyrics")) {
    console.error("Failed to extract lyrics from JSON:", result.slice(0, 100));
    return fallback;
  }

  return result || fallback;
}

export async function POST(request: Request) {
  const body = (await request.json()) as FixLyricsPayload;
  if (!body?.lyrics?.trim()) {
    return NextResponse.json(
      { cleanedLyrics: "", notes: "No lyrics provided." },
      { status: 400 }
    );
  }

  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        cleanedLyrics: body.lyrics,
        notes: "AI_GATEWAY_API_KEY is not set in .env.local",
      },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      "https://ai-gateway.vercel.sh/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: [
                "You are a worship lyric editor. Follow these STRICT rules EXACTLY:",
                "",
                "=== CAPITALIZATION - ANALYZE FULL CONTEXT ===",
                "Read the ENTIRE verse/section to understand WHO is being addressed:",
                "- If the verse is about/to GOD → capitalize: You, Your, He, Him, His, Yours",
                "- If addressing HUMANS → lowercase: you, your, he, him, his",
                "",
                "EXAMPLE - This verse is clearly about God:",
                "'You do mighty things / You do glorious things / You're a faithful God / Awesome is Your name'",
                "→ ALL 'You/Your' are capitalized because the whole verse addresses God",
                "",
                "EXAMPLE - This addresses humans:",
                "'He'll never walk out on you / No never, no never'",
                "→ 'you' is lowercase because it's telling humans about God's faithfulness TO THEM",
                "",
                "Deity names ALWAYS capitalize: God, Lord, Jesus, Christ, Father, Holy Spirit",
                "",
                "=== REPETITION MARKERS [x3] - CRITICAL ===",
                "When a line has (3x), (x3), (2x), etc.:",
                "1. Convert to [x3], [x2] format at END of line",
                "2. That line with [xN] becomes its OWN separate block",
                "3. Add EMPTY LINE after lines with [xN] to separate from next content",
                "",
                "EXAMPLE INPUT:",
                "'I am blessed (3x)",
                "I don't deserve it but yet",
                "I am blessed'",
                "",
                "CORRECT OUTPUT:",
                "'I am blessed [x3]",
                "",
                "I don't deserve it but yet",
                "I am blessed'",
                "",
                "The [x3] line is SEPARATED because it's meant to be shown alone and repeated.",
                "",
                "=== SECTION LABELS ===",
                "- Convert (Verse), *Verse*, **Praise** → [Verse], [Praise]",
                "- Add empty line after section labels",
                "",
                "=== WHITESPACE - STRICT CLEANUP ===",
                "- Multiple spaces between words → single space",
                "- Trailing spaces at end of lines → REMOVE completely",
                "- Empty lines must be COMPLETELY empty (no spaces)",
                "- End of lyrics: NO trailing whitespace, NO trailing empty lines",
                "- Remove: ...., ---, ~~~, ===, ***, numbered prefixes (1., 2., 3.)",
                "",
                "=== PRESERVE CONTENT ===",
                "- Output EVERY line, keep ALL repetitions",
                "- Return plain text only",
              ].join("\n"),
            },
            {
              role: "user",
              content: `Clean these worship lyrics following ALL rules strictly:\n\n${body.lyrics}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 16000, // Large limit to ensure full lyrics are returned
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      return NextResponse.json(
        {
          cleanedLyrics: body.lyrics,
          notes: `AI Gateway error (${response.status}): ${errorText.slice(0, 200)}`,
        },
        { status: 502 }
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
    };

    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason;

    // Log for debugging
    console.log("AI Response - finish_reason:", finishReason);
    console.log("AI Response - content length:", content?.length ?? 0);
    console.log("Input lyrics length:", body.lyrics.length);

    if (!content) {
      return NextResponse.json(
        {
          cleanedLyrics: body.lyrics,
          notes: "AI Gateway returned no content.",
        },
        { status: 502 }
      );
    }

    // If truncated due to length, return original lyrics with warning
    if (finishReason === "length") {
      console.warn("AI response was truncated due to max_tokens limit");
      const cleanedLyrics = extractCleanLyrics(content, body.lyrics);
      return NextResponse.json({
        cleanedLyrics,
        notes: "Response may be incomplete - lyrics were very long",
      });
    }

    // If content filter triggered, return original lyrics
    if (
      finishReason === "content-filter" ||
      finishReason === "content_filter"
    ) {
      console.warn(
        "AI content filter was triggered - returning original lyrics"
      );
      // Return original lyrics since the AI couldn't complete properly
      return NextResponse.json({
        cleanedLyrics: body.lyrics,
        notes: "Content filter triggered - lyrics returned unchanged",
      });
    }

    // Extract clean lyrics, handling any JSON wrapping the AI might add
    const cleanedLyrics = extractCleanLyrics(content, body.lyrics);

    console.log("Cleaned lyrics length:", cleanedLyrics.length);

    return NextResponse.json({ cleanedLyrics });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.cause
          ? `${error.message}: ${String(error.cause)}`
          : error.message
        : "Request failed.";
    console.error("Lyrics fix error:", error);
    return NextResponse.json(
      {
        cleanedLyrics: body.lyrics,
        notes: `Request failed: ${message}`,
      },
      { status: 502 }
    );
  }
}
