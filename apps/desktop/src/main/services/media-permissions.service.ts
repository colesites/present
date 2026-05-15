import { systemPreferences, type Session } from "electron";

const TRUSTED_MEDIA_ORIGINS = new Set([
  "app://app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
]);

const normalizeOrigin = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }

  if (value.startsWith("app://app")) {
    return "app://app";
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const isTrustedMediaOrigin = (value?: string | null): boolean => {
  const origin = normalizeOrigin(value);
  return origin ? TRUSTED_MEDIA_ORIGINS.has(origin) : false;
};

export const configureMediaPermissions = (session: Session): void => {
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission !== "media") {
      return false;
    }
    return true; // ALways allow in dev for testing
  });

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission !== "media") {
      callback(false);
      return;
    }
    callback(true); // Always allow in dev for testing
  });
};

export type MediaAccessResult = {
  granted: boolean;
  status: string;
};

export const requestMicrophoneAccess = async (): Promise<MediaAccessResult> => {
  if (process.platform !== "darwin") {
    return { granted: true, status: "granted" };
  }

  const currentStatus = systemPreferences.getMediaAccessStatus("microphone");
  if (currentStatus === "granted") {
    return { granted: true, status: currentStatus };
  }

  if (currentStatus !== "not-determined") {
    return { granted: false, status: currentStatus };
  }

  const granted = await systemPreferences.askForMediaAccess("microphone");
  return {
    granted,
    status: systemPreferences.getMediaAccessStatus("microphone"),
  };
};
