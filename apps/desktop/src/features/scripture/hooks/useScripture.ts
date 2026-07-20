import { useState, useEffect, useCallback, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type BibleVersion, type BibleVerse } from "../lib/db";
import { importBibleModule, type ImportProgress } from "../lib/import-pipeline";
import { type ParsedReference } from "../lib/parser";
import { toast } from "sonner";
import {
  buildVerseSearchIndex,
  normalizeVerseSearchText,
  searchVerseIndex,
} from "../lib/verse-search-index.mjs";

export interface HostedBibleVersion {
  id: string;
  code: string;
  name: string;
  url?: string;
  source: "remote" | "bundled";
  filePath?: string;
  sizeMB?: number;
  description?: string;
}

const getCatalogUrlFromRuntime = (): string => {
  const runtimeEnv =
    typeof process !== "undefined" && process.env
      ? process.env
      : undefined;

  const configuredCatalogUrl =
    runtimeEnv?.NEXT_PUBLIC_SCRIPTURE_CATALOG_URL
    ?? runtimeEnv?.SCRIPTURE_CATALOG_URL;
  if (configuredCatalogUrl) {
    return configuredCatalogUrl;
  }

  if (runtimeEnv?.WEB_APP_URL) {
    return `${runtimeEnv.WEB_APP_URL}/bibles/catalog.json`;
  }

  return "https://present.multivrs.space/bibles/catalog.json";
};

const DEFAULT_CATALOG_URL = getCatalogUrlFromRuntime();
type VerseSearchIndex = ReturnType<typeof buildVerseSearchIndex>;

function normalizeHostedCatalog(payload: unknown): HostedBibleVersion[] {
  const rawItems = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null && Array.isArray((payload as { versions?: unknown[] }).versions)
      ? (payload as { versions: unknown[] }).versions
      : [];

  const normalized: HostedBibleVersion[] = [];
  for (const item of rawItems) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const candidate = item as Partial<HostedBibleVersion>;
    if (!candidate.id || !candidate.code || !candidate.name || !candidate.url) {
      continue;
    }

    const nextVersion: HostedBibleVersion = {
      id: String(candidate.id),
      code: String(candidate.code),
      name: String(candidate.name),
      url: String(candidate.url),
      source: "remote",
    };

    if (typeof candidate.sizeMB === "number" && Number.isFinite(candidate.sizeMB)) {
      nextVersion.sizeMB = candidate.sizeMB;
    }
    if (typeof candidate.description === "string" && candidate.description.trim()) {
      nextVersion.description = candidate.description;
    }

    normalized.push(nextVersion);
  }

  return normalized;
}

function normalizeBundledCatalog(payload: unknown): HostedBibleVersion[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const bundled: HostedBibleVersion[] = [];
  for (const item of payload) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const candidate = item as {
      id?: unknown;
      code?: unknown;
      name?: unknown;
      filePath?: unknown;
      sizeBytes?: unknown;
    };

    if (
      typeof candidate.id !== "string" ||
      typeof candidate.code !== "string" ||
      typeof candidate.name !== "string" ||
      typeof candidate.filePath !== "string"
    ) {
      continue;
    }

    const nextVersion: HostedBibleVersion = {
      id: candidate.id,
      code: candidate.code,
      name: candidate.name,
      filePath: candidate.filePath,
      source: "bundled",
      description: "Bundled with app",
    };

    if (typeof candidate.sizeBytes === "number" && Number.isFinite(candidate.sizeBytes)) {
      nextVersion.sizeMB = candidate.sizeBytes / (1024 * 1024);
    }

    bundled.push(nextVersion);
  }

  return bundled;
}

const getFileNameFromPath = (filePath: string): string => {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || "bible.xml";
};

