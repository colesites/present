import {
  getDesktopDownloadUrl,
  isDesktopDownloadPlatform,
} from "@/lib/download.server";

const FALLBACK_FILE_NAMES = {
  linux: "Present-linux.deb",
  mac: "Present-mac.zip",
  windows: "Present-windows.exe",
} as const;

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

  if (!isDesktopDownloadPlatform(platform)) {
    return new Response("Download target not found.", {
      status: 404,
    });
  }

  const desktopDownloadUrl = getDesktopDownloadUrl(platform);
  if (!desktopDownloadUrl) {
    return new Response(`${platform} download is not configured.`, {
      status: 503,
    });
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
      FALLBACK_FILE_NAMES[platform]
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
