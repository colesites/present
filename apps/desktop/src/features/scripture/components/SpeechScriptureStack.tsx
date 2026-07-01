"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Mic2, Radio, X } from "lucide-react";
import type { BibleVerse } from "../lib/db";
import { cn } from "../../../renderer/shared/lib/utils";

export type SpeechScriptureCandidate = {
  id: string;
  reference: string;
  transcript: string;
  verse: BibleVerse;
  createdAtMs: number;
  expiresAtMs: number;
  isAccepted?: boolean;
};

type SpeechScriptureStackProps = {
  activeVersePk: string | null;
  candidates: SpeechScriptureCandidate[];
  onAccept: (candidate: SpeechScriptureCandidate) => void;
  onDecline: (candidate: SpeechScriptureCandidate) => void;
  onNext: (candidate: SpeechScriptureCandidate) => void;
  onPrevious: (candidate: SpeechScriptureCandidate) => void;
};

export function SpeechScriptureStack({
  activeVersePk,
  candidates,
  onAccept,
  onDecline,
  onNext,
  onPrevious,
}: SpeechScriptureStackProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  if (candidates.length === 0) return null;

  const stack = (
    <section
      aria-label={`${candidates.length} speech scripture suggestion${candidates.length === 1 ? "" : "s"}`}
      className={cn(
        "group fixed bottom-6 right-6 z-[2147483647] w-[380px] max-w-[calc(100vw-3rem)]",
        isExpanded ? "h-[580px]" : "h-[180px]",
      )}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
      onFocusCapture={() => setIsExpanded(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsExpanded(false);
      }}
    >
      {candidates.slice(0, 5).map((candidate, index) => {
        const isLive = candidate.verse.pk === activeVersePk;
        const isAccepted = candidate.isAccepted || isLive;
        const collapsedOffset = index * 12;
        const expandedOffset = index * 118;
        const timeoutDurationMs = Math.max(1, candidate.expiresAtMs - Date.now());
        return (
          <article
            key={candidate.id}
            data-speech-scripture-card="true"
            aria-current={isLive ? "true" : undefined}
            className={cn(
              "absolute inset-x-0 bottom-0 overflow-hidden rounded-lg border bg-[#11131b]/96 shadow-2xl backdrop-blur-xl",
              "transition-[transform,opacity,border-color] duration-200 ease-out motion-reduce:transition-none",
              isAccepted ? "border-emerald-400/70" : "border-white/12",
            )}
            style={{
              opacity: isExpanded ? 1 : Math.max(0.45, 1 - index * 0.14),
              transform: `translateY(-${isExpanded ? expandedOffset : collapsedOffset}px) scale(${isExpanded ? 1 : 1 - index * 0.025})`,
              zIndex: candidates.length - index,
            }}
          >
            <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                  isAccepted ? "bg-emerald-400/15 text-emerald-300" : "bg-red-500/15 text-red-300",
                )}>
                  {isAccepted ? <Radio className="h-3.5 w-3.5" /> : <Mic2 className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-bold uppercase text-white">
                    {candidate.reference}
                  </p>
                  <p className={cn(
                    "text-[9px] font-semibold uppercase",
                    isAccepted ? "text-emerald-300" : "text-white/40",
                  )}>
                    {isAccepted ? "Live on output" : `Voice match ${index + 1}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onPrevious(candidate)}
                  aria-label={`Previous verse from ${candidate.reference}`}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-white/55 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onNext(candidate)}
                  aria-label={`Next verse from ${candidate.reference}`}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-white/55 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDecline(candidate)}
                  aria-label={`Decline ${candidate.reference}`}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-white/50 transition hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onAccept(candidate)}
                  aria-label={`Accept and show ${candidate.reference}`}
                  className="flex h-7 items-center gap-1.5 rounded-md bg-white px-2.5 text-[10px] font-bold uppercase text-black transition hover:bg-emerald-200"
                >
                  <Check className="h-3.5 w-3.5" />
                  {isAccepted ? "Live" : "Accept"}
                </button>
              </div>
            </div>
            <p className="line-clamp-2 px-3 py-2 text-[12px] leading-relaxed text-white/75">
              {candidate.verse.text}
            </p>
            {isAccepted ? (
              <div aria-hidden="true" className="h-0.5 bg-emerald-400/75" />
            ) : (
              <div
                aria-hidden="true"
                className="h-0.5 origin-left bg-red-400/75 motion-reduce:hidden"
                style={{
                  animation: `speech-scripture-card-timeout ${timeoutDurationMs}ms linear forwards`,
                }}
              />
            )}
          </article>
        );
      })}
      {candidates.length > 1 ? (
        <span className="absolute -top-2 right-2 z-50 rounded-full border border-white/10 bg-[#11131b] px-2 py-0.5 text-[9px] font-bold text-white/55">
          {candidates.length} matches
        </span>
      ) : null}
      <style>{`
        @keyframes speech-scripture-card-timeout {
          from { transform: scaleX(1); }
          to { transform: scaleX(0); }
        }
      `}</style>
    </section>
  );

  return createPortal(stack, document.body);
}
