"use client";

import { useState, useEffect } from "react";
import { useScripture } from "../hooks/useScripture";
import { generateBibleSlides, type SlideConfig } from "../lib/slides";
import { type ParsedReference } from "../lib/parser";
import { Button } from "@/components/ui/button";
import { Monitor, Plus, Settings2 } from "lucide-react";
import { type BibleVerse } from "../lib/db";

interface ScriptureResultsProps {
  parsedRef: ParsedReference;
  onSendToOutput: (slides: string[]) => void;
  onAddToService?: (ref: string, text: string) => void;
}

export function ScriptureResults({
  parsedRef,
  onSendToOutput,
  onAddToService,
}: ScriptureResultsProps) {
  const { lookupRef } = useScripture();
  const [verses, setVerses] = useState<BibleVerse[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const config: SlideConfig = {
    maxLines: 100, // Effectively ignored now
    maxCharsPerLine: 1000, // Effectively ignored now
    verseNumberMode: "inline",
  };

  useEffect(() => {
    async function fetchVerses() {
      if (
        parsedRef.book &&
        parsedRef.chapter &&
        parsedRef.errors.length === 0
      ) {
        setIsLoading(true);
        const results = await lookupRef(parsedRef);
        setVerses(results);
        setIsLoading(false);
      } else {
        setVerses([]);
      }
    }
    fetchVerses();
  }, [parsedRef, lookupRef]);

  const handleSendVerse = (v: BibleVerse) => {
    const slides = generateBibleSlides([v], config);
    onSendToOutput(slides);
  };

  const handleAddVerseToService = (e: React.MouseEvent, v: BibleVerse) => {
    e.stopPropagation();
    if (!onAddToService) return;
    const ref = `${v.bookName} ${v.chapter}:${v.verse}`;
    onAddToService(ref, v.text);
  };

  const handleAddRangeToService = () => {
    if (!onAddToService || verses.length === 0) return;
    const first = verses[0];
    const last = verses[verses.length - 1];
    const ref = `${first.bookName} ${first.chapter}:${first.verse}${verses.length > 1 ? `-${last.verse}` : ""}`;
    const combinedText = verses.map((v) => v.text).join(" ");
    // Use ref as label for the service item as per user request
    onAddToService(ref, ref);
  };;

  const handleSendRangeToOutput = () => {
    const slides = generateBibleSlides(verses, config);
    onSendToOutput(slides);
  };

  if (!parsedRef.book) return null;

  return (
    <div className="space-y-4 border rounded-lg p-4 bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
          {parsedRef.book.name} {parsedRef.chapter}
          {parsedRef.verseStart && `:${parsedRef.verseStart}`}
          {parsedRef.verseEnd && `-${parsedRef.verseEnd}`}
          {parsedRef.versionCode && ` (${parsedRef.versionCode})`}
        </h3>

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
          verses.map((v) => (
            <div
              key={v.pk}
              onClick={() => handleSendVerse(v)}
              className="text-left w-full p-2 rounded hover:bg-accent transition-colors group relative cursor-pointer"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <span className="font-bold text-[10px] mr-2 text-primary/60">
                    {v.verse}
                  </span>
                  <span className="text-sm">{v.text}</span>
                </div>

                {onAddToService && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => handleAddVerseToService(e, v)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ))
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
