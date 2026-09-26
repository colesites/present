import { fetchReleaseManifest, fileForSlug, latestRelease } from "@/lib/releases";
import {
  getDesktopDownloadUrl,
  isDesktopDownloadSlug,
  serveDesktopDownload,
} from "@/lib/download.server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ platform: string }> }
) {
  const { platform } = await context.params;

  if (!isDesktopDownloadSlug(platform)) {
    return new Response("Download target not found.", {
      status: 404,
    });
  }

  // A published release is the whole truth about what exists. A slug it does
  // not carry is missing, not served from an environment variable pointing at
  // some earlier upload. That is how the Intel link ended up fetching a file
  // that had been deleted and reporting it as "temporarily unavailable" when
  // in fact it had never been built.
  const manifest = await fetchReleaseManifest();
  const release = latestRelease(manifest);
  const desktopDownloadUrl = release
    ? fileForSlug(release, platform)?.url ?? ""
    : getDesktopDownloadUrl(platform);
  if (!desktopDownloadUrl) {
    return new Response(
      release
        ? `${platform} is not part of the ${release.version} release.`
        : `${platform} download is not configured.`,
      { status: 404 },
    );
  }

  return serveDesktopDownload(desktopDownloadUrl, platform);
}
