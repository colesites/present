import type { DesktopDownloadSlug } from "@/lib/download";

/**
 * What R2 publishes beside the installers.
 *
 * A public bucket serves objects but will not let a browser list one, so the
 * release job writes this file next to the uploads: the newest version, and
 * every version before it. The download page reads this and nothing else,
 * which is why a release needs no redeploy of the site. Previously every
 * download URL was an environment variable somebody had to change by hand.
 *
 * Written by `apps/desktop/scripts/publish-to-r2.mjs`; keep the two in step.
 */
export type ReleaseFile = {
  slug: DesktopDownloadSlug | "linux-appimage" | "ffmpeg-source";
  platform: "mac" | "windows" | "linux" | "source";
  name: string;
  size: number;
  url: string;
};

export type Release = {
  version: string;
  publishedAt: string;
  files: ReleaseFile[];
};

export type ReleaseManifest = {
  latest: string | null;
  versions: Release[];
};

export const EMPTY_MANIFEST: ReleaseManifest = { latest: null, versions: [] };

const manifestUrl = (): string | null => {
  const base = process.env.R2_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  return base ? `${base}/desktop/releases.json` : null;
};

const isRelease = (value: unknown): value is Release => {
  if (typeof value !== "object" || value === null) return false;
  const release = value as Partial<Release>;
  return typeof release.version === "string" && Array.isArray(release.files);
};

/**
 * Fetch the manifest, or give back an empty one.
 *
 * A download page that throws because a bucket is unreachable is worse than
 * one that says there is nothing to download yet: the rest of the page still
 * works, and the env-var downloads still resolve as a fallback.
 */
export const fetchReleaseManifest = async (): Promise<ReleaseManifest> => {
  const url = manifestUrl();
  if (!url) return EMPTY_MANIFEST;

  try {
    const response = await fetch(url, { next: { revalidate: 60 } });
    if (!response.ok) return EMPTY_MANIFEST;

    const data = (await response.json()) as Partial<ReleaseManifest>;
    const versions = Array.isArray(data.versions)
      ? data.versions.filter(isRelease)
      : [];
    return {
      latest: typeof data.latest === "string" ? data.latest : versions[0]?.version ?? null,
      versions,
    };
  } catch {
    return EMPTY_MANIFEST;
  }
};

/** The newest release, or `null` before anything has been published. */
export const latestRelease = (manifest: ReleaseManifest): Release | null =>
  manifest.versions.find((release) => release.version === manifest.latest) ??
  manifest.versions[0] ??
  null;

/** Everything except the newest, for the "previous versions" list. */
export const previousReleases = (manifest: ReleaseManifest): Release[] => {
  const latest = latestRelease(manifest);
  return manifest.versions.filter((release) => release.version !== latest?.version);
};

/** One release by its version, or `null` if it was never published. */
export const releaseForVersion = (
  manifest: ReleaseManifest,
  version: string,
): Release | null => manifest.versions.find((release) => release.version === version) ?? null;

/** What a release can be downloaded as, in the order the page offers them. */
export const RELEASE_DOWNLOADS = [
  { slug: "mac-apple-silicon", platform: "mac", label: "Apple Silicon" },
  { slug: "mac-intel", platform: "mac", label: "Intel" },
  { slug: "windows", platform: "windows", label: "Windows" },
  { slug: "linux", platform: "linux", label: "Linux .deb" },
  { slug: "linux-rpm", platform: "linux", label: "Linux .rpm" },
] as const;

export type ReleaseDownload = {
  slug: (typeof RELEASE_DOWNLOADS)[number]["slug"];
  platform: (typeof RELEASE_DOWNLOADS)[number]["platform"];
  label: string;
  /** The site's own address for it: `/download/mac-intel/0.4.1`. */
  path: string;
  /** In bytes, or `null` when the release has no such build. */
  size: number | null;
};

/**
 * A release's downloads, by what they are for rather than what the file is
 * called, each at an address on this site. Apple Silicon, Intel and Windows
 * are always listed, so a release without one says so; Linux only when it was
 * built.
 */
export const releaseDownloads = (release: Release): ReleaseDownload[] =>
  RELEASE_DOWNLOADS.flatMap(({ slug, platform, label }) => {
    const file = fileForSlug(release, slug);
    if (!file && platform === "linux") return [];
    return [
      {
        slug,
        platform,
        label,
        path: `/download/${slug}/${encodeURIComponent(release.version)}`,
        size: file ? file.size : null,
      },
    ];
  });

/** A version as the release job writes one. */
export const isReleaseVersion = (value: string): boolean => /^\d+\.\d+\.\d+$/.test(value);

/** The download for one variant of one release, if that release has it. */
export const fileForSlug = (
  release: Release | null,
  slug: string,
): ReleaseFile | null => release?.files.find((file) => file.slug === slug) ?? null;

/** A size a person can read, for a list of downloads. */
export const humanSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / 1_000_000;
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
};
