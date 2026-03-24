"use client";

import { useMutation } from "@tanstack/react-query";

interface FixLyricsResponse {
  cleanedLyrics: string;
  notes?: string;
}

async function fixLyricsApi(lyrics: string): Promise<FixLyricsResponse> {
  const res = await fetch("/api/lyrics/fix", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lyrics }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.notes || `Failed to fix lyrics (${res.status})`);
  }

  return res.json();
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
