"use client";

import { useEffect, useState } from "react";
import type { BottomTab, ViewMode } from "@/types";
import { AppHeader } from "@/features/header";

type Settings = {
  scriptureSpeechLang: string;
  scriptureBackgroundMediaId?: string | null;
};

const STORAGE_KEY = "present-settings";
const UI_STATE_KEY = "present-ui-state";

const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-NG", label: "English (Nigeria)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "en-AU", label: "English (Australia)" },
  { value: "en-NZ", label: "English (New Zealand)" },
  { value: "en-IE", label: "English (Ireland)" },
  { value: "en-ZA", label: "English (South Africa)" },
  { value: "en-IN", label: "English (India)" },
  { value: "en-PH", label: "English (Philippines)" },
  { value: "fr-FR", label: "French" },
  { value: "es-ES", label: "Spanish" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
];

export default function SettingsPage() {
  const [scriptureSpeechLang, setScriptureSpeechLang] = useState("en-US");
  const [isHydrated, setIsHydrated] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("settings");
  const [isAutopilotEnabled, setIsAutopilotEnabled] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        if (typeof parsed.scriptureSpeechLang === "string") {
          setScriptureSpeechLang(parsed.scriptureSpeechLang);
        }
      }
    } catch {
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      const next: Settings = { scriptureSpeechLang };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
    }
  }, [isHydrated, scriptureSpeechLang]);

  const navigateWithViewMode = (mode: ViewMode) => {
    try {
      const raw = localStorage.getItem(UI_STATE_KEY);
      let bottomTab: BottomTab = "shows";
      if (raw) {
        const parsed = JSON.parse(raw) as { bottomTab?: BottomTab };
        if (parsed.bottomTab) {
          bottomTab = parsed.bottomTab;
        }
      }
      const nextState = { viewMode: mode, bottomTab };
      localStorage.setItem(UI_STATE_KEY, JSON.stringify(nextState));
    } catch {}
    window.location.href = "/";
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader
        viewMode={viewMode}
        onViewModeChange={navigateWithViewMode}
        isAutopilotEnabled={isAutopilotEnabled}
        onToggleAutopilot={() =>
          setIsAutopilotEnabled((prev) => !prev)
        }
      />
      <div className="flex flex-1">
        <aside className="flex w-60 flex-col gap-4 border-r border-border bg-card px-4 py-4">
          <div>
            <h1 className="text-sm font-semibold">Settings</h1>
            <p className="text-[11px] text-muted-foreground">
              Configure Present for your context
            </p>
          </div>

          <nav className="space-y-1 text-xs">
            <div className="rounded-md bg-primary/10 px-2 py-1.5 font-medium text-primary">
              Scripture
            </div>
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="border-b border-border bg-card px-6 py-3">
            <h2 className="text-sm font-semibold">Scripture</h2>
            <p className="text-[11px] text-muted-foreground">
              Control how voice search listens for Bible passages.
            </p>
          </div>

          <div className="space-y-6 px-6 py-4">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Voice language
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Choose the language or accent the microphone should expect when
                identifying scripture.
              </p>
              <div className="mt-2 max-w-xs">
                <select
                  value={scriptureSpeechLang}
                  onChange={(e) => setScriptureSpeechLang(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                >
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} – {opt.value}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
