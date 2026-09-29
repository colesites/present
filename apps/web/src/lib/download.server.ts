import { fileForSlug, newestReleaseWith, type ReleaseManifest } from "@/lib/releases";
import {
  getDesktopDownloadPath,
  getDesktopPlatformDownloadPath,
  type DesktopDownloadSlug,
  type DesktopDownloadPlatform,
} from "@/lib/download";

export type DesktopDownloadVariant = {
  downloadPath: string;
  downloadUrl: string;
  envKeys: string[];
  fileName: string;
  label: string;
  note: string;
  slug: DesktopDownloadSlug;
  /** The release it is from; `null` for a download set by hand. */
  version: string | null;
};

export type DesktopDownloadTarget = {
  availability: "available" | "pending";
  description: string;
  downloadPath: string;
  downloadUrl: string;
  envKeys: string[];
  label: string;
  note: string;
  platform: DesktopDownloadPlatform;
  variants: DesktopDownloadVariant[];
  /** The release its first download is from. Each platform has its own. */
  version: string | null;
};

const DOWNLOAD_VARIANT_CONFIG: Record<
  DesktopDownloadSlug,
  {
    envKeys: string[];
    fallbackFileName: string;
    label: string;
    note: string;
  }
> = {
  mac: {
    envKeys: ["MAC_DOWNLOAD_URL", "mac_download_url"],
    fallbackFileName: "Present-mac.zip",
    label: "macOS",
    note: "Current macOS release.",
  },
  "mac-intel": {
    envKeys: ["MAC_INTEL_DOWNLOAD_URL", "mac_intel_download_url"],
    fallbackFileName: "Present-mac-intel.zip",
    label: "Intel (x64)",
    note: "For Intel-based Macs.",
  },
  "mac-apple-silicon": {
    envKeys: [
      "MAC_APPLE_SILICON_DOWNLOAD_URL",
      "mac_apple_silicon_download_url",
    ],
    fallbackFileName: "Present-mac-apple-silicon.zip",
    label: "Apple Silicon (ARM64)",
    note: "For M1, M2, M3, and newer Macs.",
  },
  linux: {
    envKeys: ["LINUX_DOWNLOAD_URL", "linux_download_url"],
    fallbackFileName: "Present-linux.deb",
    label: "Linux .deb (x64)",
    note: "Best for Ubuntu and Debian-based distributions.",
  },
  "linux-rpm": {
    envKeys: ["LINUX_RPM_DOWNLOAD_URL", "linux_rpm_download_url"],
    fallbackFileName: "Present-linux.rpm",
    label: "Linux .rpm (x64)",
    note: "For Fedora and Red Hat-based distributions.",
  },
  windows: {
    envKeys: ["WINDOWS_DOWNLOAD_URL", "windows_download_url"],
    fallbackFileName: "Present-windows-setup.exe",
    label: "Windows (x64)",
    note: "Standard Windows setup executable.",
  },
};

const DOWNLOAD_TARGET_COPY: Record<
  DesktopDownloadPlatform,
  Pick<DesktopDownloadTarget, "description" | "label" | "note">
> = {
  mac: {
    description: "Current desktop release for macOS.",
    label: "macOS",
    note: "Choose Intel or Apple Silicon.",
  },
  windows: {
    description: "Windows installer published from GitHub Actions.",
    label: "Windows",
    note: "Primary download: Squirrel installer (.exe).",
  },
  linux: {
    description: "Primary Linux package published from GitHub Actions.",
    label: "Linux",
    note: "Choose Debian or RPM if both are available.",
  },
};

const readFirstConfiguredEnvValue = (keys: string[]): string => {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return "";
};

/**
 * Where one download comes from.
 *
 * The release manifest first: it is written by the job that built the files,
 * so it is right by construction and a new release needs no redeploy. The
 * environment variables stay as a fallback for the period before the first
 * published release.
 *
 * Each download comes from the newest release that has it, not from the
 * newest release: platforms are built and published one at a time, and a
 * version out for the Mac alone left Windows and Linux with nothing to
 * download until they were built too.
 */
