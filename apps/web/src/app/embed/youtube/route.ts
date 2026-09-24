import { youtubeEmbedPage } from "@/lib/youtube-embed";

// The desktop app's YouTube props are framed through this page, so YouTube
// sees an https referrer rather than none (`lib/youtube-embed.ts`).
export function GET(request: Request) {
  const page = youtubeEmbedPage(new URL(request.url));
  return new Response(page.body, { status: page.status, headers: page.headers });
}
