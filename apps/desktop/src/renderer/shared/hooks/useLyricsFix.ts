"use client";

import { useMutation } from "@tanstack/react-query";
import { fixLyrics as fixLyricsAction } from "../lib/lyrics";

interface FixLyricsResponse {
  cleanedLyrics: string;
  notes?: string;
}

async function fixLyricsApi(lyrics: string): Promise<FixLyricsResponse> {
  const cleanedLyrics = await fixLyricsAction(lyrics);
  return { cleanedLyrics };
}

export function useLyricsFix() {
  const mutation = useMutation({
    mutationFn: fixLyricsApi,
    onError: (error) => {
      console.error("Lyrics fix error:", error);
    },
  });

  const fixLyrics = async (lyrics: string): Promise<string> => {
    const result = await mutation.mutateAsync(lyrics);
    if (result.notes?.includes("failed")) {
      throw new Error(result.notes);
    }
    return result.cleanedLyrics;
  };

  return {
    fixLyrics,
    isFixing: mutation.isPending,
    error: mutation.error,
  };
}
