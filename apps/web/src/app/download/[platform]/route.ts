import { fetchReleaseManifest, fileForSlug, latestRelease } from "@/lib/releases";
import {
  getDesktopDownloadFallbackFileName,
  getDesktopDownloadUrl,
  isDesktopDownloadSlug,
} from "@/lib/download.server";

const getFileNameFromUrl = (source: string, fallback: string): string => {
  try {
    const parsed = new URL(source);
    const value = parsed.pathname.split("/").filter(Boolean).pop();
    if (value) {
      return decodeURIComponent(value);
    }
  } catch {
    // Ignore parsing failures and use the platform fallback.
  }

  return fallback;
};

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
  // some earlier upload — that is how the Intel link ended up fetching a file
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

  const upstream = await fetch(desktopDownloadUrl, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Download is temporarily unavailable.", {
      status: 502,
    });
  }

  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${getFileNameFromUrl(
      desktopDownloadUrl,
      getDesktopDownloadFallbackFileName(platform)
    )}"`,
    "Content-Type":
      upstream.headers.get("content-type") ?? "application/octet-stream",
  });

  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}
