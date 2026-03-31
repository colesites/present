"use client";

export type BrowserOmniboxSuggestion = {
  description: string;
  id: string;
  kind: "history" | "remote";
  title: string;
  value: string;
};

type BrowserHistoryEntry = {
  lastVisitedAt: number;
  title: string;
  url: string;
  visitCount: number;
};

const BROWSER_HISTORY_STORAGE_KEY = "present-browser-history-v1";
const MAX_HISTORY_ENTRIES = 120;
const MAX_LOCAL_SUGGESTIONS = 5;

const safeReadBrowserHistory = (): BrowserHistoryEntry[] => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(BROWSER_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is BrowserHistoryEntry => {
      return (
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as BrowserHistoryEntry).lastVisitedAt === "number" &&
        typeof (entry as BrowserHistoryEntry).title === "string" &&
        typeof (entry as BrowserHistoryEntry).url === "string" &&
        typeof (entry as BrowserHistoryEntry).visitCount === "number"
      );
    });
  } catch {
    return [];
  }
};

const safeWriteBrowserHistory = (entries: BrowserHistoryEntry[]): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      BROWSER_HISTORY_STORAGE_KEY,
      JSON.stringify(entries)
    );
  } catch {
    // Ignore local storage failures and keep the omnibox usable.
  }
};

const normalizeBrowserUrl = (value: string): string => {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value.trim();
  }
};

const getHostname = (value: string): string => {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
};

const shouldStoreUrlInHistory = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    if (
      (hostname === "google.com" || hostname === "www.google.com") &&
      (pathname === "/" || pathname === "/search")
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

export const isLikelyBrowserUrlInput = (value: string): boolean => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }

  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("localhost:") ||
    trimmed.startsWith("127.0.0.1:") ||
    trimmed.includes(".")
  );
};

const scoreHistoryEntry = (entry: BrowserHistoryEntry, query: string): number => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return entry.lastVisitedAt + entry.visitCount * 10_000;
  }

  const title = entry.title.toLowerCase();
  const url = entry.url.toLowerCase();
  const hostname = getHostname(entry.url).toLowerCase();

  let score = entry.visitCount * 40;

  if (url.startsWith(normalizedQuery)) {
    score += 1_000;
  }
  if (hostname.startsWith(normalizedQuery)) {
    score += 900;
  }
  if (title.startsWith(normalizedQuery)) {
    score += 800;
  }
  if (hostname.includes(normalizedQuery)) {
    score += 500;
  }
  if (url.includes(normalizedQuery)) {
    score += 320;
  }
  if (title.includes(normalizedQuery)) {
    score += 280;
  }

  return score + Math.min(entry.lastVisitedAt / 1_000_000, 200);
};

export const rememberBrowserHistoryEntry = (input: {
  incrementVisitCount?: boolean;
  title: string;
  url: string;
}): void => {
  const normalizedUrl = normalizeBrowserUrl(input.url);
  if (!shouldStoreUrlInHistory(normalizedUrl)) {
    return;
  }

  const nextTitle = input.title.trim() || getHostname(normalizedUrl);
  const now = Date.now();
  const currentEntries = safeReadBrowserHistory();
  const existingEntry = currentEntries.find((entry) => entry.url === normalizedUrl);
  const shouldIncrementVisitCount = input.incrementVisitCount ?? true;

  const updatedEntries = [
    {
      lastVisitedAt: now,
      title: nextTitle,
      url: normalizedUrl,
      visitCount:
        (existingEntry?.visitCount ?? 0) + (shouldIncrementVisitCount ? 1 : 0),
    },
    ...currentEntries.filter((entry) => entry.url !== normalizedUrl),
  ].slice(0, MAX_HISTORY_ENTRIES);

  safeWriteBrowserHistory(updatedEntries);
};

export const getLocalBrowserSuggestions = (
  query: string
): BrowserOmniboxSuggestion[] => {
  const trimmed = query.trim();
  const normalizedQuery = trimmed.toLowerCase();
  const historyEntries = safeReadBrowserHistory();

  const rankedEntries = historyEntries
    .filter((entry) => {
      if (!normalizedQuery) {
        return true;
      }

      const entryTitle = entry.title.toLowerCase();
      const entryUrl = entry.url.toLowerCase();
      const entryHostname = getHostname(entry.url).toLowerCase();
      return (
        entryTitle.includes(normalizedQuery) ||
        entryUrl.includes(normalizedQuery) ||
        entryHostname.includes(normalizedQuery)
      );
    })
    .sort((left, right) => {
      return scoreHistoryEntry(right, normalizedQuery) -
        scoreHistoryEntry(left, normalizedQuery);
    })
    .slice(0, MAX_LOCAL_SUGGESTIONS);

  const directUrlSuggestion =
    normalizedQuery && isLikelyBrowserUrlInput(trimmed)
      ? [
          {
            description: "Open typed address",
            id: `history:typed:${trimmed.toLowerCase()}`,
            kind: "history" as const,
            title: trimmed,
            value: trimmed,
          },
        ]
      : [];

  const historySuggestions = rankedEntries.map((entry) => ({
    description: getHostname(entry.url),
    id: `history:${entry.url}`,
    kind: "history" as const,
    title: entry.title,
    value: entry.url,
  }));

  return [...directUrlSuggestion, ...historySuggestions].slice(
    0,
    MAX_LOCAL_SUGGESTIONS
  );
};
