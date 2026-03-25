import { getDesktopDownloadUrl } from "@/lib/download.server";

const FALLBACK_FILE_NAME = "Present-desktop.zip";

const getFileNameFromUrl = (source: string): string => {
  try {
    const parsed = new URL(source);
    const pathname = parsed.pathname;
    const value = pathname.split("/").filter(Boolean).pop();
    if (value) {
      return decodeURIComponent(value);
    }
  } catch {
    // Ignore parsing failures and fallback to a static file name.
  }

  return FALLBACK_FILE_NAME;
};

export async function GET() {
  const desktopDownloadUrl = getDesktopDownloadUrl();
  if (!desktopDownloadUrl) {
    return new Response("DESKTOP_DOWNLOAD_URL is not configured.", {
      status: 500,
    });
  }

  const upstream = await fetch(desktopDownloadUrl, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Download is temporarily unavailable.", { status: 502 });
  }

  const contentType =
    upstream.headers.get("content-type") ?? "application/octet-stream";
  const contentLength = upstream.headers.get("content-length");
  const fileName = getFileNameFromUrl(desktopDownloadUrl);
  const headers = new Headers();

  headers.set("Content-Type", contentType);
  headers.set("Content-Disposition", `attachment; filename=\"${fileName}\"`);
  headers.set("Cache-Control", "no-store");

  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}
