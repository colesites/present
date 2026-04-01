export type DesktopDownloadPlatform = "mac" | "windows" | "linux";
export type DesktopDownloadSlug =
  | DesktopDownloadPlatform
  | "mac-intel"
  | "mac-apple-silicon"
  | "linux-rpm";

export const desktopDownloadPath = "/download";

export const getDesktopDownloadPath = (
  slug: DesktopDownloadSlug
): string => {
  return `${desktopDownloadPath}/${slug}`;
};

export const getDesktopPlatformDownloadPath = (
  platform: DesktopDownloadPlatform
): string => {
  return getDesktopDownloadPath(platform);
};
