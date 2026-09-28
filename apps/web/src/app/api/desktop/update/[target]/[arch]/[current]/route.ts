import { fetchReleaseManifest, updateFor } from "@/lib/releases";

const TARGETS = new Set(["darwin", "windows", "linux"]);
const ARCHES = new Set(["aarch64", "x86_64", "armv7", "i686"]);

/**
 * The desktop app asking whether there is a newer version, as the Tauri
 * updater asks: `/api/desktop/update/darwin/aarch64/0.4.3`.
 *
 * A newer release built and signed for that platform is answered with where to
 * get it and its signature, which the app checks against the key it was built
 * with before installing anything. Anything else is 204 No Content, which the
 * updater reads as "you have the newest".
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ target: string; arch: string; current: string }> },
) {
  const { target, arch, current } = await context.params;
  if (!TARGETS.has(target) || !ARCHES.has(arch)) {
    return new Response(null, { status: 204 });
  }

  const update = updateFor(await fetchReleaseManifest(), `${target}-${arch}`, current);
  if (!update) {
    return new Response(null, { status: 204 });
  }
  return Response.json(update, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
