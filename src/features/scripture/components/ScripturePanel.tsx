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
} from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { ScriptureDownloader } from "./ScriptureDownloader";
import { ScriptureInput } from "./ScriptureInput";
import { ScriptureResults } from "./ScriptureResults";
import { parseReference, type ParsedReference } from "../lib/parser";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { cn } from "@/lib/utils";
import { Id } from "@/../convex/_generated/dataModel";
import { useServices } from "@/features/services/hooks";
import { useScripture } from "../hooks/useScripture";
import { generateBibleSlides, type ScriptureSlide } from "../lib/slides";

import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { SpeechScriptureSuggestion } from "./SpeechScriptureSuggestion";
import { Mic, MicOff, Loader2 } from "lucide-react";

interface ScripturePanelProps {
  onSendToOutput: (slides: ScriptureSlide[]) => void;
  orgId: Id<"organizations"> | null;
}

export interface ScripturePanelRef {
  focusSearch: () => void;
}

export const ScripturePanel = memo(
  forwardRef<ScripturePanelRef, ScripturePanelProps>(function ScripturePanel(
    { onSendToOutput, orgId },
    ref
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    const identifyTimeoutRef = useRef<number | null>(null);

    useImperativeHandle(ref, () => ({
      focusSearch: () => {
        inputRef.current?.focus();
      },
    }));

    const availableBooks = useLiveQuery(() => db.books.toArray()) ?? [];
    const availableVersions = useLiveQuery(() => db.versions.toArray()) ?? [];

    const { addScriptureToService, selectedServiceId } = useServices(orgId, []);

    const [selectedVersionCode, setSelectedVersionCode] = useState<
      string | null
    >(null);
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

    const identifyScripture = useCallback(async (transcript: string) => {
      if (!transcript.trim()) return;
      setIsIdentifying(true);
      try {
        const res = await fetch("/api/scripture/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript }),
        });
        const data = await res.json();
        if (data.suggestion?.reference) {
          setSuggestion(data.suggestion.reference);
        }
      } catch (err) {
        console.error("Failed to identify scripture:", err);
      } finally {
        setIsIdentifying(false);
      }
    }, []);

    const onSpeechResult = useCallback(
      (result: { transcript: string; isFinal: boolean }) => {
        if (!result.transcript) return;
        setLiveTranscript(result.transcript);
        if (inputRef.current) {
          (inputRef.current as any).setValue(result.transcript);
        }
      },
      []
    );

    const onSpeechFinal = useCallback((text: string) => {
      if (inputRef.current) {
        (inputRef.current as any).setValue(text);
      }
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
      if (!isListening) {
        if (identifyTimeoutRef.current !== null) {
          window.clearTimeout(identifyTimeoutRef.current);
          identifyTimeoutRef.current = null;
        }
        return;
      }

      const text = liveTranscript.trim();
      if (!text) return;

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

      if (identifyTimeoutRef.current !== null) {
        window.clearTimeout(identifyTimeoutRef.current);
      }

      identifyTimeoutRef.current = window.setTimeout(() => {
        identifyScripture(text);
      }, 100);
    }, [isListening, liveTranscript, identifyScripture, availableBooks]);

    useEffect(() => {
      // Auto-switch version tab if user types a valid version code
      if (parsedRef.versionCode) {
        const matched = availableVersions.find(
          (v) => v.code.toUpperCase() === parsedRef.versionCode?.toUpperCase()
        );
        if (matched && matched.code !== selectedVersionCode) {
          setSelectedVersionCode(matched.code);
        }
      }
    }, [parsedRef.versionCode, availableVersions, selectedVersionCode]);

    useEffect(() => {
      if (!selectedVersionCode && availableVersions.length > 0) {
        const nkjv = availableVersions.find(
          (v) => v.code.toUpperCase() === "NKJV"
        );
        setSelectedVersionCode(nkjv ? nkjv.code : availableVersions[0].code);
      }
    }, [availableVersions, selectedVersionCode]);

    const handleRefChange = useCallback((ref: ParsedReference) => {
      setParsedRef(ref);
    }, []);

    const mergedRef = useMemo(
      () => ({
        ...parsedRef,
        versionCode: parsedRef.versionCode || selectedVersionCode,
      }),
      [parsedRef, selectedVersionCode]
    );

    const { lookupRef } = useScripture();

    const handleEnter = useCallback(
      async (val?: string) => {
        let activeParsed = parsedRef;
        // If explicit value provided (e.g. from autocomplete submission), parse it immediately
        // to avoid React state sync latency
        if (val) {
          activeParsed = parseReference(val, availableBooks);
        }

        // 1. Validate
        if (!activeParsed.book || !activeParsed.chapter) return;

        // 2. Construct Reference String with Version
        // Determine version: Input > Selected > Default
        const version =
          activeParsed.versionCode || selectedVersionCode || "NKJV";

        let ref = `${activeParsed.book.name} ${activeParsed.chapter}`;
        if (activeParsed.verseStart) {
          ref += `:${activeParsed.verseStart}`;
          if (activeParsed.verseEnd) {
            ref += `-${activeParsed.verseEnd}`;
          }
        }
        ref += ` ${version}`;

        // 3. Project to Output (Live)
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

        // 4. Add to Service (if service selected)
        if (selectedServiceId) {
          await addScriptureToService(selectedServiceId, ref, ref);
        }
      },
      [
        parsedRef,
        selectedVersionCode,
        selectedServiceId,
        addScriptureToService,
        lookupRef,
        onSendToOutput,
        availableBooks,
      ]
    );

    const handleAcceptSuggestion = useCallback(
      async (ref: string) => {
        setSuggestion(null);
        // Parse the suggested ref
        const parsed = parseReference(ref, availableBooks);
        if (parsed.book && parsed.chapter) {
          // Find version code from ref or use current
          const version = parsed.versionCode || selectedVersionCode || "NKJV";

          // Lookup and project
          const verses = await lookupRef({ ...parsed, versionCode: version });
          if (verses.length > 0) {
            const slides = generateBibleSlides(verses, {
              verseNumberMode: "inline",
              maxLines: 40,
              maxCharsPerLine: 100,
              versionName: version,
            });
            onSendToOutput(slides);

            // Also add to service if selected
            if (selectedServiceId) {
              await addScriptureToService(selectedServiceId, ref, ref);
            }
          }
        }
      },
      [
        availableBooks,
        selectedVersionCode,
        lookupRef,
        onSendToOutput,
        selectedServiceId,
        addScriptureToService,
      ]
    );

    return (
      <div className="h-full relative overflow-hidden">
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full"
          autoSaveId="present-scripture-layout"
        >
          {/* Downloader Sidebar */}
          <ResizablePanel defaultSize={25} minSize={20} maxSize={40}>
            <div className="h-full border-r border-border p-4 overflow-y-auto">
              <ScriptureDownloader />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Search and Results */}
          <ResizablePanel defaultSize={75}>
            <div className="h-full flex flex-col overflow-hidden bg-background">
              {/* Top Bar with Search */}
              <div className="flex items-center justify-between border-b border-border/40 bg-card/30 backdrop-blur-sm px-6 py-2.5 shrink-0 gap-4">
                <div className="flex items-center gap-4 flex-1">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80 shrink-0">
                    Scripture
                  </h2>

                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                    {availableVersions.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => setSelectedVersionCode(v.code)}
                        className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-bold transition-all border shrink-0",
                          selectedVersionCode === v.code
                            ? "bg-primary border-primary text-primary-foreground shadow-sm"
                            : "bg-background/40 border-border/60 text-muted-foreground hover:bg-accent/40"
                        )}
                      >
                        {v.code}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 w-[320px] shrink-0">
                  {/* Microphone Toggle */}
                  {isSupported && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={isListening ? stopListening : startListening}
                        title={
                          isListening
                            ? "Stop listening"
                            : "Listen for scripture"
                        }
                        className={cn(
                          "h-8 w-8 flex items-center justify-center rounded-md border transition-all relative group shadow-sm",
                          isListening
                            ? "bg-red-500 border-red-600 text-white"
                            : "bg-background border-border text-muted-foreground hover:border-primary hover:text-primary"
                        )}
                      >
                        {isListening ? (
                          <>
                            <Mic className="h-4 w-4 animate-pulse" />
                            <span className="absolute -top-1 -right-1 w-2 h-2 bg-white rounded-full animate-ping" />
                          </>
                        ) : (
                          <MicOff className="h-4 w-4" />
                        )}
                      </button>

                      {isListening && (
                        <span className="text-[10px] font-bold text-red-500 animate-pulse uppercase tracking-tighter w-14">
                          Listening...
                        </span>
                      )}
                    </div>
                  )}

                  <div className="relative flex-1">
                    <ScriptureInput
                      ref={inputRef as any}
                      onRefChange={handleRefChange}
                      availableBooks={availableBooks}
                      availableVersions={availableVersions}
                      placeholder={
                        isListening
                          ? "Listening for scripture..."
                          : selectedVersionCode
                            ? `Search ${selectedVersionCode}...`
                            : "Search Bible..."
                      }
                      onEnter={handleEnter}
                    />
                    {isIdentifying && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                <ScriptureResults
                  parsedRef={mergedRef}
                  onSendToOutput={onSendToOutput}
                  onAddToService={
                    selectedServiceId
                      ? (ref, text) =>
                          addScriptureToService(selectedServiceId, ref, text)
                      : undefined
                  }
                />
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* Suggestion Overlay */}
        {suggestion && (
          <SpeechScriptureSuggestion
            reference={suggestion}
            onAccept={handleAcceptSuggestion}
            onDismiss={() => setSuggestion(null)}
          />
        )}
      </div>
    );
  })
);
