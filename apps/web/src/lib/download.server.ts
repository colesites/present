import {
  getDesktopPlatformDownloadPath,
  type DesktopDownloadPlatform,
} from "@/lib/download";

export type DesktopDownloadTarget = {
  availability: "available" | "pending";
  description: string;
  downloadPath: string;
  downloadUrl: string;
  envKeys: string[];
  label: string;
  note: string;
  platform: DesktopDownloadPlatform;
};

const DOWNLOAD_ENV_KEYS: Record<DesktopDownloadPlatform, string[]> = {
  mac: ["MAC_DOWNLOAD_URL", "mac_download_url"],
  windows: ["WINDOWS_DOWNLOAD_URL", "windows_download_url"],
  linux: ["LINUX_DOWNLOAD_URL", "linux_download_url"],
};

const DOWNLOAD_TARGET_COPY: Record<
  DesktopDownloadPlatform,
  Pick<DesktopDownloadTarget, "description" | "label" | "note">
> = {
  mac: {
    description: "Current desktop release for macOS.",
    label: "macOS",
    note: "Already live in your current Cloudflare storage flow.",
  },
  windows: {
    description: "Windows installer built from GitHub Actions.",
    label: "Windows",
    note: "Expected artifact: Squirrel installer (.exe).",
  },
  linux: {
    description: "Primary Linux package for desktop installs.",
    label: "Linux",
    note: "Expected artifact: Debian package (.deb).",
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

export const isDesktopDownloadPlatform = (
  value: string
): value is DesktopDownloadPlatform => {
  return value === "mac" || value === "windows" || value === "linux";
};

export const getDesktopDownloadUrl = (
  platform: DesktopDownloadPlatform
): string => {
  return readFirstConfiguredEnvValue(DOWNLOAD_ENV_KEYS[platform]);
};

export const getDesktopDownloadTargets = (): DesktopDownloadTarget[] => {
  return (["mac", "windows", "linux"] as const).map((platform) => {
    const downloadUrl = getDesktopDownloadUrl(platform);
    return {
      ...DOWNLOAD_TARGET_COPY[platform],
      availability: downloadUrl ? "available" : "pending",
      downloadPath: getDesktopPlatformDownloadPath(platform),
      downloadUrl,
      envKeys: DOWNLOAD_ENV_KEYS[platform],
      platform,
    };
  });
};
