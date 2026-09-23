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
import type { SpeechScriptureCandidate } from "./SpeechScriptureStack";
import { useSpeechScriptureOverlayStore } from "../lib/speech-scripture-overlay";
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
import {
  desktopWebBaseUrl,
  useDesktopSessionStore,
} from "../../../renderer/shared/store/desktopSession";
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
  activeSlideId?: string | null;
}

const SPEECH_CANDIDATE_TTL_MS = 10_000;
const MAX_SPEECH_CANDIDATES = 5;

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
      activeSlideId = null,
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
    const [speechCandidates, setSpeechCandidates] = useState<SpeechScriptureCandidate[]>([]);
    const [dismissedSpeechCandidateIds] = useState(() => new Set<string>());
    const setSpeechScriptureOverlay = useSpeechScriptureOverlayStore(
      (state) => state.setOverlay,
    );
    const clearSpeechScriptureOverlay = useSpeechScriptureOverlayStore(
      (state) => state.clearOverlay,
    );

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
    const webAppBaseUrl = useMemo(() => desktopWebBaseUrl(), []);

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
    // Set while a spoken reference is being identified; the row that showed
    // it went with the old three-column header.
    const [, setIsIdentifying] = useState(false);
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

    const enqueueSpeechVerses = useCallback(
      (verses: BibleVerse[], transcript: string) => {
        if (verses.length === 0) return;
        setSpeechCandidates((previous) => {
          const now = Date.now();
          const activePrevious = previous.filter(
            (candidate) => candidate.isAccepted || candidate.expiresAtMs > now,
          );
          const previousById = new Map(
            activePrevious.map((candidate) => [candidate.id, candidate]),
          );
          const incoming = verses.reduce<SpeechScriptureCandidate[]>((candidates, verse) => {
            if (dismissedSpeechCandidateIds.has(verse.pk)) return candidates;
            const existing = previousById.get(verse.pk);
            candidates.push({
              id: verse.pk,
              reference: formatReference({
                bookName: verse.bookName,
                chapter: verse.chapter,
                verseStart: verse.verse,
                versionCode: resolveVersionCode(verse.version),
              }),
              transcript,
              verse,
              createdAtMs: existing?.createdAtMs ?? now,
              expiresAtMs: existing?.expiresAtMs ?? now + SPEECH_CANDIDATE_TTL_MS,
              isAccepted: existing?.isAccepted ?? false,
            });
            return candidates;
          }, []);
          return [...incoming, ...activePrevious.filter(
            (candidate) => !incoming.some((item) => item.id === candidate.id),
          )].slice(0, MAX_SPEECH_CANDIDATES);
        });
      },
      [dismissedSpeechCandidateIds, formatReference, resolveVersionCode],
    );

    useEffect(() => {
      if (speechCandidates.length === 0) {
        return;
      }

      const expiringCandidates = speechCandidates.filter(
        (candidate) => !candidate.isAccepted,
      );
      if (expiringCandidates.length === 0) {
        return;
      }

      const now = Date.now();
      const nextExpiry = Math.min(
        ...expiringCandidates.map((candidate) => candidate.expiresAtMs),
      );

      if (nextExpiry <= now) {
        setSpeechCandidates((previous) =>
          previous.filter(
            (candidate) => candidate.isAccepted || candidate.expiresAtMs > Date.now(),
          ),
        );
        return;
      }

      const timeoutId = window.setTimeout(() => {
        setSpeechCandidates((previous) =>
          previous.filter(
            (candidate) => candidate.isAccepted || candidate.expiresAtMs > Date.now(),
          ),
        );
      }, nextExpiry - now + 25);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }, [speechCandidates]);

    const identifyScripture = useCallback(
      async (transcript: string) => {
        const trimmedTranscript = transcript.trim();
        if (!trimmedTranscript) return;

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

        if (matchedVerse) enqueueSpeechVerses([matchedVerse], trimmedTranscript);
      },
      [
        effectiveSelectedVersionCode,
        enqueueSpeechVerses,
        identifyVerseFromText,
      ],
    );

    const searchSpeechCandidates = useCallback(
      async (transcript: string) => {
        const query = transcript.trim();
        if (query.replace(/[^A-Za-z0-9]/g, "").length < 3) {
          return;
        }

        const requestId = speechSearchRequestRef.current + 1;
        speechSearchRequestRef.current = requestId;

        const results = await searchVersesByText({
          query,
          versionCode: effectiveSelectedVersionCode,
          limit: 5,
          mode: "broad",
        });

        if (speechSearchRequestRef.current !== requestId) {
          return;
        }

        enqueueSpeechVerses(results, query);
      },
      [effectiveSelectedVersionCode, enqueueSpeechVerses, searchVersesByText],
    );

    const handleAiQueryChange = useCallback(
      (value: string) => {
        setLiveTranscript(value);

        const text = value.trim();
        if (!text) {
          setIsIdentifying(false);
          setSpeechCandidates((previous) =>
            previous.filter((candidate) => candidate.isAccepted),
          );
          dismissedSpeechCandidateIds.clear();
          return;
        }

        const quickParsed = parseReference(text, availableBooks);
        if (!quickParsed.book || !quickParsed.chapter) {
          void searchSpeechCandidates(text);
          setIsIdentifying(false);
          return;
        }

        const versionCode = quickParsed.versionCode || effectiveSelectedVersionCode;
        void lookupRef({ ...quickParsed, versionCode }).then((verses) => {
          enqueueSpeechVerses(verses.slice(0, 5), text);
        });
        setIsIdentifying(false);
      },
      [
        availableBooks,
        effectiveSelectedVersionCode,
        enqueueSpeechVerses,
        dismissedSpeechCandidateIds,
        lookupRef,
        searchSpeechCandidates,
        setLiveTranscript,
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

    const updateSpeechCandidateVerse = useCallback(
      async (
        candidate: SpeechScriptureCandidate,
        direction: "next" | "previous",
      ) => {
        const adjacentVerse = await getAdjacentVerse(candidate.verse, direction);
        if (!adjacentVerse) {
          return;
        }

        const updatedCandidate = {
          ...candidate,
          id: adjacentVerse.pk,
          reference: formatReference({
            bookName: adjacentVerse.bookName,
            chapter: adjacentVerse.chapter,
            verseStart: adjacentVerse.verse,
            versionCode: resolveVersionCode(adjacentVerse.version),
          }),
          verse: adjacentVerse,
        };

        setSpeechCandidates((previous) =>
          previous.map((item) =>
            item.id === candidate.id ? updatedCandidate : item,
          ),
        );

        if (candidate.isAccepted || candidate.verse.pk === activeVersePk) {
          void handleSendTextVerse(adjacentVerse);
        }
      },
      [
        activeVersePk,
        formatReference,
        getAdjacentVerse,
        handleSendTextVerse,
        resolveVersionCode,
      ],
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
        setSpeechCandidates((previous) =>
          previous.map((item) =>
            item.isAccepted && item.verse.pk === verse.pk
              ? {
                  ...item,
                  id: adjacentVerse.pk,
                  reference: formatReference({
                    bookName: adjacentVerse.bookName,
                    chapter: adjacentVerse.chapter,
                    verseStart: adjacentVerse.verse,
                    versionCode: resolveVersionCode(adjacentVerse.version),
                  }),
                  verse: adjacentVerse,
                }
              : item,
          ),
        );
      },
      [
        formatReference,
        getAdjacentVerse,
        getLiveScriptureVerse,
        handleSendTextVerse,
        resolveVersionCode,
      ],
    );

    const onSpeechResult = useCallback(
      (result: { transcript: string; isFinal: boolean }) => {
        if (!result.transcript) return;
        const transcript = result.transcript.trim();

        if (result.isFinal && isNextVerseCommand(transcript)) {
          void showAdjacentLiveVerse("next");
          return;
        }

        if (result.isFinal && isPreviousVerseCommand(transcript)) {
          void showAdjacentLiveVerse("previous");
          return;
        }

        handleAiQueryChange(result.transcript);

        if (!result.isFinal) {
          return;
        }

        // What happens next is the transcript effect's, which asks the model
        // about everything that was heard. Asking here as well would ask
        // twice about the same sentence and race its own answer.
      },
      [handleAiQueryChange, showAdjacentLiveVerse],
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

      identifyTimeoutRef.current = window.setTimeout(() => {
        // Everything that was heard goes to the model: AssemblyAI turns
        // sound into a sentence and the model decides what the sentence
        // meant. It answers `null` for anything it is unsure of, and for
        // everything when nobody is signed in or it cannot be reached — in
        // which case this behaves exactly as it did before.
        void understandSpokenScripture(webAppBaseUrl, sessionToken ?? "", text, availableBooks)
          .then((understood) => {
            if (!understood?.mayProject || !understood.reference.book) {
              void identifyScripture(text);
              return;
            }
            const { book, chapter, verseStart, verseEnd } = understood.reference;
            let spoken = `${book.name} ${chapter ?? 1}`;
            if (verseStart) {
              spoken += `:${verseStart}`;
              if (verseEnd) {
                spoken += `-${verseEnd}`;
              }
            }
            setLookupValue(spoken);
            void handleEnter(spoken);
          })
          .catch(() => {
            void identifyScripture(text);
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
      liveTranscript,
      identifyScripture,
      availableBooks,
      isListening,
      webAppBaseUrl,
      sessionToken,
      handleEnter,
      setLookupValue,
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

    const handleAcceptSpeechCandidate = useCallback(
      (candidate: SpeechScriptureCandidate) => {
        setSpeechCandidates((previous) => [
          ...previous.map((item) =>
            item.id === candidate.id ? { ...item, isAccepted: true } : item,
          ),
        ]);
        setLookupValue(candidate.reference);
        void handleSendTextVerse(candidate.verse);
      },
      [
        handleSendTextVerse,
        setLookupValue,
      ],
    );

    const handleDeclineSpeechCandidate = useCallback(
      (candidate: SpeechScriptureCandidate) => {
        dismissedSpeechCandidateIds.add(candidate.id);
        setSpeechCandidates((previous) =>
          previous.filter((item) => item.id !== candidate.id),
        );
      },
      [dismissedSpeechCandidateIds],
    );

    useEffect(() => {
      setSpeechScriptureOverlay({
        activeVersePk,
        candidates: speechCandidates,
        handlers: {
          onAccept: handleAcceptSpeechCandidate,
          onDecline: handleDeclineSpeechCandidate,
          onNext: (candidate) => {
            void updateSpeechCandidateVerse(candidate, "next");
          },
          onPrevious: (candidate) => {
            void updateSpeechCandidateVerse(candidate, "previous");
          },
        },
      });
    }, [
      activeVersePk,
      handleAcceptSpeechCandidate,
      handleDeclineSpeechCandidate,
      setSpeechScriptureOverlay,
      speechCandidates,
      updateSpeechCandidateVerse,
    ]);

    useEffect(() => {
      return () => {
        clearSpeechScriptureOverlay();
      };
    }, [clearSpeechScriptureOverlay]);

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
                dismissedSpeechCandidateIds.clear();
                setSpeechCandidates((previous) => previous.filter((candidate) => candidate.isAccepted));
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
