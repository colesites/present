"use client";

import {
  useState,
  useCallback,
  memo,
  useEffect,
  useMemo,
  forwardRef,
  useRef,
  useImperativeHandle,
  type ChangeEvent,
} from "react";
import { parseReference, type ParsedReference } from "../lib/parser";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { cn } from "../../../renderer/shared/lib/utils";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { useServices } from "../../../features/services/hooks";
import { useScripture, type HostedBibleVersion } from "../hooks/useScripture";
import { generateBibleSlides, type ScriptureSlide } from "../lib/slides";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { SpeechScriptureSuggestion } from "./SpeechScriptureSuggestion";
import {
  Mic,
  MicOff,
  Loader2,
  Search,
  Monitor,
  Plus,
  Download,
  Upload,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { ScriptureInput, type ScriptureInputRef } from "./ScriptureInput";
import type { BibleVerse } from "../lib/db";
import { ScriptureResults } from "./ScriptureResults";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../renderer/shared/components/ui/dropdown-menu";

interface ScripturePanelProps {
  onSendToOutput: (slides: ScriptureSlide[]) => void;
  orgId: Id<"organizations"> | null;
  userId: string | null;
}

export interface ScripturePanelRef {
  focusSearch: () => void;
}

export const ScripturePanel = memo(
  forwardRef<ScripturePanelRef, ScripturePanelProps>(function ScripturePanel(
    { onSendToOutput, orgId, userId },
    ref,
  ) {
    const inputRef = useRef<ScriptureInputRef>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const identifyTimeoutRef = useRef<number | null>(null);
    const textSearchRequestRef = useRef(0);
    const [downloadingHostedId, setDownloadingHostedId] = useState<string | null>(null);
    const [removingVersionId, setRemovingVersionId] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      focusSearch: () => {
        inputRef.current?.focus();
      },
    }));

    const liveBooks = useLiveQuery(() => db.books.toArray());
    const availableBooks = useMemo(() => liveBooks ?? [], [liveBooks]);
    const liveVersions = useLiveQuery(() => db.versions.toArray());
    const availableVersions = useMemo(() => liveVersions ?? [], [liveVersions]);

    const { addScriptureToService, selectedServiceId } = useServices({ orgId, userId }, []);

    const {
      activeImport,
      importFile,
      uninstallVersion,
      lookupRef,
      searchVersesByText,
      prewarmSearchPool,
      downloadVersion,
      hostedVersions,
      isHostedCatalogLoading,
      hostedCatalogError,
      refreshHostedCatalog,
    } = useScripture();

    const [selectedVersionCode, setSelectedVersionCode] = useState<string | null>(null);
    const [parsedRef, setParsedRef] = useState<ParsedReference>({
      book: null,
      chapter: null,
      verseStart: null,
      verseEnd: null,
      versionCode: null,
      errors: [],
    });

    const [suggestion, setSuggestion] = useState<string | null>(null);
    const [isIdentifying, setIsIdentifying] = useState(false);
    const [liveTranscript, setLiveTranscript] = useState("");
    const [speechLang, setSpeechLang] = useState("en-US");
    const [textSearchQuery, setTextSearchQuery] = useState("");
    const [textSearchResults, setTextSearchResults] = useState<BibleVerse[]>([]);
    const [isTextSearching, setIsTextSearching] = useState(false);

    const identifyScripture = useCallback(async (transcript: string) => {
      if (!transcript.trim()) return;
      setIsIdentifying(true);
      try {
        const res = await fetch("/api/scripture/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript }),
        });
        const data = (await res.json()) as { suggestion?: { reference: string } };
        if (data.suggestion?.reference) {
          setSuggestion(data.suggestion.reference);
        }
      } catch (err: unknown) {
        console.error("Failed to identify scripture:", err);
      } finally {
        setIsIdentifying(false);
      }
    }, []);

    const onSpeechResult = useCallback((result: { transcript: string; isFinal: boolean }) => {
      if (!result.transcript) return;
      setLiveTranscript(result.transcript);
    }, []);

    const onSpeechFinal = useCallback((text: string) => {
      setLiveTranscript(text);
    }, []);

    const { isListening, isSupported, startListening, stopListening } =
      useSpeechRecognition({
        onResult: onSpeechResult,
        onFinalResult: onSpeechFinal,
        lang: speechLang,
      });

    useEffect(() => {
      try {
        const raw = localStorage.getItem("present-settings");
        if (!raw) return;
        const parsed = JSON.parse(raw) as { scriptureSpeechLang?: string };
        if (parsed.scriptureSpeechLang) {
          setSpeechLang(parsed.scriptureSpeechLang);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    }, []);

    useEffect(() => {
      if (identifyTimeoutRef.current !== null) {
        window.clearTimeout(identifyTimeoutRef.current);
        identifyTimeoutRef.current = null;
      }

      const text = liveTranscript.trim();
      if (!text) {
        return;
      }

      const quickParsed = parseReference(text, availableBooks);
      if (quickParsed.book && quickParsed.chapter) {
        let quickRef = `${quickParsed.book.name} ${quickParsed.chapter}`;
        if (quickParsed.verseStart) {
          quickRef += `:${quickParsed.verseStart}`;
          if (quickParsed.verseEnd) {
            quickRef += `-${quickParsed.verseEnd}`;
          }
        }
        if (quickParsed.versionCode) {
          quickRef += ` ${quickParsed.versionCode}`;
        }
        setSuggestion(quickRef);
      }

      identifyTimeoutRef.current = window.setTimeout(() => {
        void identifyScripture(text);
      }, isListening ? 100 : 260);

      return () => {
        if (identifyTimeoutRef.current !== null) {
          window.clearTimeout(identifyTimeoutRef.current);
          identifyTimeoutRef.current = null;
        }
      };
    }, [liveTranscript, identifyScripture, availableBooks, isListening]);

    useEffect(() => {
      if (parsedRef.versionCode) {
        const matched = availableVersions.find(
          (version) => version.code.toUpperCase() === parsedRef.versionCode?.toUpperCase(),
        );
        if (matched && matched.code !== selectedVersionCode) {
          setSelectedVersionCode(matched.code);
        }
      }
    }, [parsedRef.versionCode, availableVersions, selectedVersionCode]);

    useEffect(() => {
      if (!selectedVersionCode && availableVersions.length > 0) {
        const nkjv = availableVersions.find(
          (version) => version.code.toUpperCase() === "NKJV",
        );
        setSelectedVersionCode(nkjv ? nkjv.code : availableVersions[0].code);
      }
    }, [availableVersions, selectedVersionCode]);

    useEffect(() => {
      if (!selectedVersionCode) {
        return;
      }
      void prewarmSearchPool(selectedVersionCode);
    }, [prewarmSearchPool, selectedVersionCode]);

    const handleRefChange = useCallback((nextRef: ParsedReference) => {
      setParsedRef(nextRef);
    }, []);

    const mergedRef = useMemo(
      () => ({
        ...parsedRef,
        versionCode: parsedRef.versionCode || selectedVersionCode,
      }),
      [parsedRef, selectedVersionCode],
    );

    const resolveVersionCode = useCallback(
      (versionId: string) => {
        return (
          availableVersions.find((version) => version.id === versionId)?.code
          ?? selectedVersionCode
          ?? "NKJV"
        );
      },
      [availableVersions, selectedVersionCode],
    );

    const handleEnter = useCallback(
      async (val?: string) => {
        let activeParsed = parsedRef;
        if (val) {
          activeParsed = parseReference(val, availableBooks);
        }

        if (!activeParsed.book || !activeParsed.chapter) return;

        const version = activeParsed.versionCode || selectedVersionCode || "NKJV";
        let refText = `${activeParsed.book.name} ${activeParsed.chapter}`;
        if (activeParsed.verseStart) {
          refText += `:${activeParsed.verseStart}`;
          if (activeParsed.verseEnd) {
            refText += `-${activeParsed.verseEnd}`;
          }
        }
        refText += ` ${version}`;

        const verses = await lookupRef({
          ...activeParsed,
          versionCode: version,
        });

        if (verses.length > 0) {
          const slides = generateBibleSlides(verses, {
            verseNumberMode: "inline",
            maxLines: 40,
            maxCharsPerLine: 100,
            versionName: version,
          });
          onSendToOutput(slides);
        }

        if (selectedServiceId) {
          await addScriptureToService(selectedServiceId, refText, refText);
        }
      },
      [
        parsedRef,
        availableBooks,
        selectedVersionCode,
        lookupRef,
        onSendToOutput,
        selectedServiceId,
        addScriptureToService,
      ],
    );

    const handleAcceptSuggestion = useCallback(
      async (reference: string) => {
        setSuggestion(null);
        const parsed = parseReference(reference, availableBooks);
        if (!parsed.book || !parsed.chapter) return;

        const version = parsed.versionCode || selectedVersionCode || "NKJV";
        const verses = await lookupRef({ ...parsed, versionCode: version });
        if (verses.length === 0) return;

        const slides = generateBibleSlides(verses, {
          verseNumberMode: "inline",
          maxLines: 40,
          maxCharsPerLine: 100,
          versionName: version,
        });
        onSendToOutput(slides);

        if (selectedServiceId) {
          await addScriptureToService(selectedServiceId, reference, reference);
        }
      },
      [
        availableBooks,
        selectedVersionCode,
        lookupRef,
        onSendToOutput,
        selectedServiceId,
        addScriptureToService,
      ],
    );

    useEffect(() => {
      const query = textSearchQuery.trim();
      if (!query) {
        setTextSearchResults([]);
        setIsTextSearching(false);
        return;
      }

      const requestId = textSearchRequestRef.current + 1;
      textSearchRequestRef.current = requestId;
      setIsTextSearching(true);

      const timeoutId = window.setTimeout(async () => {
        const results = await searchVersesByText({
          query,
          versionCode: selectedVersionCode,
          limit: 60,
        });

        if (textSearchRequestRef.current !== requestId) {
          return;
        }
        setTextSearchResults(results);
        setIsTextSearching(false);
      }, 90);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }, [textSearchQuery, searchVersesByText, selectedVersionCode]);

    const handleSendTextVerse = useCallback(
      async (verse: BibleVerse) => {
        const versionName = resolveVersionCode(verse.version);
        const slides = generateBibleSlides([verse], {
          verseNumberMode: "inline",
          maxLines: 40,
          maxCharsPerLine: 100,
          versionName,
        });
        onSendToOutput(slides);
      },
      [onSendToOutput, resolveVersionCode],
    );

    const handleAddTextVerseToService = useCallback(
      async (verse: BibleVerse) => {
        if (!selectedServiceId) {
          return;
        }
        const versionCode = resolveVersionCode(verse.version);
        const reference = `${verse.bookName} ${verse.chapter}:${verse.verse}${versionCode ? ` ${versionCode}` : ""}`;
        await addScriptureToService(selectedServiceId, reference, reference);
      },
      [addScriptureToService, resolveVersionCode, selectedServiceId],
    );

    const handleManualImport = useCallback(
      async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
          return;
        }

        await importFile(file);
        event.target.value = "";
      },
      [importFile],
    );

    const handleDownloadHostedVersion = useCallback(
      async (version: HostedBibleVersion) => {
        setDownloadingHostedId(version.id);
        try {
          await downloadVersion(version);
        } finally {
          setDownloadingHostedId(null);
        }
      },
      [downloadVersion],
    );

    const handleUninstallVersion = useCallback(
      async (versionId: string) => {
        setRemovingVersionId(versionId);
        try {
          await uninstallVersion(versionId);
        } finally {
          setRemovingVersionId(null);
        }
      },
      [uninstallVersion],
    );

    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-background">
        <div className="shrink-0 border-b border-border/60 bg-card px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Bible
              </h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Bring your own Bible file or download a hosted version directly into the app database.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={importInputRef}
                type="file"
                accept=".zip,.json,.xml"
                className="hidden"
                onChange={(event) => {
                  void handleManualImport(event);
                }}
              />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-accent/40"
              >
                <Upload className="h-3.5 w-3.5" />
                Import Bible File
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-accent/40"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download Ours
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  {isHostedCatalogLoading ? (
                    <div className="px-2 py-2 text-xs text-muted-foreground">
                      Loading hosted versions...
                    </div>
                  ) : hostedVersions.length === 0 ? (
                    <div className="space-y-2 px-2 py-2">
                      <p className="text-xs text-muted-foreground">
                        No hosted versions are available right now.
                      </p>
                      {hostedCatalogError ? (
                        <p className="text-[10px] text-destructive">{hostedCatalogError}</p>
                      ) : null}
                    </div>
                  ) : (
                    hostedVersions.map((version) => (
                      <DropdownMenuItem
                        key={version.id}
                        onClick={() => {
                          void handleDownloadHostedVersion(version);
                        }}
                        disabled={downloadingHostedId === version.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold">{version.name}</span>
                          <span className="block text-[10px] text-muted-foreground">
                            {version.code}
                            {version.source === "bundled" ? " • Local" : ""}
                            {typeof version.sizeMB === "number" ? ` • ${version.sizeMB.toFixed(1)} MB` : ""}
                          </span>
                        </span>
                        {downloadingHostedId === version.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : null}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <button
                type="button"
                onClick={() => {
                  void refreshHostedCatalog();
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition hover:text-foreground"
                title="Refresh hosted list"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isHostedCatalogLoading && "animate-spin")} />
              </button>
            </div>
          </div>

          {activeImport ? (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground capitalize">
                <span>{activeImport.phase}</span>
                <span>{activeImport.percent}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{ width: `${activeImport.percent}%` }}
                />
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {availableVersions.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">No Bible versions installed yet.</span>
            ) : (
              availableVersions.map((version) => (
                <div
                  key={version.id}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border pr-1",
                    selectedVersionCode === version.code
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedVersionCode(version.code)}
                    className="px-2 py-1 text-[10px] font-semibold"
                  >
                    {version.code}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleUninstallVersion(version.id);
                    }}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                    title="Remove version"
                  >
                    {removingVersionId === version.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="shrink-0 border-b border-border/40 bg-background px-4 py-3">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Scripture Lookup
              </p>
              <ScriptureInput
                ref={inputRef}
                onRefChange={handleRefChange}
                availableBooks={availableBooks}
                availableVersions={availableVersions}
                placeholder={
                  selectedVersionCode
                    ? `Lookup in ${selectedVersionCode} (e.g. John 3:16)`
                    : "Lookup scripture reference"
                }
                onEnter={handleEnter}
              />
            </div>

            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Verse Search
              </p>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={textSearchQuery}
                  onChange={(event) => setTextSearchQuery(event.target.value)}
                  placeholder="Type words to find matching verses"
                  className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60"
                />
                {isTextSearching ? (
                  <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
                ) : null}
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                AI Search
              </p>
              <div className="flex items-center gap-1.5">
                {isSupported ? (
                  <button
                    onClick={isListening ? stopListening : startListening}
                    title={isListening ? "Stop listening" : "Listen for scripture"}
                    className={cn(
                      "relative inline-flex h-9 w-9 items-center justify-center rounded-md border transition-all",
                      isListening
                        ? "border-red-600 bg-red-500 text-white"
                        : "border-border bg-background text-muted-foreground hover:border-primary hover:text-primary",
                    )}
                  >
                    {isListening ? (
                      <>
                        <Mic className="h-4 w-4 animate-pulse" />
                        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-ping rounded-full bg-white" />
                      </>
                    ) : (
                      <MicOff className="h-4 w-4" />
                    )}
                  </button>
                ) : (
                  <div className="h-9 w-9 rounded-md border border-border bg-background/40" />
                )}
                <div className="relative flex-1">
                  <input
                    value={liveTranscript}
                    onChange={(event) => setLiveTranscript(event.target.value)}
                    placeholder="Speak or type what you remember"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60"
                  />
                  {isIdentifying ? (
                    <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto p-4">
          <ScriptureResults
            parsedRef={mergedRef}
            onSendToOutput={onSendToOutput}
            onAddToService={
              selectedServiceId
                ? (reference: string, text: string) =>
                    addScriptureToService(selectedServiceId, reference, text)
                : undefined
            }
          />

          <div className="mt-4 rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
                Verse Search Results
              </h3>
            </div>

            {textSearchQuery.trim().length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Start typing above and results will appear automatically.
              </p>
            ) : textSearchResults.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No verses matched that search yet.
              </p>
            ) : (
              <div className="space-y-1">
                {textSearchResults.map((verse) => {
                  const versionCode = resolveVersionCode(verse.version);
                  const verseRef = `${verse.bookName} ${verse.chapter}:${verse.verse}${versionCode ? ` ${versionCode}` : ""}`;
                  return (
                    <div
                      key={verse.pk}
                      className="group rounded-md border border-border/60 bg-background/40 px-2 py-1.5 transition hover:border-primary/40 hover:bg-accent/20"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void handleSendTextVerse(verse);
                          }}
                          className="flex-1 text-left"
                        >
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {verseRef}
                          </p>
                          <p className="text-xs text-foreground">{verse.text}</p>
                        </button>
                        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => {
                              void handleSendTextVerse(verse);
                            }}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground"
                            title="Show verse"
                          >
                            <Monitor className="h-3 w-3" />
                          </button>
                          {selectedServiceId ? (
                            <button
                              type="button"
                              onClick={() => {
                                void handleAddTextVerseToService(verse);
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground"
                              title="Add to service"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {suggestion ? (
          <SpeechScriptureSuggestion
            reference={suggestion}
            onAccept={handleAcceptSuggestion}
            onDismiss={() => setSuggestion(null)}
          />
        ) : null}
      </div>
    );
  }),
);