const buildVariant = (
  slug: DesktopDownloadSlug,
  manifest: ReleaseManifest
): DesktopDownloadVariant | null => {
  const { envKeys, fallbackFileName, label, note } =
    DOWNLOAD_VARIANT_CONFIG[slug];
  const release = newestReleaseWith(manifest, slug);
  const published = fileForSlug(release, slug);

  // Once anything is published the manifest is the whole truth about what
  // exists. A download no release carries is not offered at all, rather than
  // falling back to an environment variable pointing at some earlier upload.
  // That is how an "Intel" button ended up linking to a file that had been
  // deleted, and telling the operator the download was "temporarily
  // unavailable" when in fact it had never been built.
  const downloadUrl =
    manifest.versions.length > 0
      ? published?.url ?? ""
      : readFirstConfiguredEnvValue(envKeys);
  if (!downloadUrl) {
    return null;
  }

  return {
    downloadPath: getDesktopDownloadPath(slug),
    downloadUrl,
    envKeys,
    fileName: published?.name ?? fallbackFileName,
    label,
    note,
    slug,
    version: release?.version ?? null,
  };
};

const getPlatformVariants = (
  platform: DesktopDownloadPlatform,
  manifest: ReleaseManifest
): DesktopDownloadVariant[] => {
  if (platform === "mac") {
    const splitVariants = [
      buildVariant("mac-apple-silicon", manifest),
      buildVariant("mac-intel", manifest),
    ].filter((variant): variant is DesktopDownloadVariant => variant !== null);

    if (splitVariants.length > 0) {
      return splitVariants;
    }

    const genericVariant = buildVariant("mac", manifest);
    return genericVariant ? [genericVariant] : [];
  }

  if (platform === "linux") {
    return [buildVariant("linux", manifest), buildVariant("linux-rpm", manifest)].filter(
      (variant): variant is DesktopDownloadVariant => variant !== null
    );
  }

  const windowsVariant = buildVariant("windows", manifest);
  return windowsVariant ? [windowsVariant] : [];
};

export const isDesktopDownloadPlatform = (
  value: string
): value is DesktopDownloadPlatform => {
  return value === "mac" || value === "windows" || value === "linux";
};

export const isDesktopDownloadSlug = (
  value: string
): value is DesktopDownloadSlug => {
  return value in DOWNLOAD_VARIANT_CONFIG;
};

export const getDesktopDownloadUrl = (
  slug: DesktopDownloadSlug
): string => {
  return readFirstConfiguredEnvValue(DOWNLOAD_VARIANT_CONFIG[slug].envKeys);
};

export const getDesktopDownloadFallbackFileName = (
  slug: DesktopDownloadSlug
): string => {
  return DOWNLOAD_VARIANT_CONFIG[slug].fallbackFileName;
};

export const getDesktopDownloadTargets = (
  manifest: ReleaseManifest
): DesktopDownloadTarget[] => {
  return (["mac", "windows", "linux"] as const).map((platform) => {
    const variants = getPlatformVariants(platform, manifest);
    const primaryVariant = variants[0];

    return {
      ...DOWNLOAD_TARGET_COPY[platform],
      availability: variants.length > 0 ? "available" : "pending",
      downloadPath:
        primaryVariant?.downloadPath ?? getDesktopPlatformDownloadPath(platform),
      downloadUrl: primaryVariant?.downloadUrl ?? "",
      envKeys: variants.flatMap((variant) => variant.envKeys),
      platform,
      variants,
      version: primaryVariant?.version ?? null,
    };
  });
};

const fileNameFromUrl = (source: string, fallback: string): string => {
  try {
    const value = new URL(source).pathname.split("/").filter(Boolean).pop();
    if (value) {
      return decodeURIComponent(value);
    }
  } catch {
    // Not a URL we can read a name from; the platform's own name will do.
  }
  return fallback;
};

/**
 * Hand a published file to the browser from this site's own address.
 *
 * The file is fetched here and passed through, so the storage it lives in is
 * never the link anyone sees or shares: `/download/mac-intel`, or
 * `/download/mac-intel/0.4.1` for an earlier release.
 */
export const serveDesktopDownload = async (
  sourceUrl: string,
  slug: DesktopDownloadSlug,
): Promise<Response> => {
  const upstream = await fetch(sourceUrl, {
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
    "Content-Disposition": `attachment; filename="${fileNameFromUrl(
      sourceUrl,
      getDesktopDownloadFallbackFileName(slug),
    )}"`,
    "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
  });

  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  return new Response(upstream.body, { status: 200, headers });
};
