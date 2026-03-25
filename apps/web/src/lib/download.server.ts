const DOWNLOAD_ENV_KEY = "DESKTOP_DOWNLOAD_URL";

export const getDesktopDownloadUrl = (): string => {
  const value = process.env[DOWNLOAD_ENV_KEY]?.trim();
  return value ?? "";
};

