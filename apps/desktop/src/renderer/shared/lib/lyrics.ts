import { userMessage } from "./user-error";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "@present/backend/convex/_generated/api";

const DEFAULT_DESKTOP_CONVEX_URL = "https://wary-iguana-735.convex.cloud";
const convexUrl = process.env.CONVEX_URL ?? DEFAULT_DESKTOP_CONVEX_URL;
const convex = new ConvexHttpClient(convexUrl);

// The lyric parser and cleaner are shared with the website, so a song
// typed in either place splits into the same slides.
export { breakLyricsIntoChunks, cleanLyricsLocally, parseLyricsToSlides, stripBracketsForDisplay } from "@present/shared";
import { cleanLyricsLocally } from "@present/shared";



/**
 * Fixes lyrics. Always applies the deterministic local cleaner first,
 * then asks the Convex AI action for further improvements (rewording,
 * casing edge cases, structural breaks). If the AI is unavailable, the
 * locally-cleaned text is returned — never the raw input.
 */
export async function fixLyrics(lyrics: string): Promise<string> {
  const locallyCleaned = cleanLyricsLocally(lyrics);

  try {
    // As the signed-in user: each AI fix counts against their plan's monthly
    // allowance, and the server refuses anyone it cannot count against.
    const { ensureFreshDesktopAccessToken } = await import("../store/desktopSession");
    const token = await ensureFreshDesktopAccessToken();
    if (token) convex.setAuth(token);
    else convex.clearAuth();

    const data = await convex.action(api.lyrics.fixLyrics, {
      lyrics: locallyCleaned,
    });
    if (data.notes?.includes("failed")) {
      // Don't throw — the local clean is still valuable, surface it.
      return locallyCleaned;
    }
    return data.cleanedLyrics?.trim() || locallyCleaned;
  } catch (error) {
    // Offline or Convex down: the local clean is returned without a word, as
    // it always has been. A plan limit or a signed-out app is said, though:
    // otherwise the operator thinks the AI ran when it did not.
    if (error instanceof ConvexError) {
      const { toast } = await import("sonner");
      toast.error(userMessage(error, "The lyrics couldn't be tidied by AI just now.", "Lyrics"));
    }
    return locallyCleaned;
  }
}
