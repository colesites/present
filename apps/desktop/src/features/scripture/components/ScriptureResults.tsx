"use client";

import { useState, useEffect, useRef } from "react";
import { useScripture } from "../hooks/useScripture";
import {
  generateBibleSlides,
  type SlideConfig,
  type ScriptureSlide,
} from "../lib/slides";
import { type ParsedReference } from "../lib/parser";
import { Button } from "../../../renderer/shared/components/ui/button";
import { ChevronLeft, ChevronRight, Monitor, Plus } from "lucide-react";
import { db, type BibleVerse } from "../lib/db";
import { referenceText, stepLabel, stepPassage, type Step } from "../lib/step-reference.mjs";
import { cn } from "../../../renderer/shared/lib/utils";

const SLIDE_CONFIG: SlideConfig = {
  maxLines: 100, // Effectively ignored now
  maxCharsPerLine: 1000, // Effectively ignored now
  verseNumberMode: "inline",
};

interface ScriptureResultsProps {
  parsedRef: ParsedReference;
  activeVersePk?: string | null;
  onSendToOutput: (slides: ScriptureSlide[]) => void;
  onAddToService?: (ref: string, text: string) => void;
  /** Show another passage: the reference to put in the search. */
  onStep?: (reference: string) => void;
}

export function ScriptureResults({
  parsedRef,
  activeVersePk = null,
  onSendToOutput,
  onAddToService,
  onStep,
}: ScriptureResultsProps) {
  const { lookupRef, versions } = useScripture();
  const [verses, setVerses] = useState<BibleVerse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [steps, setSteps] = useState<{ previous: Step | null; next: Step | null } | null>(null);
  // Stepping from a passage that is live puts the next one live too, once
  // it has loaded, so the operator can read along with Previous and Next.
  const sendWhenLoaded = useRef(false);

  const config = SLIDE_CONFIG;
  // What the lookup reads as of the last render, without refetching when
  // the parent passes a new function or list.
  const latest = useRef({ onSendToOutput, versions });
  useEffect(() => {
    latest.current = { onSendToOutput, versions };
  });

  useEffect(() => {
    let isCancelled = false;

    async function fetchVerses() {
      if (
        parsedRef.book &&
        parsedRef.chapter &&
        parsedRef.errors.length === 0
      ) {
        setIsLoading(true);
        const results = await lookupRef(parsedRef);
        if (isCancelled) {
          return;
        }
        setVerses(results);
        setIsLoading(false);
        const sendLive = sendWhenLoaded.current;
        sendWhenLoaded.current = false;
        if (sendLive && results.length > 0) {
          latest.current.onSendToOutput(
            generateBibleSlides(results, {
              ...SLIDE_CONFIG,
              versionName: latest.current.versions.find((v) => v.id === results[0].version)?.code ?? "",
            }),
          );
        }
        setSteps(await stepsAround(results));
      } else {
        sendWhenLoaded.current = false;
        setVerses([]);
        setSteps(null);
      }
    }

    /** The passages either side, counting the verses in the chapters around. */
    async function stepsAround(results: BibleVerse[]) {
      const book = parsedRef.book;
      const first = results[0];
      if (!book || !parsedRef.chapter || !first) return null;
      const counts = new Map<number, number>();
      for (const chapter of [parsedRef.chapter - 1, parsedRef.chapter, parsedRef.chapter + 1]) {
        if (chapter < 1 || chapter > book.chapters) continue;
        counts.set(
          chapter,
          await db.verses
            .where("[version+bookId+chapter]")
            .equals([first.version, first.bookId, chapter])
            .count(),
        );
      }
      const passage = {
        book,
        chapter: parsedRef.chapter,
        verseStart: parsedRef.verseStart,
        verseEnd: parsedRef.verseEnd,
      };
      const versesIn = (chapter: number) => counts.get(chapter) ?? 0;
      return {
        previous: stepPassage(passage, "previous", versesIn),
        next: stepPassage(passage, "next", versesIn),
      };
    }

    void fetchVerses();

    return () => {
      isCancelled = true;
    };
  }, [parsedRef, lookupRef]);

  const getVersionName = (versionId: string) => {
    return versions.find((v) => v.id === versionId)?.code ?? "";
  };

  const handleSendVerse = (v: BibleVerse) => {
    const slides = generateBibleSlides([v], {
      ...config,
      versionName: getVersionName(v.version),
    });
    onSendToOutput(slides);
  };

  const handleAddVerseToService = (e: React.MouseEvent, v: BibleVerse) => {
    e.stopPropagation();
    if (!onAddToService) return;
    const versionCode = getVersionName(v.version);
    const ref = `${v.bookName} ${v.chapter}:${v.verse}${versionCode ? ` ${versionCode}` : ""}`;
    onAddToService(ref, ref);
  };

  const handleAddRangeToService = () => {
    if (!onAddToService || verses.length === 0) return;
    const first = verses[0];
    const last = verses[verses.length - 1];
    const versionCode =
      parsedRef.versionCode || getVersionName(first.version) || "";
    const ref = `${first.bookName} ${first.chapter}:${first.verse}${verses.length > 1 ? `-${last.verse}` : ""}${versionCode ? ` ${versionCode}` : ""}`;
    onAddToService(ref, ref);
  };

  const handleSendRangeToOutput = () => {
    if (verses.length === 0) return;
    const slides = generateBibleSlides(verses, {
      ...config,
      versionName: getVersionName(verses[0].version),
    });
    onSendToOutput(slides);
  };

  if (!parsedRef.book) return null;
  const book = parsedRef.book;

  const step = (to: Step) => {
    if (!onStep) return;
    sendWhenLoaded.current = verses.some((verse) => verse.pk === activeVersePk);
    onStep(referenceText(book, to, parsedRef.versionCode));
  };
  const stepButton = (to: Step | null, direction: "previous" | "next") =>
    to && onStep ? (
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-[10px]"
        title={`${direction === "previous" ? "Previous" : "Next"}: ${referenceText(book, to, parsedRef.versionCode)}${
          verses.some((verse) => verse.pk === activeVersePk) ? " (goes live)" : ""
        }`}
        onClick={() => step(to)}
      >
        {direction === "previous" ? <ChevronLeft className="h-3 w-3" /> : null}
        {stepLabel(to)}
        {direction === "next" ? <ChevronRight className="h-3 w-3" /> : null}
      </Button>
    ) : null;

  return (
    <div className="space-y-4 border rounded-lg p-4 bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          {stepButton(steps?.previous ?? null, "previous")}
          <h3 className="truncate text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
            {parsedRef.book.name} {parsedRef.chapter}
            {parsedRef.verseStart && `:${parsedRef.verseStart}`}
            {parsedRef.verseEnd && `-${parsedRef.verseEnd}`}
            {parsedRef.versionCode && ` (${parsedRef.versionCode})`}
          </h3>
          {stepButton(steps?.next ?? null, "next")}
        </div>

        {verses.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[10px] gap-1.5"
              onClick={handleSendRangeToOutput}
            >
              <Monitor className="h-3 w-3" />
              Show All
            </Button>
            {onAddToService && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[10px] gap-1.5"
                onClick={handleAddRangeToService}
              >
                <Plus className="h-3 w-3" />
                Add to Service
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="max-h-[300px] overflow-y-auto space-y-1 pr-2 custom-scrollbar">
        {isLoading ? (
          <p className="text-xs text-muted-foreground animate-pulse">
            Searching verses...
          </p>
        ) : verses.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No verses found.
          </p>
        ) : (
          verses.map((v) => {
            const isLive = v.pk === activeVersePk;
            return (
              <div
                key={v.pk}
                role="button"
                tabIndex={0}
                aria-current={isLive ? "true" : undefined}
                onClick={() => handleSendVerse(v)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleSendVerse(v);
                  }
                }}
                className={cn(
                  "group relative w-full cursor-pointer rounded border p-2 text-left transition-colors [content-visibility:auto] [contain-intrinsic-size:72px]",
                  isLive
                    ? "border-emerald-400/50 bg-emerald-400/8"
                    : "border-transparent hover:bg-accent",
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <span
                      className={cn(
                        "mr-2 text-[10px] font-bold",
                        isLive ? "text-emerald-400" : "text-primary/60",
                      )}
                    >
                      {v.verse}
                      {isLive ? " · LIVE" : ""}
                    </span>
                    <span className="text-sm">{v.text}</span>
                  </div>

                  {onAddToService && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Add ${v.bookName} ${v.chapter}:${v.verse} to service`}
                      className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                      onClick={(e) => handleAddVerseToService(e, v)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {verses.length > 0 && (
        <div className="text-[10px] text-muted-foreground pt-2 flex justify-between border-t border-border/40">
          <span>{verses.length} verses found</span>
          <span className="italic">Click a verse to show live</span>
        </div>
      )}
    </div>
  );
}
