import { useState, useEffect, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type BibleVersion, type BibleVerse } from "../lib/db";
import { importBibleModule, type ImportProgress } from "../lib/import-pipeline";
import { parseReference, type ParsedReference } from "../lib/parser";
import { toast } from "sonner";

export function useScripture() {
  const versions = useLiveQuery(() => db.versions.toArray());
  const [activeImport, setActiveImport] = useState<ImportProgress | null>(null);

  const downloadVersion = async (url: string) => {
    try {
      await importBibleModule(url, (progress) => {
        setActiveImport(progress);
      });
      toast.success("Bible version imported successfully");
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
    } catch (error) {
      toast.error("Failed to uninstall version");
    }
  };

  const lookupRef = useCallback(async (ref: ParsedReference): Promise<BibleVerse[]> => {
    if (!ref.book || !ref.chapter || ref.errors.length > 0) return [];

    // Find the actual version ID by matching the code (e.g. "NKJV") or fallback to first version
    let targetVersion = versions?.find(v => 
      v.code.toLowerCase() === ref.versionCode?.toLowerCase() || 
      v.id.toLowerCase() === ref.versionCode?.toLowerCase()
    );
    
    if (!targetVersion && versions && versions.length > 0) {
      // If version code was specified but not found, don't fallback yet to avoid confusion?
      // Actually, if they type "NKJV", and we don't have it, we should probably warn or just show nothing.
      // But the user said "it said not found", so let's make sure it matches.
      if (!ref.versionCode) {
        const nkjv = versions.find((v) => v.code.toUpperCase() === "NKJV");
        targetVersion = nkjv || versions[0];
      }
    }

    if (!targetVersion) return [];
    const versionId = targetVersion.id;
    
    const query = db.verses
      .where("[version+bookId+chapter]")
      .equals([versionId, ref.book.id, ref.chapter]);

    let results = await query.toArray();

    if (ref.verseStart) {
      if (ref.verseEnd) {
        results = results.filter(v => v.verse >= ref.verseStart! && v.verse <= ref.verseEnd!);
      } else {
        results = results.filter(v => v.verse === ref.verseStart);
      }
    }

    return results.sort((a, b) => a.verse - b.verse);
  }, [versions]);

  return {
    versions: versions || [],
    activeImport,
    downloadVersion,
    importFile,
    uninstallVersion,
    lookupRef,
  };
}
