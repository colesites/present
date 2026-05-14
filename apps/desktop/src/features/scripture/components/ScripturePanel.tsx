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
import { useScripture, type HostedBibleVersion } from "../hooks/useScripture";
import { generateBibleSlides, type ScriptureSlide } from "../lib/slides";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { SpeechScriptureSuggestion } from "./SpeechScriptureSuggestion";
import { useScripturePanelStore } from "../lib/panel-state";
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
import { useDesktopSessionStore } from "../../../renderer/shared/store/desktopSession";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../renderer/shared/components/ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../../../renderer/shared/components/ui/resizable";

interface ScripturePanelProps {
  onSendToOutput: (slides: ScriptureSlide[]) => void;
  selectedServiceId: Id<"services"> | null;
  onAddScriptureToService: (
    serviceId: Id<"services">,
    ref: string,
    text: string,
  ) => Promise<void>;
  isActive?: boolean;
  speechLang: string;
  speechInputDeviceId: string | null;
}

export interface ScripturePanelRef {
  focusSearch: () => void;
}

export const ScripturePanel = memo(
  forwardRef<ScripturePanelRef, ScripturePanelProps>(function ScripturePanel(
    {
      onSendToOutput,
      selectedServiceId,
      onAddScriptureToService,
      isActive = true,
      speechLang,
      speechInputDeviceId,
    },
    ref,
  ) {
    const inputRef = useRef<ScriptureInputRef>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const identifyTimeoutRef = useRef<number | null>(null);
    const identifyRequestRef = useRef(0);
    const textSearchRequestRef = useRef(0);
    const speechSearchRequestRef = useRef(0);
    const [downloadingHostedId, setDownloadingHostedId] = useState<string | null>(null);
    const [removingVersionId, setRemovingVersionId] = useState<string | null>(null);
    const [speechSearchResults, setSpeechSearchResults] = useState<BibleVerse[]>([]);

    useImperativeHandle(ref, () => ({
      focusSearch: () => {
        inputRef.current?.focus();
      },
    }));

    const liveBooks = useLiveQuery(() => db.books.toArray());
    const allBooks = useMemo(() => liveBooks ?? [], [liveBooks]);
    const liveVersions = useLiveQuery(() => db.versions.toArray());
    const availableVersions = useMemo(() => liveVersions ?? [], [liveVersions]);
    const sessionToken = useDesktopSessionStore((state) => state.sessionToken);

    const {
      activeImport,
      importFile,
      uninstallVersion,
      lookupRef,
      searchVersesByText,
      identifyVerseFromText,
      prewarmSearchPool,
      downloadVersion,
      hostedVersions,
      isHostedCatalogLoading,
      refreshHostedCatalog,
    } = useScripture();

    const lookupValue = useScripturePanelStore((state) => state.lookupValue);
    const setLookupValue = useScripturePanelStore((state) => state.setLookupValue);
    const selectedVersionCode = useScripturePanelStore(
      (state) => state.selectedVersionCode,
    );
    const setSelectedVersionCode = useScripturePanelStore(
      (state) => state.setSelectedVersionCode,
    );
    const suggestion = useScripturePanelStore((state) => state.suggestion);
    const setSuggestion = useScripturePanelStore((state) => state.setSuggestion);
    const liveTranscript = useScripturePanelStore((state) => state.liveTranscript);
    const setLiveTranscript = useScripturePanelStore((state) => state.setLiveTranscript);
    const textSearchQuery = useScripturePanelStore((state) => state.textSearchQuery);
    const setTextSearchQuery = useScripturePanelStore(
      (state) => state.setTextSearchQuery,
    );
    const textSearchResults = useScripturePanelStore(
      (state) => state.textSearchResults,
    );
    const setTextSearchResults = useScripturePanelStore(
      (state) => state.setTextSearchResults,
    );
    const resetSearchState = useScripturePanelStore(
      (state) => state.resetSearchState,
    );
    const [parsedRef, setParsedRef] = useState<ParsedReference>({
      book: null,
      chapter: null,
      verseStart: null,
      verseEnd: null,
      versionCode: null,
      errors: [],
    });
    const [isIdentifying, setIsIdentifying] = useState(false);
    const [isTextSearching, setIsTextSearching] = useState(false);
    const wasActiveRef = useRef(isActive);

    const effectiveSelectedVersionCode = useMemo(() => {
      if (parsedRef.versionCode) {
        const matchedVersion = availableVersions.find(
          (version) => version.code.toUpperCase() === parsedRef.versionCode?.toUpperCase(),
        );
        if (matchedVersion) {
          return matchedVersion.code;
        }
      }

      if (selectedVersionCode) {
        return selectedVersionCode;
      }

      const nkjv = availableVersions.find((version) => version.code.toUpperCase() === "NKJV");
      return nkjv?.code ?? availableVersions[0]?.code ?? null;
    }, [availableVersions, parsedRef.versionCode, selectedVersionCode]);

    const effectiveSelectedVersionId = useMemo(
      () =>
        availableVersions.find(
          (version) =>
            version.code.toUpperCase() === effectiveSelectedVersionCode?.toUpperCase(),
        )?.id ?? null,
      [availableVersions, effectiveSelectedVersionCode],
    );

    const availableBooks = useMemo(
      () =>
        effectiveSelectedVersionId
          ? allBooks.filter((book) => book.version === effectiveSelectedVersionId)
          : allBooks,
      [allBooks, effectiveSelectedVersionId],
    );

    const resolveVersionCode = useCallback(
      (versionId: string) => {
        return (
          availableVersions.find((version) => version.id === versionId)?.code
          ?? effectiveSelectedVersionCode
          ?? "NKJV"
        );
      },
      [availableVersions, effectiveSelectedVersionCode],
    );

    const formatReference = useCallback(
      (input: {
        bookName: string;
        chapter: number;
        verseStart?: number | null;
        verseEnd?: number | null;
        versionCode?: string | null;
      }) => {
        let reference = `${input.bookName} ${input.chapter}`;
        if (input.verseStart) {
          reference += `:${input.verseStart}`;
          if (input.verseEnd) {
            reference += `-${input.verseEnd}`;
          }
        }
        if (input.versionCode) {
          reference += ` ${input.versionCode}`;
        }
        return reference;
      },
      [],
    );

    const syncLookupFromReference = useCallback(
      (reference: string) => {
        setLookupValue(reference);

        const parsed = parseReference(reference, availableBooks);
        if (parsed.book && parsed.chapter) {
          setParsedRef(parsed);
        }
      },
      [availableBooks, setLookupValue],
    );

    const applySuggestedReference = useCallback(
      (reference: string) => {
        setSuggestion(reference);
      },
      [setSuggestion],
    );

    const identifyScripture = useCallback(
      async (transcript: string) => {
        const trimmedTranscript = transcript.trim();
        if (!trimmedTranscript) {
          setSuggestion(null);
          return;
        }

        const requestId = identifyRequestRef.current + 1;
        identifyRequestRef.current = requestId;
        setIsIdentifying(true);

        let matchedVerse: BibleVerse | null = null;

        try {
          matchedVerse = await identifyVerseFromText({
            query: trimmedTranscript,
            versionCode: effectiveSelectedVersionCode,
          });
        } catch (err: unknown) {
          console.error("Failed to identify scripture:", err);
        }

        if (identifyRequestRef.current !== requestId) {
          return;
        }

        setIsIdentifying(false);

        if (!matchedVerse) {
          setSuggestion(null);
          return;
        }

        const reference = formatReference({
          bookName: matchedVerse.bookName,
          chapter: matchedVerse.chapter,
          verseStart: matchedVerse.verse,
          versionCode: resolveVersionCode(matchedVerse.version),
        });

        applySuggestedReference(reference);
      },
      [
        applySuggestedReference,
        effectiveSelectedVersionCode,
        formatReference,
        identifyVerseFromText,
        resolveVersionCode,
        setSuggestion,
      ],
    );

    const handleAiQueryChange = useCallback(
      (value: string) => {
        setLiveTranscript(value);

        const text = value.trim();
        if (!text) {
          setSuggestion(null);
          setIsIdentifying(false);
          setSpeechSearchResults([]);
          return;
        }

        const quickParsed = parseReference(text, availableBooks);
        if (!quickParsed.book || !quickParsed.chapter) {
          setSuggestion(null);
          return;
        }

        applySuggestedReference(
          formatReference({
            bookName: quickParsed.book.name,
            chapter: quickParsed.chapter,
            verseStart: quickParsed.verseStart,
            verseEnd: quickParsed.verseEnd,
            versionCode: quickParsed.versionCode || effectiveSelectedVersionCode,
          }),
        );
        setIsIdentifying(false);
      },
      [
        applySuggestedReference,
        availableBooks,
        effectiveSelectedVersionCode,
        formatReference,
        setLiveTranscript,
        setSpeechSearchResults,
        setSuggestion,
      ],
    );

    const handleTextSearchQueryChange = useCallback((value: string) => {
      setTextSearchQuery(value);
      if (!value.trim()) {
        setTextSearchResults([]);
        setIsTextSearching(false);
        return;
      }
      setIsTextSearching(true);
    }, [setTextSearchQuery, setTextSearchResults]);

    const onSpeechResult = useCallback(
      (result: { transcript: string; isFinal: boolean }) => {
        if (!result.transcript) return;
        handleAiQueryChange(result.transcript);

        if (!result.isFinal) {
          return;
        }

        const quickParsed = parseReference(result.transcript, availableBooks);
        if (quickParsed.book && quickParsed.chapter) {
          return;
        }

        void identifyScripture(result.transcript);
      },
      [availableBooks, handleAiQueryChange, identifyScripture],
    );

    const {
      isListening,
      isStarting,
      isSupported,
      startListening,
      stopListening,
      error: speechError,
    } =
      useSpeechRecognition({
        onResult: onSpeechResult,
        lang: speechLang,
        inputDeviceId: speechInputDeviceId,
        sessionToken,
        usageSource: "bible",
      });

    useEffect(() => {
      if (isActive) {
        wasActiveRef.current = true;
        return;
      }

      if (!wasActiveRef.current) {
        return;
      }

      // Cancel any in-flight async requests so stale results don't land later
      if (identifyTimeoutRef.current !== null) {
        window.clearTimeout(identifyTimeoutRef.current);
        identifyTimeoutRef.current = null;
      }

      identifyRequestRef.current += 1;
      textSearchRequestRef.current += 1;
      speechSearchRequestRef.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsIdentifying(false);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsTextSearching(false);

      // Stop speech recognition when leaving the tab (mic should not stay active)
      if (isListening || isStarting) {
        stopListening();
      }

      wasActiveRef.current = false;
    }, [
      isActive,
      isListening,
      isStarting,
      stopListening,
    ]);



    useEffect(() => {
      if (!isActive) {
        return;
      }

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
        return;
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
    }, [
      isActive,
      liveTranscript,
      identifyScripture,
      availableBooks,
      isListening,
    ]);

    useEffect(() => {
      if (!effectiveSelectedVersionCode) {
        return;
      }

      const prewarm = () => {
        void prewarmSearchPool(effectiveSelectedVersionCode);
      };

      if (typeof window.requestIdleCallback === "function") {
        const idleId = window.requestIdleCallback(prewarm, { timeout: 1200 });
        return () => {
          window.cancelIdleCallback(idleId);
        };
      }

      const timeoutId = window.setTimeout(prewarm, 180);
      return () => {
        window.clearTimeout(timeoutId);
      };
    }, [effectiveSelectedVersionCode, prewarmSearchPool]);

    const handleRefChange = useCallback((nextRef: ParsedReference) => {
      setParsedRef(nextRef);
    }, []);

    const mergedRef = useMemo(
      () => ({
        ...parsedRef,
        versionCode: parsedRef.versionCode || effectiveSelectedVersionCode,
      }),
      [effectiveSelectedVersionCode, parsedRef],
    );

    const handleEnter = useCallback(
      async (val?: string) => {
        let activeParsed = parsedRef;
        if (val) {
          activeParsed = parseReference(val, availableBooks);
        }

        if (!activeParsed.book || !activeParsed.chapter) return;

        const version = activeParsed.versionCode || effectiveSelectedVersionCode || "NKJV";
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
          await onAddScriptureToService(selectedServiceId, refText, refText);
        }
      },
      [
        parsedRef,
        availableBooks,
        effectiveSelectedVersionCode,
        lookupRef,
        onSendToOutput,
        selectedServiceId,
        onAddScriptureToService,
      ],
    );

    const handleAcceptSuggestion = useCallback(
      async (reference: string) => {
        setSuggestion(null);
        syncLookupFromReference(reference);
        const parsed = parseReference(reference, availableBooks);
        if (!parsed.book || !parsed.chapter) return;

        const version = parsed.versionCode || effectiveSelectedVersionCode || "NKJV";
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
          await onAddScriptureToService(selectedServiceId, reference, reference);
        }
      },
      [
        availableBooks,
        effectiveSelectedVersionCode,
        lookupRef,
        onSendToOutput,
        selectedServiceId,
        onAddScriptureToService,
        setSuggestion,
        syncLookupFromReference,
      ],
    );

    useEffect(() => {
      if (!isActive) {
        return;
      }

      const query = textSearchQuery.trim();
      if (!query) {
        setTextSearchResults([]);
        return;
      }

      const requestId = textSearchRequestRef.current + 1;
      textSearchRequestRef.current = requestId;

      const timeoutId = window.setTimeout(async () => {
        const results = await searchVersesByText({
          query,
          versionCode: effectiveSelectedVersionCode,
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
        setIsTextSearching(false);
      };
    }, [
      isActive,
      effectiveSelectedVersionCode,
      searchVersesByText,
      setTextSearchResults,
      textSearchQuery,
    ]);

    useEffect(() => {
      if (!isActive) {
        return;
      }

      const query = liveTranscript.trim();
      if (!query) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSpeechSearchResults([]);
        return;
      }

      const requestId = speechSearchRequestRef.current + 1;
      speechSearchRequestRef.current = requestId;

      const timeoutId = window.setTimeout(async () => {
        const results = await searchVersesByText({
          query,
          versionCode: effectiveSelectedVersionCode,
          limit: 60,
        });

        if (speechSearchRequestRef.current !== requestId) {
          return;
        }
        setSpeechSearchResults(results);
      }, 90);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }, [
      isActive,
      effectiveSelectedVersionCode,
      liveTranscript,
      searchVersesByText,
    ]);

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
        await onAddScriptureToService(selectedServiceId, reference, reference);
      },
      [onAddScriptureToService, resolveVersionCode, selectedServiceId],
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
        await downloadVersion(version);
        setDownloadingHostedId(null);
      },
      [downloadVersion],
    );

    const handleUninstallVersion = useCallback(
      async (versionId: string) => {
        setRemovingVersionId(versionId);
        await uninstallVersion(versionId);
        setRemovingVersionId(null);
      },
      [uninstallVersion],
    );

    return (
      <ResizablePanelGroup direction="horizontal" className="flex h-full min-h-0 overflow-hidden bg-background">
        <ResizablePanel defaultSize={20} minSize={15} maxSize={30} className="flex shrink-0 flex-col border-r border-border/70 bg-card/40">
          <div className="border-b border-border/70 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Bible Versions
            </p>
            <div className="mt-3 flex flex-col gap-1.5 overflow-x-auto no-scrollbar pb-1">
              {availableVersions.length === 0 ? (
                <span className="text-[11px] text-muted-foreground px-1">No versions installed yet.</span>
              ) : (
                availableVersions.map((version) => (
                  <div
                    key={version.id}
                    className={cn(
                      "flex items-center justify-between gap-1 rounded-md border px-2 py-1.5 transition-colors",
                      effectiveSelectedVersionCode === version.code
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:bg-accent/20",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedVersionCode(version.code)}
                      className="flex-1 text-left text-[11px] font-semibold"
                    >
                      {version.code}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleUninstallVersion(version.id);
                      }}
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
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

          <div className="border-b border-border/70 px-3 py-2 bg-card/20">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Books
            </p>
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-auto p-2">
            {availableBooks.length === 0 ? (
              <p className="text-[10px] text-muted-foreground p-2">Install a version to see books.</p>
            ) : (
              availableBooks.map((book) => (
                <button
                  key={book.pk}
                  type="button"
                  onClick={() => {
                    setLookupValue(book.name + " ");
                    inputRef.current?.focus();
                  }}
                  className="flex w-full items-center rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  {book.name}
                </button>
              ))
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={80} className="flex min-w-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border/60 bg-card px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Content Control
                </h2>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Lookup references, search keywords, or use voice identification.
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
                  title="Import Bible File"
                >
                  <Upload className="h-3.5 w-3.5" />
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-accent/40"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    {isHostedCatalogLoading ? (
                      <div className="px-2 py-2 text-xs text-muted-foreground">
                        Loading hosted versions...
                      </div>
                    ) : hostedVersions.length === 0 ? (
                      <div className="space-y-2 px-2 py-2">
                        <p className="text-xs text-muted-foreground">No hosted versions available.</p>
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
                            <span className="block text-[10px] text-muted-foreground">{version.code}</span>
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
                  value={lookupValue}
                  onValueChange={setLookupValue}
                  availableBooks={availableBooks}
                  availableVersions={availableVersions}
                  placeholder={
                    effectiveSelectedVersionCode
                      ? `Lookup in ${effectiveSelectedVersionCode} (e.g. John 3:16)`
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
                    onChange={(event) => handleTextSearchQueryChange(event.target.value)}
                    placeholder="Type words to search"
                    className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs text-foreground outline-none focus:border-primary/60"
                  />
                  {isTextSearching ? (
                    <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
                  ) : null}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Speech to Search
                </p>
                <div className="flex items-center gap-1.5">
                  {isSupported ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (isListening) {
                          stopListening();
                          return;
                        }
                        if (isStarting) {
                          return;
                        }
                        handleAiQueryChange("");
                        void startListening();
                      }}
                      disabled={isStarting}
                      aria-busy={isStarting}
                      className={cn(
                        "relative inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors",
                        isListening
                          ? "border-red-600 bg-red-500 text-white"
                          : isStarting
                            ? "border-amber-500 bg-amber-500/10 text-amber-600"
                            : "border-border bg-background text-muted-foreground",
                        isStarting && "cursor-wait",
                      )}
                    >
                      {isListening ? (
                        <Mic className="h-4 w-4 animate-pulse" />
                      ) : isStarting ? (
                        <>
                          <span className="absolute right-1 top-1 flex h-2.5 w-2.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
                          </span>
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </>
                      ) : (
                        <MicOff className="h-4 w-4" />
                      )}
                    </button>
                  ) : null}
                  <div className="relative flex-1">
                    <input
                      value={liveTranscript}
                      onChange={(event) => handleAiQueryChange(event.target.value)}
                      placeholder="Listen or type text"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-primary/60"
                    />
                    {isIdentifying ? (
                      <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
                    ) : null}
                  </div>
                </div>
                {speechError ? (
                  <p className="text-[10px] text-destructive">{speechError}</p>
                ) : isStarting ? (
                  <p className="flex items-center gap-2 text-[10px] text-amber-600">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                    </span>
                    Starting microphone...
                  </p>
                ) : isListening ? (
                  <p className="text-[10px] text-primary">
                    Listening for scripture reference...
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="custom-scrollbar flex-1 overflow-y-auto p-4 space-y-6">
            <ScriptureResults
              parsedRef={mergedRef}
              onSendToOutput={onSendToOutput}
              onAddToService={
                selectedServiceId
                  ? (reference: string, text: string) =>
                      onAddScriptureToService(selectedServiceId, reference, text)
                  : undefined
              }
            />

            {textSearchQuery.trim().length > 0 && (
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="mb-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
                    Verse Search Results
                  </h3>
                </div>

                {textSearchResults.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No matches found.</p>
                ) : (
                  <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1 custom-scrollbar">
                    {textSearchResults.map((verse) => {
                      const versionCode = resolveVersionCode(verse.version);
                      const verseRef = `${verse.bookName} ${verse.chapter}:${verse.verse}${versionCode ? ` ${versionCode}` : ""}`;
                      return (
                        <div
                          key={verse.pk}
                          className="group rounded-md border border-border/60 bg-background/40 px-2 py-1.5 transition hover:border-primary/40 hover:bg-accent/20 [content-visibility:auto] [contain-intrinsic-size:80px]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => handleSendTextVerse(verse)}
                              className="flex-1 text-left"
                            >
                              <p className="text-[10px] font-semibold uppercase text-muted-foreground">{verseRef}</p>
                              <p className="text-xs text-foreground">{verse.text}</p>
                            </button>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                              <button
                                type="button"
                                onClick={() => handleSendTextVerse(verse)}
                                className="h-6 w-6 rounded border border-input text-muted-foreground"
                              >
                                <Monitor className="mx-auto h-3 w-3" />
                              </button>
                              {selectedServiceId && (
                                <button
                                  type="button"
                                  onClick={() => handleAddTextVerseToService(verse)}
                                  className="h-6 w-6 rounded border border-input text-muted-foreground"
                                >
                                  <Plus className="mx-auto h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {liveTranscript.trim().length > 0 && (
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="mb-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
                    Speech Search Results
                  </h3>
                </div>

                {speechSearchResults.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No matches found.</p>
                ) : (
                  <div className="space-y-1">
                    {speechSearchResults.map((verse) => {
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
                              onClick={() => handleSendTextVerse(verse)}
                              className="flex-1 text-left"
                            >
                              <p className="text-[10px] font-semibold uppercase text-muted-foreground">{verseRef}</p>
                              <p className="text-xs text-foreground">{verse.text}</p>
                            </button>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                              <button
                                type="button"
                                onClick={() => handleSendTextVerse(verse)}
                                className="h-6 w-6 rounded border border-input text-muted-foreground"
                              >
                                <Monitor className="mx-auto h-3 w-3" />
                              </button>
                              {selectedServiceId && (
                                <button
                                  type="button"
                                  onClick={() => handleAddTextVerseToService(verse)}
                                  className="h-6 w-6 rounded border border-input text-muted-foreground"
                                >
                                  <Plus className="mx-auto h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </ResizablePanel>

        {suggestion && (
          <SpeechScriptureSuggestion
            reference={suggestion}
            onAccept={handleAcceptSuggestion}
            onDismiss={() => setSuggestion(null)}
          />
        )}
      </ResizablePanelGroup>
    );
  }),
);
