"use client";

import React from "react";
import { 
  SETTINGS_LANGUAGE_OPTIONS 
} from "../lib/constants";
import { 
  FontFamilySelect, 
  FontSizeInput 
} from "../../../components";
import { cn } from "../../../lib/utils";
import { MediaItem, MediaFolder } from "../../media/hooks/useMediaFolders";

interface SettingsScreenProps {
  settingsLang: string;
  setSettingsLang: (lang: string) => void;
  settingsScriptureFontFamily: string;
  setSettingsScriptureFontFamily: (font: string) => void;
  settingsScriptureFontSize: number;
  setSettingsScriptureFontSize: (size: number) => void;
  settingsScriptureTextAlign: "left" | "center" | "right";
  setSettingsScriptureTextAlign: (align: "left" | "center" | "right") => void;
  settingsScriptureBackgroundId: string | null;
  setSettingsScriptureBackgroundId: (id: string | null) => void;
  settingsMediaFolderId: string;
  setSettingsMediaFolderId: (id: string) => void;
  settingsMediaItems: MediaItem[];
  folders: MediaFolder[];
  allMediaItems: MediaItem[];
  selectMediaForOutput: (item: MediaItem | null) => void;
}

export function SettingsScreen({
  settingsLang,
  setSettingsLang,
  settingsScriptureFontFamily,
  setSettingsScriptureFontFamily,
  settingsScriptureFontSize,
  setSettingsScriptureFontSize,
  settingsScriptureTextAlign,
  setSettingsScriptureTextAlign,
  settingsScriptureBackgroundId,
  setSettingsScriptureBackgroundId,
  settingsMediaFolderId,
  setSettingsMediaFolderId,
  settingsMediaItems,
  folders,
  allMediaItems,
  selectMediaForOutput,
}: SettingsScreenProps) {
  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="flex h-full w-64 shrink-0 flex-col gap-4 border-r border-border bg-card px-4 py-5">
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

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border bg-card px-6 py-3">
          <h2 className="text-sm font-semibold">Scripture</h2>
          <p className="text-[11px] text-muted-foreground">
            Control how voice search listens for Bible passages.
          </p>
        </div>

        <div className="flex flex-1 flex-col space-y-6 overflow-hidden px-6 py-4">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Voice language
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Choose the language or accent the microphone should expect
              when identifying scripture.
            </p>
            <div className="mt-2 max-w-xs">
              <select
                value={settingsLang}
                onChange={(e) => setSettingsLang(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              >
                {SETTINGS_LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Typography
            </h3>
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 w-fit">
              <FontFamilySelect
                value={settingsScriptureFontFamily}
                onChange={setSettingsScriptureFontFamily}
              />

              <FontSizeInput
                value={settingsScriptureFontSize}
                onChange={setSettingsScriptureFontSize}
                presets={[6, 8, 10, 12, 14, 16, 18, 20, 24, 30]}
                unit="vh"
                min={1}
                max={50}
              />
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Text Alignment
            </h3>
            <div className="flex items-center gap-2">
              {(["left", "center", "right"] as const).map((align) => (
                <button
                  key={align}
                  type="button"
                  onClick={() => setSettingsScriptureTextAlign(align)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs capitalize transition",
                    settingsScriptureTextAlign === align
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {align}
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-1 flex-col space-y-2 min-h-0">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Scripture background
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Choose a media file to display behind scripture passages.
            </p>
            {allMediaItems.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Add media in the Media tab to pick a background.
              </p>
            ) : (
              <div className="mt-3 flex flex-1 flex-col space-y-3 min-h-0">
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSettingsScriptureBackgroundId(null)}
                    className={
                      settingsScriptureBackgroundId === null
                        ? "rounded-md border border-primary bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
                        : "rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                    }
                  >
                    Use current media
                  </button>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    Background override media
                  </span>
                </div>

                <div className="flex flex-1 flex-col space-y-2 min-h-0">
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className="text-[11px] text-muted-foreground">
                      Folder
                    </span>
                    <select
                      value={settingsMediaFolderId}
                      onChange={(e) =>
                        setSettingsMediaFolderId(e.target.value)
                      }
                      className="h-7 rounded-md border border-input bg-background px-2 text-[11px] text-foreground"
                    >
                      <option value="all">All folders</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex-1 overflow-y-auto rounded-md border border-border bg-card p-2">
                    <div className="grid grid-cols-6 gap-1.5">
                      {settingsMediaItems.map((item) => {
                        const isActive =
                          settingsScriptureBackgroundId === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setSettingsScriptureBackgroundId(item.id);
                              selectMediaForOutput(item);
                            }}
                            className={
                              (isActive
                                ? "border-primary ring-1 ring-primary "
                                : "border-border hover:border-primary ") +
                              "relative aspect-video overflow-hidden rounded-md border bg-black"
                            }
                          >
                            {item.type === "image" ? (
                              <img
                                src={item.url}
                                alt={item.name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <video
                                src={item.url}
                                className="h-full w-full object-cover"
                                muted
                                onMouseEnter={(e) => e.currentTarget.play()}
                                onMouseLeave={(e) => {
                                  e.currentTarget.pause();
                                  e.currentTarget.currentTime = 0;
                                }}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
