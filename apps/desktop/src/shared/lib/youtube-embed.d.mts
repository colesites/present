export declare function youtubeVideoId(value: string): string | null;
export declare function youtubePlayerUrl(
  id: string,
  options?: { start?: number; controls?: boolean },
): string;
export declare function youtubeEmbedUrl(
  value: string,
  options?: { startSeconds?: number; controls?: boolean; via?: string | null },
): string | null;
