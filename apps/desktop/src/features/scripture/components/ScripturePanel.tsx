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
import {
  findReferenceInSentence,
  findRelativeReference,
  parseReference,
  type ParsedReference,
} from "../lib/parser";
import { understandSpokenScripture } from "../../../renderer/tauri/scripture";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { cn } from "../../../renderer/shared/lib/utils";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { useScripture, type HostedBibleVersion } from "../hooks/useScripture";
import {
  generateBibleSlides,
  getActiveScriptureVersePk,
  type ScriptureSlide,
} from "../lib/slides";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
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
  Check,
  ChevronDown,
} from "lucide-react";
import { ScriptureInput, type ScriptureInputRef } from "./ScriptureInput";
import type { BibleVerse } from "../lib/db";
import { ScriptureResults } from "./ScriptureResults";
import { useDesktopSessionStore } from "../../../renderer/shared/store/desktopSession";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../renderer/shared/components/ui/dropdown-menu";

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
  /** What the Bible agent does with what it hears (Settings, Agent). */
  bibleAgent?: BibleAgentSettings;
  activeSlideId?: string | null;
}


/** A reference as the Bible tab's own box reads one: "John 3:16-18". */
const asLookup = ({ book, chapter, verseStart, verseEnd }: ParsedReference): string => {
  let spoken = `${book?.name ?? ""} ${chapter ?? 1}`;
  if (verseStart) {
    spoken += `:${verseStart}`;
    if (verseEnd) {
      spoken += `-${verseEnd}`;
    }
  }
  return spoken;
};

export interface BibleAgentSettings {
  /** A heard passage goes on screen, or waits here to be shown. */
  onHeard: "show" | "find";
  addToService: boolean;
  voiceCommands: boolean;
}

const DEFAULT_BIBLE_AGENT: BibleAgentSettings = {
  onHeard: "show",
  addToService: true,
  voiceCommands: true,
};

const isNextVerseCommand = (value: string) =>
  /\b(next|forward)\s+(verse|scripture)\b/i.test(value.trim());

