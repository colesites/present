export type DesktopDownloadPlatform = "mac" | "windows" | "linux";

export const desktopDownloadPath = "/download";

export const getDesktopPlatformDownloadPath = (
  platform: DesktopDownloadPlatform
): string => {
  return `${desktopDownloadPath}/${platform}`;
};
