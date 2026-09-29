import { fetchReleaseManifest, fileForSlug, newestReleaseWith } from "@/lib/releases";
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

  // The newest release that has this download: platforms are published one
  // at a time, so a version out for the Mac alone still leaves Windows the
  // release before it. Once anything is published the manifest is the whole
  // truth about what exists: a slug no release carries is missing, not served
  // from an environment variable pointing at some earlier upload. That is how
  // the Intel link ended up fetching a file that had been deleted and
  // reporting it as "temporarily unavailable" when it had never been built.
  const manifest = await fetchReleaseManifest();
  const published = manifest.versions.length > 0;
  const release = newestReleaseWith(manifest, platform);
  const desktopDownloadUrl = published
    ? fileForSlug(release, platform)?.url ?? ""
    : getDesktopDownloadUrl(platform);
  if (!desktopDownloadUrl) {
    return new Response(
      published
        ? `${platform} is not part of any release yet.`
        : `${platform} download is not configured.`,
      { status: 404 },
    );
  }

  return serveDesktopDownload(desktopDownloadUrl, platform);
}
