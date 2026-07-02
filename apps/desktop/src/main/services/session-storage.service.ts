import fs from "fs/promises";
import path from "path";
import { app, safeStorage } from "electron";

const STORAGE_VERSION = 1;
const SESSION_FILE_NAME = "desktop-auth-session.v1.json";
const DEV_SESSION_FILE_NAME = "desktop-auth-session.dev.v1.json";

export type DesktopStoredUser = {
  email: string;
  id: string;
  name: string;
};

export type DesktopStoredOrganization = {
  id: string;
  logo?: string;
  name: string;
  type: "organization" | "personal";
};

export type DesktopStoredSession = {
  orgId: string | null;
  organizations: DesktopStoredOrganization[];
  savedAtMs: number;
  sessionExpiresAtMs: number | null;
  sessionToken: string;
  token: string | null;
  tokenExpiresAtMs: number | null;
  user: DesktopStoredUser | null;
};

type StoredSessionEnvelope = {
  data: string;
  encrypted: boolean;
  version: number;
};

const getSessionFilePath = (): string => {
  const fileName = app.isPackaged ? SESSION_FILE_NAME : DEV_SESSION_FILE_NAME;
  return path.join(app.getPath("userData"), fileName);
};

const encodeSessionPayload = (payload: DesktopStoredSession): StoredSessionEnvelope => {
  const serialized = JSON.stringify(payload);
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(serialized).toString("base64");
    return {
      data: encrypted,
      encrypted: true,
      version: STORAGE_VERSION,
    };
  }

  // Fallback for Linux hosts where safeStorage can be unavailable at runtime.
  return {
    data: Buffer.from(serialized, "utf8").toString("base64"),
    encrypted: false,
    version: STORAGE_VERSION,
  };
};

const decodeSessionEnvelope = (envelope: StoredSessionEnvelope): string | null => {
  if (envelope.encrypted) {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn(
        "[Desktop Auth] encrypted session storage cannot be decrypted on this host."
      );
      return null;
    }
    try {
      const encryptedBuffer = Buffer.from(envelope.data, "base64");
      return safeStorage.decryptString(encryptedBuffer);
    } catch (error) {
      console.error("[Desktop Auth] failed to decrypt session payload", error);
      return null;
    }
  }

  try {
    return Buffer.from(envelope.data, "base64").toString("utf8");
  } catch {
    return null;
  }
};

const isDesktopStoredUser = (value: unknown): value is DesktopStoredUser => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<DesktopStoredUser>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.email === "string"
  );
};

const isDesktopStoredOrganization = (
  value: unknown
): value is DesktopStoredOrganization => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<DesktopStoredOrganization>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    (candidate.type === "personal" || candidate.type === "organization") &&
    (typeof candidate.logo === "undefined" || typeof candidate.logo === "string")
  );
};

const normalizeStoredSession = (value: unknown): DesktopStoredSession | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<DesktopStoredSession>;
  if (typeof candidate.sessionToken !== "string" || candidate.sessionToken.length === 0) {
    return null;
  }

  const organizations = Array.isArray(candidate.organizations)
    ? candidate.organizations.filter(isDesktopStoredOrganization)
    : [];
  const user = isDesktopStoredUser(candidate.user) ? candidate.user : null;
  const orgId =
    typeof candidate.orgId === "string" &&
    organizations.some(
      (organization) =>
        organization.type === "organization" && organization.id === candidate.orgId,
    )
      ? candidate.orgId
      : null;
  const token = typeof candidate.token === "string" ? candidate.token : null;
  const sessionExpiresAtMs =
    typeof candidate.sessionExpiresAtMs === "number" &&
    Number.isFinite(candidate.sessionExpiresAtMs)
      ? candidate.sessionExpiresAtMs
      : null;
  const tokenExpiresAtMs =
    typeof candidate.tokenExpiresAtMs === "number" &&
    Number.isFinite(candidate.tokenExpiresAtMs)
      ? candidate.tokenExpiresAtMs
      : null;
  const savedAtMs =
    typeof candidate.savedAtMs === "number" && Number.isFinite(candidate.savedAtMs)
      ? candidate.savedAtMs
      : Date.now();

  return {
    orgId,
    organizations,
    savedAtMs,
    sessionExpiresAtMs,
    sessionToken: candidate.sessionToken,
    token,
    tokenExpiresAtMs,
    user,
  };
};

export const loadStoredDesktopSession = async (): Promise<DesktopStoredSession | null> => {
  const filePath = getSessionFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const envelope = JSON.parse(raw) as StoredSessionEnvelope;
    if (
      !envelope ||
      typeof envelope !== "object" ||
      typeof envelope.data !== "string" ||
      typeof envelope.encrypted !== "boolean" ||
      envelope.version !== STORAGE_VERSION
    ) {
      return null;
    }
    const serializedPayload = decodeSessionEnvelope(envelope);
    if (!serializedPayload) {
      return null;
    }
    const parsedPayload = JSON.parse(serializedPayload) as unknown;
    return normalizeStoredSession(parsedPayload);
  } catch {
    return null;
  }
};

export const saveStoredDesktopSession = async (
  payload: DesktopStoredSession
): Promise<boolean> => {
  const normalized = normalizeStoredSession(payload);
  if (!normalized) {
    return false;
  }

  const filePath = getSessionFilePath();
  const envelope = encodeSessionPayload(normalized);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(envelope), {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  } catch (error) {
    console.error("[Desktop Auth] failed to persist desktop session", error);
    return false;
  }
};

export const clearStoredDesktopSession = async (): Promise<boolean> => {
  const filePath = getSessionFilePath();
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    console.error("[Desktop Auth] failed to clear stored desktop session", error);
    return false;
  }
};