async function yieldToRenderer() {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

export function useScripture() {
  const versions = useLiveQuery(() => db.versions.toArray());
  const [activeImport, setActiveImport] = useState<ImportProgress | null>(null);
  const [hostedVersions, setHostedVersions] = useState<HostedBibleVersion[]>([]);
  const [isHostedCatalogLoading, setIsHostedCatalogLoading] = useState(false);
  const [hostedCatalogError, setHostedCatalogError] = useState<string | null>(null);
  const verseSearchIndexCacheRef = useRef<
    Map<string, VerseSearchIndex>
  >(new Map());
  const verseSearchIndexPendingRef = useRef<Map<string, Promise<VerseSearchIndex>>>(
    new Map(),
  );

  const clearVerseSearchCache = useCallback(() => {
    verseSearchIndexCacheRef.current.clear();
    verseSearchIndexPendingRef.current.clear();
  }, []);

  const resolveVersion = useCallback(
    (versionCode?: string | null): BibleVersion | null => {
      if (!versions || versions.length === 0) {
        return null;
      }

      if (versionCode) {
        const matched = versions.find(
          (version) =>
            version.code.toLowerCase() === versionCode.toLowerCase() ||
            version.id.toLowerCase() === versionCode.toLowerCase(),
        );
        if (matched) {
          return matched;
        }
      }

      const nkjv = versions.find((version) => version.code.toUpperCase() === "NKJV");
      return nkjv ?? versions[0];
    },
    [versions],
  );

  const refreshHostedCatalog = useCallback(async () => {
    setIsHostedCatalogLoading(true);
    setHostedCatalogError(null);

    let remoteVersions: HostedBibleVersion[] = [];
    let remoteError: string | null = null;

    let bundledVersions: HostedBibleVersion[] = [];
    try {
      try {
        if (typeof window !== "undefined" && window.electronAPI?.listBundledBibles) {
          const bundled = await window.electronAPI.listBundledBibles();
          bundledVersions = normalizeBundledCatalog(bundled);
        }
      } catch (error) {
        console.error("Failed to load bundled Bible catalog", error);
      }

      const runningInDesktop =
        typeof window !== "undefined"
        && !!window.electronAPI?.fetchHostedBibleCatalog;

      // If we have bundled bibles in the desktop app, prefer them and don't spam the console
      // with remote-catalog failures during local development.
      const shouldAttemptRemoteCatalog = !runningInDesktop || bundledVersions.length === 0;

      if (shouldAttemptRemoteCatalog) {
        try {
          const data =
            typeof window !== "undefined"
            && window.electronAPI?.fetchHostedBibleCatalog
              ? await window.electronAPI.fetchHostedBibleCatalog(DEFAULT_CATALOG_URL)
              : await (async () => {
                  const response = await fetch(DEFAULT_CATALOG_URL, { cache: "no-store" });
                  if (!response.ok) {
                    throw new Error(`Catalog download failed (${response.status})`);
                  }
                  return (await response.json()) as unknown;
                })();

          if (!data) {
            throw new Error("Catalog download failed");
          }
          remoteVersions = normalizeHostedCatalog(data);
        } catch (error) {
          // Remote catalog is optional; only surface the error if we couldn't find any bundled versions.
          remoteError = error instanceof Error ? error.message : "Failed to load hosted versions";
        }
      }
    } finally {
      const mergedVersions = [...bundledVersions, ...remoteVersions];
      setHostedVersions(mergedVersions);
      setHostedCatalogError(
        mergedVersions.length === 0 ? remoteError ?? "No Bible versions available" : null,
      );
      setIsHostedCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHostedCatalog();
  }, [refreshHostedCatalog]);

  const downloadVersion = async (version: HostedBibleVersion) => {
    try {
      if (
        version.source === "bundled"
        && version.filePath
        && window.electronAPI?.readBundledBible
      ) {
        const fileBytes = await window.electronAPI.readBundledBible(version.filePath);
        if (!fileBytes) {
          throw new Error("Failed to read bundled Bible file");
        }

        const { processBibleBuffer } = await import("../lib/import-pipeline");
        await processBibleBuffer(
          fileBytes,
          (progress) => {
            setActiveImport(progress);
          },
          getFileNameFromPath(version.filePath),
        );
        toast.success(`${version.name} imported successfully`);
      } else if (version.url) {
        await importBibleModule(version.url, (progress) => {
          setActiveImport(progress);
        });
        toast.success(`${version.name} downloaded`);
      } else {
        throw new Error("No download source configured for this Bible version");
      }
      clearVerseSearchCache();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setActiveImport(null);
    }
  };

  const importFile = async (file: File) => {
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const { processBibleBuffer } = await import("../lib/import-pipeline");
      await processBibleBuffer(
        buffer,
        (progress) => {
          setActiveImport(progress);
        },
        file.name,
      );
      toast.success(`"${file.name}" imported successfully`);
      clearVerseSearchCache();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setActiveImport(null);
    }
  };

  const uninstallVersion = async (versionId: string) => {
    try {
      await db.transaction("readwrite", [db.versions, db.verses], async () => {
        await db.versions.delete(versionId);
        await db.verses.where("version").equals(versionId).delete();
      });
      toast.success("Bible version uninstalled");
      clearVerseSearchCache();
    } catch (error) {
      toast.error("Failed to uninstall version");
    }
  };

  const lookupRef = useCallback(async (ref: ParsedReference): Promise<BibleVerse[]> => {
    if (!ref.book || !ref.chapter || ref.errors.length > 0) return [];

    const targetVersion = resolveVersion(ref.versionCode);
    if (!targetVersion) return [];
    const versionId = targetVersion.id;

    const query = db.verses
      .where("[version+bookId+chapter]")
      .equals([versionId, ref.book.id, ref.chapter]);

    let results = await query.toArray();

    const verseStart = ref.verseStart;
    const verseEnd = ref.verseEnd;
    if (verseStart) {
      if (verseEnd) {
        results = results.filter((verse) => verse.verse >= verseStart && verse.verse <= verseEnd);
      } else {
        results = results.filter((verse) => verse.verse === verseStart);
      }
    }

    return results.sort((a, b) => a.verse - b.verse);
  }, [resolveVersion]);

  const getSearchIndex = useCallback(async (versionId: string) => {
    const cached = verseSearchIndexCacheRef.current.get(versionId);
    if (cached) return cached;

    const pending = verseSearchIndexPendingRef.current.get(versionId);
    if (pending) return pending;

    const nextPending = (async () => {
      const versesForVersion = await db.verses.where("version").equals(versionId).toArray();
      await yieldToRenderer();
      const index = buildVerseSearchIndex(versesForVersion);
      verseSearchIndexCacheRef.current.set(versionId, index);
      return index;
    })();

    verseSearchIndexPendingRef.current.set(versionId, nextPending);
    try {
      return await nextPending;
    } finally {
      verseSearchIndexPendingRef.current.delete(versionId);
    }
  }, []);

  const searchVersesByText = useCallback(
    async (input: {
      query: string;
      versionCode?: string | null;
      limit?: number;
      mode?: "exact" | "broad";
    }): Promise<BibleVerse[]> => {
      const { query, versionCode, limit = 50, mode = "broad" } = input;
      const normalizedQuery = normalizeVerseSearchText(query);
      if (normalizedQuery.length < 2) {
        return [];
      }

      const targetVersion = resolveVersion(versionCode ?? null);
      if (!targetVersion) {
        return [];
      }

      const index = await getSearchIndex(targetVersion.id);
      return searchVerseIndex(index, { query, limit, mode }) as BibleVerse[];
    },
    [getSearchIndex, resolveVersion],
  );

  const identifyVerseFromText = useCallback(
    async (input: {
      query: string;
      versionCode?: string | null;
    }): Promise<BibleVerse | null> => {
      const normalizedQuery = normalizeVerseSearchText(input.query);
      if (normalizedQuery.length < 3) {
        return null;
      }

      const targetVersion = resolveVersion(input.versionCode ?? null);
      if (!targetVersion) {
        return null;
      }

      const index = await getSearchIndex(targetVersion.id);
      const [bestMatch] = searchVerseIndex(index, {
        query: input.query,
        limit: 1,
        mode: "broad",
      }) as BibleVerse[];
      return bestMatch ?? null;
    },
    [getSearchIndex, resolveVersion],
  );

  const prewarmSearchPool = useCallback(
    async (versionCode?: string | null) => {
      const targetVersion = resolveVersion(versionCode ?? null);
      if (!targetVersion) {
        return;
      }
      await yieldToRenderer();
      await getSearchIndex(targetVersion.id);
    },
    [getSearchIndex, resolveVersion],
  );

  return {
    versions: versions || [],
    activeImport,
    hostedVersions,
    isHostedCatalogLoading,
    hostedCatalogError,
    refreshHostedCatalog,
    downloadVersion,
    importFile,
    uninstallVersion,
    lookupRef,
    searchVersesByText,
    identifyVerseFromText,
    prewarmSearchPool,
  };
}