const isPreviousVerseCommand = (value: string) =>
  /\b(prev|previous|back|backward)\s+(verse|scripture)\b/i.test(value.trim());

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
      bibleAgent = DEFAULT_BIBLE_AGENT,
      activeSlideId = null,
    },
    ref,
  ) {
    const { onHeard, addToService: addHeardToService, voiceCommands } = bibleAgent;
    const inputRef = useRef<ScriptureInputRef>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const identifyTimeoutRef = useRef<number | null>(null);
    const textSearchRequestRef = useRef(0);
    const [downloadingHostedId, setDownloadingHostedId] = useState<string | null>(null);
    const [removingVersionId, setRemovingVersionId] = useState<string | null>(null);
    /**
     * The last sentence the speaker actually finished.
     *
     * Speech arrives as a stream of guesses that are revised until the speaker
     * stops, and asking the model about each one asks it about half a
     * sentence, several times over, with the answers racing each other back.
     * On a metered plan it is also the difference between one request per
     * reference and a dozen — enough to be rate-limited part way through a
     * service, which looks from the operator's seat exactly like the agent
     * not working.
     */
    const [heardSentence, setHeardSentence] = useState("");

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
      findQuotedVerseInText,
      prewarmSearchPool,
      downloadVersion,
      hostedVersions,
      isHostedCatalogLoading,
      refreshHostedCatalog,
    } = useScripture();
    /**
     * The catalog, minus what is already here.
     *
     * The list above this one is what the operator has installed; without this
     * the same Bible appears in both, the second time still offering to
     * download it. Matched on the version code rather than the id, because a
     * bundled file's id comes from the catalog and an imported one's comes
     * from the file — the same Bible arrives under two ids, and only the code
     * is the same on both sides.
     */
    const installableVersions = useMemo(() => {
      const installed = new Set(
        availableVersions.flatMap((version) =>
          [version.code, version.id].filter(Boolean).map((value) => value.toLowerCase()),
        ),
      );
      return hostedVersions.filter(
        (version) =>
          !installed.has(version.code.toLowerCase())
          && !installed.has(version.id.toLowerCase()),
      );
    }, [availableVersions, hostedVersions]);

    const lookupValue = useScripturePanelStore((state) => state.lookupValue);
    const setLookupValue = useScripturePanelStore((state) => state.setLookupValue);
    const selectedVersionCode = useScripturePanelStore(
      (state) => state.selectedVersionCode,
    );
    const setSelectedVersionCode = useScripturePanelStore(
      (state) => state.setSelectedVersionCode,
    );
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
    const searchMode = useScripturePanelStore((state) => state.searchMode);
    const setSearchMode = useScripturePanelStore((state) => state.setSearchMode);
    const [parsedRef, setParsedRef] = useState<ParsedReference>({
      book: null,
      chapter: null,
      verseStart: null,
      verseEnd: null,
      versionCode: null,
      errors: [],
    });
    const [isTextSearching, setIsTextSearching] = useState(false);
    const wasActiveRef = useRef(isActive);
    const activeVersePk = getActiveScriptureVersePk(activeSlideId);

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

    const getAdjacentVerse = useCallback(
      async (verse: BibleVerse, direction: "next" | "previous") => {
        const sameChapterVerses = await db.verses
          .where("[version+bookId+chapter]")
          .equals([verse.version, verse.bookId, verse.chapter])
          .toArray();
        const sortedSameChapter = sameChapterVerses.sort(
          (left, right) => left.verse - right.verse,
        );
        const adjacentInChapter =
          direction === "next"
            ? sortedSameChapter.find((item) => item.verse > verse.verse)
            : [...sortedSameChapter]
                .reverse()
                .find((item) => item.verse < verse.verse);
        if (adjacentInChapter) {
          return adjacentInChapter;
        }

        const book = allBooks.find(
          (item) => item.version === verse.version && item.id === verse.bookId,
        );
        const adjacentChapter =
          direction === "next" ? verse.chapter + 1 : verse.chapter - 1;
        if (
          adjacentChapter < 1 ||
          (book?.chapters && adjacentChapter > book.chapters)
        ) {
          return null;
        }

        const adjacentChapterVerses = await db.verses
          .where("[version+bookId+chapter]")
          .equals([verse.version, verse.bookId, adjacentChapter])
          .toArray();
        const sortedAdjacentChapter = adjacentChapterVerses.sort(
          (left, right) => left.verse - right.verse,
        );
        return direction === "next"
          ? sortedAdjacentChapter[0] ?? null
          : sortedAdjacentChapter[sortedAdjacentChapter.length - 1] ?? null;
      },
      [allBooks],
    );

    const getLiveScriptureVerse = useCallback(async () => {
      if (!activeVersePk) {
        return null;
      }
      return (await db.verses.get(activeVersePk)) ?? null;
    }, [activeVersePk]);

    const handleAiQueryChange = useCallback(
      (value: string) => {
        setLiveTranscript(value);
      },
      [setLiveTranscript],
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

    const showAdjacentLiveVerse = useCallback(
      async (direction: "next" | "previous") => {
        const verse = await getLiveScriptureVerse();
        if (!verse) {
          return;
        }

        const adjacentVerse = await getAdjacentVerse(verse, direction);
        if (!adjacentVerse) {
          return;
        }

        void handleSendTextVerse(adjacentVerse);
      },
      [
        formatReference,
        getAdjacentVerse,
        getLiveScriptureVerse,
        handleSendTextVerse,
        resolveVersionCode,
      ],
    );

    // Find it: what AssemblyAI heard, read here with no model, while it is
    // still being said. A reference named in the sentence, a verse or chapter
    // said on its own within the passage already open, or a verse quoted
    // word for word; whichever reads first is put in the box. Nothing goes on
    // screen until the operator shows it.
    const openPassageRef = useRef(parsedRef);
    useEffect(() => {
      openPassageRef.current = parsedRef;
    }, [parsedRef]);
    const findRequestRef = useRef(0);
    const findFromSpeech = useCallback(
      (heard: string, finished: boolean) => {
        const text = heard.trim();
        if (!text) return;
        const request = ++findRequestRef.current;
        const fill = (spoken: string) => {
          // An answer to words since added to is not the newest; one already
          // in the box is not put there again.
          if (request !== findRequestRef.current) return;
          if (useScripturePanelStore.getState().lookupValue === spoken) return;
          setLookupValue(spoken);
        };
        const named =
          findReferenceInSentence(text, availableBooks) ??
          findRelativeReference(text, openPassageRef.current);
        if (named?.book) {
          fill(asLookup(named));
          return;
        }
        void findQuotedVerseInText({
          query: text,
          versionCode: effectiveSelectedVersionCode,
          // Every installed version once the sentence is finished; the one
          // chosen while it is still being said.
          everyVersion: finished,
        })
          .then((verse) => {
            if (verse) fill(`${verse.bookName} ${verse.chapter}:${verse.verse}`);
          })
          .catch((): void => undefined);
      },
      [availableBooks, effectiveSelectedVersionCode, findQuotedVerseInText, setLookupValue],
    );

    const onSpeechResult = useCallback(
      (result: { transcript: string; isFinal: boolean }) => {
        if (!result.transcript) return;
        const transcript = result.transcript.trim();

        if (voiceCommands && result.isFinal && isNextVerseCommand(transcript)) {
          void showAdjacentLiveVerse("next");
          return;
        }

        if (voiceCommands && result.isFinal && isPreviousVerseCommand(transcript)) {
          void showAdjacentLiveVerse("previous");
          return;
        }

        handleAiQueryChange(result.transcript);

        if (onHeard === "find") {
          findFromSpeech(transcript, result.isFinal);
        }

        if (!result.isFinal) {
          return;
        }

        // Finished, so it is worth asking about.
        setHeardSentence(transcript);

        // What happens next is the transcript effect's, which asks the model
        // about everything that was heard. Asking here as well would ask
        // twice about the same sentence and race its own answer.
      },
      [findFromSpeech, handleAiQueryChange, onHeard, showAdjacentLiveVerse, voiceCommands],
    );

    // The installed books' names, for AssemblyAI to listen for: "Habakkuk"
    // and "Philemon" are heard as names, not as sounds near them.
    const bookKeyterms = useMemo(
      () => Array.from(new Set(availableBooks.map((book) => book.name))),
      [availableBooks],
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
        keyterms: bookKeyterms,
        usageSource: "bible",
      });

    // Find it looks for a quote in every installed version once a sentence is
    // finished. Each version's words are indexed once, a few hundred
    // milliseconds apiece, so it is done as listening starts, one at a time
    // with a pause between, rather than in front of the first quote.
    useEffect(() => {
      if (!isListening || onHeard !== "find") return;
      let cancelled = false;
      void (async () => {
        for (const version of availableVersions) {
          await new Promise((resolve) => window.setTimeout(resolve, 150));
          if (cancelled) return;
          await prewarmSearchPool(version.code).catch((): void => undefined);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [availableVersions, isListening, onHeard, prewarmSearchPool]);

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

      textSearchRequestRef.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsTextSearching(false);

      wasActiveRef.current = false;
    }, [
      isActive,
    ]);




    useEffect(() => {
      if (!effectiveSelectedVersionCode) {
        return;
      }

      void prewarmSearchPool(effectiveSelectedVersionCode);
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
      async (val?: string, options?: { addToService?: boolean }) => {
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

        if (selectedServiceId && options?.addToService !== false) {
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

    useEffect(() => {
      if (!isActive) {
        return;
      }

      if (identifyTimeoutRef.current !== null) {
        window.clearTimeout(identifyTimeoutRef.current);
        identifyTimeoutRef.current = null;
      }

      const text = heardSentence.trim();
      // Find it reads what is heard as it is said (`findFromSpeech`); this
      // is Show it's, which asks the model about each finished sentence.
      if (!text || onHeard === "find") {
        return;
      }

      identifyTimeoutRef.current = window.setTimeout(() => {
        // Show it: everything that was heard goes to the model. AssemblyAI
        // turns sound into a sentence and the model decides what the
        // sentence meant. It answers `null` for anything it is unsure of,
        // and for everything when nobody is signed in or it cannot be
        // reached — in which case this behaves exactly as it did before.
        void understandSpokenScripture(sessionToken ?? "", text, availableBooks)
          .then((understood) => {
            // Anything it could not read is left alone: there is no list of
            // maybes to pick from, because nobody running a service has a
            // hand free to pick from one.
            if (!understood?.reference.book) {
              return;
            }
            // Found either way; on screen only when the model is sure
            // (`scripture_agent::PROJECT_AT`). "God is good all the time"
            // named a Psalm, less sure, and waits here instead.
            const spoken = asLookup(understood.reference);
            setLookupValue(spoken);
            if (understood.mayProject) {
              void handleEnter(spoken, { addToService: addHeardToService });
            }
          })
          .catch(() => {
            // Offline, signed out, or the model could not be reached. The
            // operator types it, exactly as before.
          });
      }, isListening ? 100 : 260);

      return () => {
        if (identifyTimeoutRef.current !== null) {
          window.clearTimeout(identifyTimeoutRef.current);
          identifyTimeoutRef.current = null;
        }
      };
    }, [
      isActive,
      heardSentence,
      availableBooks,
      isListening,
      sessionToken,
      handleEnter,
      setLookupValue,
      onHeard,
      addHeardToService,
    ]);

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
          mode: searchMode,
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
      searchMode,
      setTextSearchResults,
      textSearchQuery,
    ]);

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
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        {/* One row: which Bible, a reference, a search, and the microphone.
            The sidebar of versions and books, and the heading that described
            the row underneath it, took a third of the panel to say what the
            controls already say. */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="Bible version"
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-white/5 px-2.5 text-[11px] font-semibold tracking-wide text-foreground ring-1 ring-white/10 transition hover:ring-white/25"
              >
                {effectiveSelectedVersionCode || "No version"}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              {availableVersions.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  No versions installed yet.
                </div>
              ) : (
                availableVersions.map((version) => (
                  <DropdownMenuItem
                    key={version.id}
                    onClick={() => setSelectedVersionCode(version.code)}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{version.code}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {version.name}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      {effectiveSelectedVersionCode === version.code ? (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      ) : null}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleUninstallVersion(version.id);
                        }}
                        title="Remove version"
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                      >
                        {removingVersionId === version.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </span>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              {isHostedCatalogLoading ? (
                <div className="px-2 py-2 text-xs text-muted-foreground">Loading versions…</div>
              ) : installableVersions.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  {hostedVersions.length === 0
                    ? "No other versions available."
                    : "Every available version is installed."}
                </div>
              ) : (
                installableVersions.map((version) => (
                  <DropdownMenuItem
                    key={version.id}
                    onClick={() => {
                      void handleDownloadHostedVersion(version);
                    }}
                    disabled={downloadingHostedId === version.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs">{version.name}</span>
                      <span className="block text-[10px] text-muted-foreground">{version.code}</span>
                    </span>
                    {downloadingHostedId === version.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5 opacity-60" />
                    )}
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => importInputRef.current?.click()} className="gap-2">
                <Upload className="h-3.5 w-3.5" />
                Import a Bible file
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void refreshHostedCatalog();
                }}
                className="gap-2"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isHostedCatalogLoading && "animate-spin")} />
                Refresh the list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <input
            ref={importInputRef}
            type="file"
            accept=".zip,.json,.xml"
            className="hidden"
            onChange={(event) => {
              void handleManualImport(event);
            }}
          />

          <div className="min-w-0 flex-1">
            <ScriptureInput
              ref={inputRef}
              onRefChange={handleRefChange}
              value={lookupValue}
              onValueChange={setLookupValue}
              availableBooks={availableBooks}
              availableVersions={availableVersions}
              placeholder={
                effectiveSelectedVersionCode
                  ? `Reference — John 3:16`
                  : "Reference"
              }
              onEnter={handleEnter}
            />
          </div>

          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <input
              value={textSearchQuery}
              onChange={(event) => handleTextSearchQueryChange(event.target.value)}
              placeholder={searchMode === "exact" ? "Search an exact phrase" : "Search words"}
              className="h-8 w-full rounded-md bg-white/4 pl-8 pr-16 text-xs text-foreground ring-1 ring-white/10 outline-hidden transition focus:ring-primary/50"
            />
            {isTextSearching ? (
              <Loader2 className="absolute right-12 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
            ) : null}
            <button
              type="button"
              aria-pressed={searchMode === "exact"}
              onClick={() => setSearchMode(searchMode === "exact" ? "broad" : "exact")}
              title={searchMode === "exact" ? "Matching the exact phrase" : "Matching words and variations"}
              className={cn(
                "absolute right-1 top-1/2 h-6 -translate-y-1/2 rounded px-1.5 text-[9px] font-bold uppercase tracking-wide transition",
                searchMode === "exact"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground/70 hover:bg-white/8 hover:text-foreground",
              )}
            >
              Exact
            </button>
          </div>

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
                if (effectiveSelectedVersionCode) {
                  void prewarmSearchPool(effectiveSelectedVersionCode);
                }
                void startListening();
              }}
              disabled={isStarting}
              aria-busy={isStarting}
              aria-pressed={isListening}
              title={
                speechError
                  ? speechError
                  : isListening
                    ? "Listening — click to stop"
                    : isStarting
                      ? "Starting the microphone…"
                      : "Listen for a reference"
              }
              className={cn(
                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1 transition",
                isListening
                  ? "bg-red-500 text-white ring-red-400"
                  : isStarting
                    ? "bg-amber-500/10 text-amber-500 ring-amber-500/40"
                    : "bg-white/4 text-muted-foreground ring-white/10 hover:text-foreground hover:ring-white/25",
                isStarting && "cursor-wait",
              )}
            >
              {isListening ? (
                <Mic className="h-4 w-4 animate-pulse" />
              ) : isStarting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MicOff className="h-4 w-4" />
              )}
            </button>
          ) : null}
        </div>

        {activeImport ? (
          <div className="shrink-0 px-3 pb-2">
            <div className="mb-1 flex items-center justify-between text-[10px] capitalize text-muted-foreground">
              <span>{activeImport.phase}</span>
              <span>{activeImport.percent}%</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full bg-primary transition-all duration-200"
                style={{ width: `${activeImport.percent}%` }}
              />
            </div>
          </div>
        ) : null}

        {liveTranscript.trim() || isListening ? (
          <div className="shrink-0 border-b border-border/40 px-3 py-1.5">
            <p className="truncate text-[11px] text-muted-foreground">
              <span className="mr-1.5 text-primary">●</span>
              {liveTranscript.trim() || "Listening…"}
            </p>
          </div>
        ) : null}

          <div className="custom-scrollbar flex-1 overflow-y-auto p-4 space-y-6">
            <ScriptureResults
              parsedRef={mergedRef}
              activeVersePk={activeVersePk}
              onSendToOutput={onSendToOutput}
              onAddToService={
                selectedServiceId
                  ? (reference: string, text: string) =>
                      onAddScriptureToService(selectedServiceId, reference, text)
                  : undefined
              }
              onStep={setLookupValue}
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
                      const isLive = verse.pk === activeVersePk;
                      return (
                        <div
                          key={verse.pk}
                          aria-current={isLive ? "true" : undefined}
                          className={cn(
                            "group rounded-md border px-2 py-1.5 transition [content-visibility:auto] [contain-intrinsic-size:80px]",
                            isLive
                              ? "border-emerald-400/60 bg-emerald-400/8"
                              : "border-border/60 bg-background/40 hover:border-primary/40 hover:bg-accent/20",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => handleSendTextVerse(verse)}
                              className="flex-1 text-left"
                            >
                              <p className={cn("text-[10px] font-semibold uppercase", isLive ? "text-emerald-400" : "text-muted-foreground")}>
                                {verseRef}{isLive ? " · LIVE" : ""}
                              </p>
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
      </div>
    );
  }),
);
