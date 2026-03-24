import { useState, useEffect, useMemo } from "react";
import { 
  Settings, 
  SETTINGS_STORAGE_KEY 
} from "../features/settings/lib/constants";
import { MediaItem, MediaFolder } from "../features/media/hooks/useMediaFolders";

interface UseAppSettingsProps {
  folders: MediaFolder[];
  allMediaItems: MediaItem[];
}

export function useAppSettings({ folders, allMediaItems }: UseAppSettingsProps) {
  const [settingsLang, setSettingsLang] = useState("en-US");
  const [settingsScriptureBackgroundId, setSettingsScriptureBackgroundId] =
    useState<string | null>(null);
  const [settingsScriptureFontSize, setSettingsScriptureFontSize] =
    useState(18);
  const [settingsScriptureFontFamily, setSettingsScriptureFontFamily] =
    useState("Inter");
  const [settingsScriptureTextAlign, setSettingsScriptureTextAlign] = useState<
    "left" | "center" | "right"
  >("left");
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  const [settingsMediaFolderId, setSettingsMediaFolderId] = useState<
    string | "all"
  >("all");

  const settingsMediaItems = useMemo(
    () =>
      settingsMediaFolderId === "all"
        ? allMediaItems
        : allMediaItems.filter(
            (item) => item.folderId === settingsMediaFolderId,
          ),
    [allMediaItems, settingsMediaFolderId],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        if (typeof parsed.scriptureSpeechLang === "string") {
          setSettingsLang(parsed.scriptureSpeechLang);
        }
        if (typeof parsed.scriptureBackgroundMediaId === "string") {
          setSettingsScriptureBackgroundId(parsed.scriptureBackgroundMediaId);
        }
        if (typeof parsed.scriptureFontSize === "number") {
          setSettingsScriptureFontSize(parsed.scriptureFontSize);
        }
        if (typeof parsed.scriptureFontFamily === "string") {
          setSettingsScriptureFontFamily(parsed.scriptureFontFamily);
        }
        if (
          parsed.scriptureTextAlign === "left" ||
          parsed.scriptureTextAlign === "center" ||
          parsed.scriptureTextAlign === "right"
        ) {
          setSettingsScriptureTextAlign(parsed.scriptureTextAlign);
        }
      }
    } catch {
      // Ignore errors
    } finally {
      setSettingsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    try {
      const next: Settings = {
        scriptureSpeechLang: settingsLang,
        scriptureBackgroundMediaId: settingsScriptureBackgroundId ?? null,
        scriptureFontSize: settingsScriptureFontSize,
        scriptureFontFamily: settingsScriptureFontFamily,
        scriptureTextAlign: settingsScriptureTextAlign,
      };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore errors
    }
  }, [
    settingsHydrated,
    settingsLang,
    settingsScriptureBackgroundId,
    settingsScriptureFontSize,
    settingsScriptureFontFamily,
    settingsScriptureTextAlign,
  ]);

  useEffect(() => {
    if (settingsMediaFolderId !== "all") return;
    if (folders.length === 0) return;
    setSettingsMediaFolderId(folders[0].id);
  }, [folders, settingsMediaFolderId]);

  return {
    settingsLang,
    setSettingsLang,
    settingsScriptureBackgroundId,
    setSettingsScriptureBackgroundId,
    settingsScriptureFontSize,
    setSettingsScriptureFontSize,
    settingsScriptureFontFamily,
    setSettingsScriptureFontFamily,
    settingsScriptureTextAlign,
    setSettingsScriptureTextAlign,
    settingsHydrated,
    settingsMediaFolderId,
    setSettingsMediaFolderId,
    settingsMediaItems,
  };
}
