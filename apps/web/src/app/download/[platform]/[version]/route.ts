import {
  fetchReleaseManifest,
  fileForSlug,
  isReleaseVersion,
  releaseForVersion,
} from "@/lib/releases";
import { isDesktopDownloadSlug, serveDesktopDownload } from "@/lib/download.server";

/**
 * An earlier release, by platform and version: `/download/mac-intel/0.4.1`.
 *
 * The previous-versions list links here rather than to the file itself, so
 * where the installers are stored stays this site's business, as it does for
 * the current release at `/download/mac-intel`.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ platform: string; version: string }> },
) {
  const { platform, version } = await context.params;

  if (!isDesktopDownloadSlug(platform) || !isReleaseVersion(version)) {
    return new Response("Download target not found.", { status: 404 });
  }

  const release = releaseForVersion(await fetchReleaseManifest(), version);
  if (!release) {
    return new Response(`There is no ${version} release.`, { status: 404 });
  }

  const file = fileForSlug(release, platform);
  if (!file) {
    return new Response(`${platform} is not part of the ${version} release.`, {
      status: 404,
    });
  }

  return serveDesktopDownload(file.url, platform);
}
