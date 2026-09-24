import { resolveRequestAuthContext } from "@/lib/server/request-auth";

/**
 * Understanding a spoken Bible reference, for the desktop's listening agent.
 *
 * **Why this is here and not on the machine.** Speech goes straight from the
 * desktop to AssemblyAI, because AssemblyAI issues a short-lived token that is
 * safe to hand out. A model gateway has no such thing — it authenticates with
 * a key, and a key shipped inside an application is a key anybody can read out
 * of it. So the key stays here and the desktop calls this.
 *
 * The cost is one hop, twenty to fifty milliseconds, against a model call of
 * several hundred. The gain is that a leak means rotating an environment
 * variable rather than shipping a release.
 *
 * **Everything the microphone heard comes here.** AssemblyAI is a speech
 * recogniser and nothing more; the model is what decides what a sentence
 * meant. There is no quota of its own to keep: what limits voice search is
 * AssemblyAI's own, which is counted when the microphone starts, and a free
 * account that has used its hour cannot start one.
 */

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

/** Fast and cheap matters more than clever: this answers in one short object. */
const DEFAULT_MODEL = "openai/gpt-5.6-luna-fast";

/** A model that has not answered in this long will not answer usefully. */
// Measured against the gateway with this prompt: the chosen model answers in
// 3.2–3.9s, so 4s cut off roughly nothing on a good run and everything on a
// slow one. Six gives it room without letting a stale reference reach the
// screen — by then the preacher has moved on, and a late verse is worse than
// none. The desktop's own limit sits just above this one so the server is
// always the one that gives up first and can say why.
const TIMEOUT_MS = 6_000;

type Body = {
  /** What the microphone heard. One sentence. */
  heard?: string;
  /** The books the operator has installed, by name. */
  books?: string[];
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function POST(request: Request) {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    // Not an error the operator can do anything about: the desktop falls back
    // to its own parser and its suggestions.
    return json({ error: "not_configured" }, 501);
  }

  let userId: string;
  try {
    ({ userId } = await resolveRequestAuthContext(request));
  } catch {
    return json({ error: "unauthorized" }, 401);
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const heard = typeof body.heard === "string" ? body.heard.trim().slice(0, 400) : "";
  const books = Array.isArray(body.books)
    ? body.books.filter((name): name is string => typeof name === "string").slice(0, 80)
    : [];
  if (!heard || books.length === 0) {
    return json({ error: "nothing_to_read" }, 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const answer = await fetch(GATEWAY_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AI_GATEWAY_SCRIPTURE_MODEL ?? DEFAULT_MODEL,
        temperature: 0,
        max_tokens: 80,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'You turn what a preacher said into a Bible reference. Reply with JSON only: ' +
              '{"book":string,"chapter":number,"verse":number|null,"verseEnd":number|null,' +
              '"confidence":number}. Use a book name exactly as given in the list. ' +
              "confidence is 0 to 1: 1 when the reference is unmistakable, below 0.5 when " +
              "you are guessing or the sentence names no reference. Answer with nothing else.",
          },
          { role: "user", content: `Books: ${books.join(", ")}\nHeard: ${heard}` },
        ],
      }),
    });

    if (!answer.ok) {
      const detail = await answer.text().catch(() => "");
      console.error("[Scripture AI] the gateway refused", answer.status, detail.slice(0, 400));
      return json({ error: "gateway_failed" }, 502);
    }

    const payload = (await answer.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    if (!content) {
      return json({ error: "no_answer" }, 502);
    }

    // Handed back as the model wrote it. What it means is decided on the
    // desktop, against the books that are actually installed there —
    // `services/scripture_agent.rs`.
    return json({ content, userId });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    if (!aborted) {
      console.error("[Scripture AI] could not reach the gateway", error);
    }
    return json({ error: aborted ? "timed_out" : "gateway_unreachable" }, 504);
  } finally {
    clearTimeout(timer);
  }
}
