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
import { knowVerseCounts, parseReference, type ParsedReference } from "../lib/parser";
import { verseCountOf } from "../lib/canonical-verses";
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
import { useSpeechRecognition, type ScriptRecognitionResult } from "../hooks/useSpeechRecognition";
import { useHeardScripture } from "../hooks/useHeardScripture";
import { versionKeyterms } from "../lib/listening";
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
  BookOpen,
  Star,
  X,
} from "lucide-react";
import { ScriptureInput, type ScriptureInputRef } from "./ScriptureInput";
import type { BibleVerse } from "../lib/db";
import { ScriptureResults } from "./ScriptureResults";
import { BookChapterBrowser } from "./BookChapterBrowser";
import { highlightText } from "../lib/highlighter";
import { toast } from "sonner";
import { useDesktopSessionStore } from "../../../renderer/shared/store/desktopSession";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../renderer/shared/components/ui/dropdown-menu";

// What lets a reference heard as one number ("psalm 1191") be read at once,
// before the speech service formats it (`parser.ts`).
knowVerseCounts(verseCountOf);

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
    const textSearchRequestRef = useRef(0);
    const [downloadingHostedId, setDownloadingHostedId] = useState<string | null>(null);
    const [removingVersionId, setRemovingVersionId] = useState<string | null>(null);
    const [showBrowser, setShowBrowser] = useState(true);

    useImperativeHandle(ref, () => ({
      focusSearch: () => {
        inputRef.current?.focus();
      },
    }));

    const liveBooks = useLiveQuery(() => db.books.toArray());
    const allBooks = useMemo(() => liveBooks ?? [], [liveBooks]);
    const liveVersions = useLiveQuery(() => db.versions.toArray());
    const availableVersions = useMemo(() => liveVersions ?? [], [liveVersions]);

    const [mainViewMode, setMainViewMode] = useState<"reader" | "search">("reader");

    const [favoriteVersions, setFavoriteVersions] = useState<string[]>(() => {
      try {
        const raw = localStorage.getItem("present:favorite_bible_versions");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed.map((s) => String(s).toUpperCase());
        }
      } catch {}
      return [];
    });

    const toggleFavoriteVersion = useCallback((code: string) => {
      const upper = code.toUpperCase();
      setFavoriteVersions((prev) => {
        const next = prev.includes(upper) ? prev.filter((c) => c !== upper) : [...prev, upper];
        try {
          localStorage.setItem("present:favorite_bible_versions", JSON.stringify(next));
        } catch {}
        return next;
      });
    }, []);

    const sortedInstalledVersions = useMemo(() => {
      return [...availableVersions].sort((a, b) => {
        const aFav = favoriteVersions.includes(a.code.toUpperCase());
        const bFav = favoriteVersions.includes(b.code.toUpperCase());
        if (aFav && !bFav) return -1;
        if (!aFav && bFav) return 1;
        return a.code.localeCompare(b.code);
      });
    }, [availableVersions, favoriteVersions]);

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
    // A word-search row the operator opened. Empty follows the top match.
    const [pinnedSearchPk, setPinnedSearchPk] = useState<string | null>(null);
    // Which search last asked the browser to move: the reference box and the
    // Bible agent, or the word search.
    const [browserSource, setBrowserSource] = useState<"reference" | "search">("reference");
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
      if (activeVersePk) {
        const live = await db.verses.get(activeVersePk);
        if (live) return live;
      }
      // Fallback: If no slide is currently live, check the open passage in the panel
      const open = openPassageRef.current;
      if (open?.book && open.chapter) {
        const verseNum = open.verseStart ?? 1;
        const version = effectiveSelectedVersionCode;
        if (version) {
          const match = await db.verses
            .where("[version+bookId+chapter]")
            .equals([version, open.book.id, open.chapter])
            .filter((v) => v.verse === verseNum)
            .first();
          if (match) return match;
        }
      }
      return null;
    }, [activeVersePk, effectiveSelectedVersionCode]);

    const handleAiQueryChange = useCallback(
      (value: string) => {
        setLiveTranscript(value);
      },
      [setLiveTranscript],
    );

    const handleTextSearchQueryChange = useCallback((value: string) => {
      setTextSearchQuery(value);
      setPinnedSearchPk(null);
      if (!value.trim()) {
        setTextSearchResults([]);
        setIsTextSearching(false);
        setBrowserSource("reference");
        return;
      }
      setBrowserSource("search");
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

    const openSearchVerse = useCallback((verse: BibleVerse) => {
      setPinnedSearchPk(verse.pk);
      void handleSendTextVerse(verse);
    }, [handleSendTextVerse]);

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

        // 1. Send the adjacent verse live to screen/preview
        void handleSendTextVerse(adjacentVerse);

        // 2. Keep the panel, search input, and reader in sync
        const open = openPassageRef.current;
        const isChapterOnly = open?.book && open.chapter && open.verseStart === null;

        if (isChapterOnly && adjacentVerse.chapter === verse.chapter) {
          // If viewing the entire chapter and staying in the same chapter, keep the chapter view open.
          // activeVersePk will highlight the adjacent live verse.
        } else {
          // Single verse view (e.g. Genesis 1:1) or crossing to a new chapter:
          // Update the search box and panel view to the new reference.
          const refString = isChapterOnly
            ? `${adjacentVerse.bookName} ${adjacentVerse.chapter}`
            : `${adjacentVerse.bookName} ${adjacentVerse.chapter}:${adjacentVerse.verse}`;
          setLookupValue(refString);
        }

        setMainViewMode("reader");
      },
      [
        getAdjacentVerse,
        getLiveScriptureVerse,
        handleSendTextVerse,
        setLookupValue,
      ],
    );

    // The passage in the box, for "verse eighteen" said on its own.
    const openPassageRef = useRef(parsedRef);
    useEffect(() => {
      openPassageRef.current = parsedRef;
    }, [parsedRef]);
    // Show it puts a passage on screen as the box's own Enter would.
    const showRef = useRef<
      ((value?: string, options?: { addToService?: boolean }) => Promise<void>) | null
    >(null);

    const { hear, forget: forgetHeard } = useHeardScripture({
      enabled: isActive,
      onHeard,
      addToService: addHeardToService,
      sessionToken,
      books: availableBooks,
      versions: availableVersions,
      catalog: installableVersions,
      install: async (code) => {
        const version = installableVersions.find((candidate) => candidate.code === code);
        if (!version) return false;
        await handleDownloadHostedVersion(version);
        return (await db.versions.toArray()).some((installed) => installed.code === code);
      },
      chosenVersionCode: effectiveSelectedVersionCode,
      openPassage: () => openPassageRef.current,
      fill: (lookup) => {
        if (useScripturePanelStore.getState().lookupValue !== lookup) {
          setLookupValue(lookup);
        }
      },
      show: (lookup, options) => {
        void showRef.current?.(lookup, options);
      },
      chooseVersion: setSelectedVersionCode,
      findQuotedVerse: findQuotedVerseInText,
      versionCodeOf: resolveVersionCode,
      readChapter: async (book, chapter, versionCode) =>
        (
          await lookupRef({
            book,
            chapter,
            verseStart: null,
            verseEnd: null,
            versionCode,
            errors: [],
          })
        ).map(({ verse, text }) => ({ verse, text })),
    });

    const onSpeechResult = useCallback(
      (result: ScriptRecognitionResult) => {
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

        // Feed the real-time Bible agent: full transcript event with turns and word timing when available
        if (result.turn !== undefined || result.words) {
          hear({
            session: 1,
            turn: result.turn ?? 0,
            transcript,
            endOfTurn: Boolean(result.endOfTurn ?? result.isFinal),
            // As the transcript buffer reads them: `final` is what tells a
            // word still being said from one that will not change.
            words: result.words?.map((w) => ({
              text: w.text,
              start: w.start,
              end: w.end,
              confidence: w.confidence,
              final: w.word_is_final,
            })),
            receivedAt: Date.now(),
          });
        } else {
          // Fallback for simple string/final emissions
          hear(transcript, result.isFinal);
        }
      },
      [handleAiQueryChange, hear, showAdjacentLiveVerse, voiceCommands],
    );

    // The installed books' and Bibles' names, for AssemblyAI to listen for:
    // "Habakkuk" and "Philemon" are heard as names, not as sounds near them,
    // and "KJV" as the Bible.
    const bookKeyterms = useMemo(
      () =>
        Array.from(
          new Set([
            ...availableBooks.map((book) => book.name),
            ...versionKeyterms(availableVersions),
            ...versionKeyterms(installableVersions),
          ]),
        ),
      [availableBooks, availableVersions, installableVersions],
    );

    const {
      isListening,
      isStarting,
      isSupported,
      startListening,
      stopListening,
    } =
      useSpeechRecognition({
        onResult: onSpeechResult,
        lang: speechLang,
        inputDeviceId: speechInputDeviceId,
        sessionToken,
        keyterms: bookKeyterms,
        usageSource: "bible",
      });

    // A verse read aloud is looked for in every installed Bible, to find the
    // one it is being read from. Each Bible's words are indexed once, a few
    // hundred milliseconds apiece, so it is done as listening starts, one at
    // a time with a pause between, rather than in front of the first quote.
    useEffect(() => {
      if (!isListening) {
        forgetHeard();
        setLiveTranscript("");
        return;
      }
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
    }, [availableVersions, forgetHeard, isListening, prewarmSearchPool]);

    useEffect(() => {
      if (isActive) {
        wasActiveRef.current = true;
        return;
      }

      if (!wasActiveRef.current) {
        return;
      }

      // Cancel any in-flight async requests so stale results don't land later
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
      if (nextRef.book) setBrowserSource("reference");
    }, []);

    const mergedRef = useMemo(
      () => ({
        ...parsedRef,
        versionCode: parsedRef.versionCode || effectiveSelectedVersionCode,
      }),
      [effectiveSelectedVersionCode, parsedRef],
    );

    // Word search opens the top match, or the row that was chosen. The
    // reference box and the Bible agent both land in mergedRef.
    const searchFocus = useMemo(() => {
      const query = textSearchQuery.trim();
      if (!query || textSearchResults.length === 0) return null;
      return (
        textSearchResults.find((verse) => verse.pk === pinnedSearchPk) ??
        textSearchResults[0]
      );
    }, [pinnedSearchPk, textSearchQuery, textSearchResults]);

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
      showRef.current = handleEnter;
    }, [handleEnter]);

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
        const versionCode = resolveVersionCode(verse.version);
        const reference = `${verse.bookName} ${verse.chapter}:${verse.verse}${versionCode ? ` ${versionCode}` : ""}`;
        if (selectedServiceId) {
          await onAddScriptureToService(selectedServiceId, reference, reference);
          toast.success(`Added ${reference} to service`);
        } else {
          toast.info("Please select a service in the right panel to add scripture to it.");
        }
      },
      [onAddScriptureToService, resolveVersionCode, selectedServiceId],
    );

    const handleAddVerseToServiceSafe = useCallback(
      async (reference: string, text: string) => {
        if (selectedServiceId) {
          await onAddScriptureToService(selectedServiceId, reference, text);
          toast.success(`Added ${reference} to service`);
        } else {
          toast.info("Please select a service in the right panel to add scripture to it.");
        }
      },
      [selectedServiceId, onAddScriptureToService],
    );

    const handleSelectPassageFromBrowser = useCallback(
      async (bookName: string, chapter: number, verse?: number | null) => {
        const refString = verse ? `${bookName} ${chapter}:${verse}` : `${bookName} ${chapter}`;
        setLookupValue(refString);
        setMainViewMode("reader");

        // When a verse is clicked, send it live to screen immediately!
        if (verse) {
          const parsed = parseReference(refString, availableBooks);
          const version = effectiveSelectedVersionCode;
          const verses = await lookupRef({
            ...parsed,
            versionCode: version,
          });

          if (verses.length > 0) {
            const targetVerse = verses.find((v) => v.verse === verse) ?? verses[0];
            const versionName = version || resolveVersionCode(targetVerse.version);
            const slides = generateBibleSlides([targetVerse], {
              verseNumberMode: "inline",
              maxLines: 40,
              maxCharsPerLine: 100,
              versionName,
            });
            onSendToOutput(slides);

            if (selectedServiceId && addHeardToService) {
              const fullRef = `${targetVerse.bookName} ${targetVerse.chapter}:${targetVerse.verse}${versionName ? ` ${versionName}` : ""}`;
              void onAddScriptureToService(selectedServiceId, fullRef, fullRef);
            }
          }
        }
      },
      [
        availableBooks,
        effectiveSelectedVersionCode,
        lookupRef,
        onSendToOutput,
        resolveVersionCode,
        selectedServiceId,
        addHeardToService,
        onAddScriptureToService,
      ],
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
        {/* Top Control Bar: Books browser toggle, installed version pills (favorites first), download dropdown, mic */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-2 bg-card/40">
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-0.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setShowBrowser((prev) => !prev)}
              aria-pressed={showBrowser}
              title={showBrowser ? "Hide Book, Chapter & Verse Browser" : "Show Book, Chapter & Verse Browser"}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold ring-1 transition",
                showBrowser
                  ? "bg-primary/20 text-primary ring-primary/40"
                  : "bg-white/4 text-muted-foreground ring-white/10 hover:text-foreground hover:ring-white/25",
              )}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>Books</span>
            </button>

            <div className="h-4 w-px bg-border/60 shrink-0 mx-1" />

            {/* Installed Bible Version Pills (Favorites First) */}
            <div className="flex items-center gap-1 shrink-0">
              {sortedInstalledVersions.map((version) => {
                const isSelected =
                  effectiveSelectedVersionCode?.toUpperCase() === version.code.toUpperCase();
                return (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => setSelectedVersionCode(version.code)}
                    title={`${version.name} (${version.code})`}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs font-semibold ring-1 transition",
                      isSelected
                        ? "bg-primary text-primary-foreground ring-primary shadow-xs"
                        : "bg-white/5 text-muted-foreground ring-white/10 hover:bg-white/10 hover:text-foreground",
                    )}
                  >
                    <span>{version.code}</span>
                  </button>
                );
              })}
            </div>

            {/* Download Bible Version Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="Download more Bible versions or import"
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-white/5 px-2.5 text-xs font-medium text-muted-foreground ring-1 ring-white/10 transition hover:bg-white/10 hover:text-foreground"
                >
                  <Download className="h-3.5 w-3.5 text-primary" />
                  <span>Download Version</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72 max-h-[460px] overflow-y-auto custom-scrollbar">
                {/* Downloaded Versions at Top */}
                <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Downloaded Versions ({availableVersions.length})
                </div>
                {availableVersions.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground italic">
                    No versions downloaded yet.
                  </div>
                ) : (
                  availableVersions.map((version) => {
                    const isFav = favoriteVersions.includes(version.code.toUpperCase());
                    return (
                      <div
                        key={version.id}
                        className="flex items-center justify-between px-2 py-1.5 text-xs hover:bg-muted/50 rounded-sm group transition"
                      >
                        <div
                          className="flex-1 min-w-0 cursor-pointer pr-1"
                          onClick={() => setSelectedVersionCode(version.code)}
                          title={`Switch to ${version.code}`}
                        >
                          <span className="font-semibold text-foreground">{version.code}</span>
                          <span className="text-[10px] text-muted-foreground ml-1.5 truncate">
                            ({version.name})
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavoriteVersion(version.code);
                            }}
                            title={
                              isFav
                                ? "Remove favorite (starred versions appear first)"
                                : "Mark as favorite (starred versions appear first)"
                            }
                            className={cn(
                              "p-1 rounded hover:bg-white/10 transition",
                              isFav
                                ? "text-amber-400"
                                : "text-muted-foreground/40 hover:text-foreground",
                            )}
                          >
                            <Star className={cn("h-3.5 w-3.5", isFav && "fill-amber-400 text-amber-400")} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleUninstallVersion(version.id);
                            }}
                            title="Uninstall version"
                            className="p-1 rounded text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive transition"
                          >
                            {removingVersionId === version.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}

                <DropdownMenuSeparator />

                {/* Available for Download Section */}
                <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Available for Download
                </div>
                {isHostedCatalogLoading ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading available versions…</span>
                  </div>
                ) : installableVersions.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground italic">
                    {hostedVersions.length === 0
                      ? "No other versions available."
                      : "All catalog versions are installed."}
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
                        <span className="block truncate text-xs font-medium">{version.name}</span>
                        <span className="block text-[10px] text-muted-foreground">{version.code}</span>
                      </span>
                      {downloadingHostedId === version.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5 opacity-60 text-primary" />
                      )}
                    </DropdownMenuItem>
                  ))
                )}

                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Options & Import
                </div>
                <DropdownMenuItem onClick={() => importInputRef.current?.click()} className="gap-2">
                  <Upload className="h-3.5 w-3.5" />
                  <span>Import a Bible file (.zip, .json, .xml)</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    void refreshHostedCatalog();
                  }}
                  className="gap-2"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", isHostedCatalogLoading && "animate-spin")} />
                  <span>Refresh catalog</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <input
            ref={importInputRef}
            type="file"
            accept=".zip,.json,.xml"
            className="hidden"
            onChange={(event) => {
              void handleManualImport(event);
            }}
          />

          {/* Right: Microphone */}
          {isSupported ? (
            <button
              type="button"
              onClick={() => {
                if (isListening) {
                  stopListening();
                  handleAiQueryChange("");
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
                isListening
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

        {/* Search Row: Two side-by-side search boxes (Reference jump on left, Word/Phrase search on right) */}
        <div className="shrink-0 border-b border-border/50 px-3 py-2 bg-card/20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 w-full">
            {/* Box 1: Passage Reference Jump (e.g. Genesis 17, John 3:16) */}
            <div className="relative min-w-0">
              <ScriptureInput
                ref={inputRef}
                onRefChange={handleRefChange}
                value={lookupValue}
                onValueChange={(val) => {
                  setLookupValue(val);
                  if (val.trim()) {
                    setMainViewMode("reader");
                  }
                }}
                availableBooks={availableBooks}
                availableVersions={availableVersions}
                placeholder={
                  effectiveSelectedVersionCode
                    ? `Reference — e.g. Genesis 17, John 3:16 (${effectiveSelectedVersionCode})`
                    : "Reference — e.g. Genesis 17, John 3:16"
                }
                onEnter={(val) => {
                  setMainViewMode("reader");
                  void handleEnter(val);
                }}
              />
            </div>

            {/* Box 2: Verse / Word Search (e.g. "created the", "in the beginning") */}
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <input
                value={textSearchQuery}
                onChange={(event) => {
                  handleTextSearchQueryChange(event.target.value);
                  if (event.target.value.trim()) {
                    setMainViewMode("search");
                  }
                }}
                placeholder={searchMode === "exact" ? 'Search exact phrase (e.g. "created the")' : 'Search words (e.g. in the beginning)'}
                autoComplete="off"
                spellCheck={false}
                className="h-8 w-full rounded-md bg-white/4 pl-8 pr-20 text-xs text-foreground ring-1 ring-white/10 outline-hidden transition focus:ring-primary/50"
              />
              {textSearchQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    handleTextSearchQueryChange("");
                    setMainViewMode("reader");
                  }}
                  title="Clear word search"
                  className="absolute right-14 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
              {isTextSearching ? (
                <Loader2 className="absolute right-14 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
              ) : null}
              <button
                type="button"
                aria-pressed={searchMode === "exact"}
                onClick={() => setSearchMode(searchMode === "exact" ? "broad" : "exact")}
                title={searchMode === "exact" ? "Matching exact phrase" : "Matching words and variations"}
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
          </div>
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

        {isListening ? (
          <div className="shrink-0 border-b border-border/40 px-3 py-1.5">
            <p className="truncate text-[11px] text-muted-foreground">
              <span className="mr-1.5 text-primary">●</span>
              {liveTranscript.trim() || "Listening…"}
            </p>
          </div>
        ) : null}

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {showBrowser && (
            <div className="w-72 sm:w-80 shrink-0 h-full overflow-hidden">
              <BookChapterBrowser
                activeBookName={
                  browserSource === "search" && searchFocus
                    ? searchFocus.bookName
                    : mergedRef.book?.name
                }
                activeChapter={
                  browserSource === "search" && searchFocus
                    ? searchFocus.chapter
                    : mergedRef.chapter
                }
                activeVerse={
                  browserSource === "search" && searchFocus
                    ? searchFocus.verse
                    : mergedRef.verseStart
                }
                availableBooks={availableBooks}
                onSelectPassage={handleSelectPassageFromBrowser}
              />
            </div>
          )}

          <div className="flex flex-col flex-1 h-full min-h-0 p-3 overflow-hidden">
            {/* If both a passage is open and a word search query exists, provide quick toggle tabs */}
            {mergedRef.book && textSearchQuery.trim().length > 0 && (
              <div className="shrink-0 flex items-center gap-1.5 border-b border-border/50 pb-2 mb-3">
                <button
                  type="button"
                  onClick={() => setMainViewMode("reader")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition",
                    mainViewMode === "reader"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>
                    Passage: {mergedRef.book.name} {mergedRef.chapter}
                    {mergedRef.verseStart ? `:${mergedRef.verseStart}` : ""}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setMainViewMode("search")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition",
                    mainViewMode === "search"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>
                    Word Matches ({textSearchResults.length})
                  </span>
                </button>
              </div>
            )}

            {mainViewMode === "search" && textSearchQuery.trim().length > 0 ? (
              /* Dedicated Word Search Results View */
              <div className="flex flex-col flex-1 h-full min-h-0 rounded-lg border border-border bg-card p-4 shadow-xs">
                <div className="shrink-0 flex items-center justify-between border-b border-border/40 pb-2.5 mb-3">
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-primary" />
                    <span className="text-xs font-bold text-foreground">
                      Word Search Results for &ldquo;{textSearchQuery}&rdquo;
                    </span>
                    <span className="rounded-xs bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-semibold">
                      {effectiveSelectedVersionCode}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {textSearchResults.length} {textSearchResults.length === 1 ? "match" : "matches"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        handleTextSearchQueryChange("");
                        setMainViewMode("reader");
                      }}
                      className="text-xs text-primary hover:underline font-medium ml-1"
                    >
                      Clear search
                    </button>
                  </div>
                </div>

                {textSearchResults.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 text-center text-xs text-muted-foreground italic">
                    No matches found for &ldquo;{textSearchQuery}&rdquo; in {effectiveSelectedVersionCode}.
                    <p className="mt-1 text-[11px] text-muted-foreground/70">
                      Try switching to {searchMode === "exact" ? "Broad" : "Exact"} mode or checking your spelling.
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 custom-scrollbar pb-6">
                    {textSearchResults.map((verse) => {
                      const versionCode = resolveVersionCode(verse.version);
                      const verseRef = `${verse.bookName} ${verse.chapter}:${verse.verse}${versionCode ? ` ${versionCode}` : ""}`;
                      const isLive = verse.pk === activeVersePk;
                      return (
                        <div
                          key={verse.pk}
                          role="button"
                          tabIndex={0}
                          aria-current={isLive ? "true" : undefined}
                          onClick={() => openSearchVerse(verse)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openSearchVerse(verse);
                            }
                          }}
                          className={cn(
                            "group relative w-full cursor-pointer rounded border p-2 text-left transition-colors select-none",
                            isLive
                              ? "border-emerald-400/50 bg-emerald-400/8"
                              : "border-transparent hover:bg-accent",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={cn("text-xs font-bold tracking-wide", isLive ? "text-emerald-400" : "text-primary")}>
                                  {verseRef}
                                </span>
                                {isLive && (
                                  <span className="rounded-xs bg-emerald-500/20 px-1 py-0.2 text-[9px] font-bold text-emerald-400">
                                    LIVE ON SCREEN
                                  </span>
                                )}
                              </div>
                              <p className="text-xs leading-relaxed text-foreground">
                                {highlightText(verse.text, textSearchQuery, {
                                  isExact: searchMode === "exact",
                                })}
                              </p>
                            </div>
                            <button
                              type="button"
                              title="Add to service"
                              aria-label={`Add ${verseRef} to service`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleAddTextVerseToService(verse);
                              }}
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* Passage Reader View */
              <div className="flex flex-col flex-1 h-full min-h-0">
                {!mergedRef.book ? (
                  <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 p-8 text-center bg-card/30">
                    <div className="rounded-full bg-primary/10 p-3 text-primary mb-3">
                      <BookOpen className="h-6 w-6" />
                    </div>
                    <h3 className="text-base font-semibold text-foreground">
                      Select a Bible Passage
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground max-w-sm">
                      Choose a book, chapter, and verse from the browser on the left, type a reference above (e.g. Genesis 1:1, John 3:16), or search for words.
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                      {["Genesis 1", "Psalms 23", "Matthew 5", "John 3", "Romans 8", "1 Corinthians 13"].map((passage) => (
                        <button
                          key={passage}
                          type="button"
                          onClick={() => {
                            setLookupValue(passage);
                            setMainViewMode("reader");
                          }}
                          className="rounded-md border border-border/80 bg-background/80 px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary/50 hover:bg-primary/10 hover:text-primary transition"
                        >
                          {passage}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <ScriptureResults
                    parsedRef={mergedRef}
                    activeVersePk={activeVersePk}
                    onSendToOutput={onSendToOutput}
                    onAddToService={handleAddVerseToServiceSafe}
                    onStep={setLookupValue}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }),
);
