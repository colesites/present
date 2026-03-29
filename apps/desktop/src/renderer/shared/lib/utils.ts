import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const decodeBase64UrlSegment = (value: string): string | null => {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padding);
    return atob(padded);
  } catch {
    return null;
  }
};

export const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const segments = token.split(".");
  if (segments.length < 2) {
    return null;
  }
  const decoded = decodeBase64UrlSegment(segments[1]);
  if (!decoded) {
    return null;
  }
  try {
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
};
