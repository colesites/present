/** How the dashboard writes dates and durations. */

import { isUnlimitedSpeechQuota } from "../../../../../../packages/shared/src/billing";

/** "2 hr 30 min", "45 min", "Unlimited". */
export const formatDuration = (seconds: number): string => {
  if (isUnlimitedSpeechQuota(seconds)) return "Unlimited";
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
};

/**
 * A service's date as the desktop app stores it, "YYYY-MM-DD", read as that
 * day wherever the reader is, not as midnight UTC.
 */
export const parseServiceDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatDate = (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
  new Date(value).toLocaleDateString(undefined, options ?? { month: "short", day: "numeric", year: "numeric" });

/** "Today", "Yesterday", "3 days ago", or the date. */
export const formatRelative = (value: number): string => {
  const startOfDay = (time: number) => {
    const day = new Date(time);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
  };
  const days = Math.round((startOfDay(Date.now()) - startOfDay(value)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDate(value);
};

export const formatBytes = (bytes: number): string => {
  const gigabytes = bytes / 1024 ** 3;
  return gigabytes >= 1 ? `${Math.round(gigabytes)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
};
