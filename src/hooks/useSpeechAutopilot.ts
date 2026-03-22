import { useEffect, useRef } from "react";
import type { SlideData } from "../features/slides";

interface UseSpeechAutopilotProps {
  isAutopilotEnabled: boolean;
  viewMode: string;
  slidesForGrid: SlideData[];
  selected: { songId: any; index: number } | null;
  handleSelectSlide: (slideId: string, text: string, footer?: string) => Promise<void>;
}

export function useSpeechAutopilot({
  isAutopilotEnabled,
  viewMode,
  slidesForGrid,
  selected,
  handleSelectSlide,
}: UseSpeechAutopilotProps) {
  const recognitionRef = useRef<any>(null);
  const lastTranscriptRef = useRef<string>("");
  const lastMatchedIndexRef = useRef<number | null>(null);
  const slideStartTimeRef = useRef<number | null>(null);
  const currentSlideIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isAutopilotEnabled || viewMode !== "show") {
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      lastTranscriptRef.current = "";
      lastMatchedIndexRef.current = null;
      slideStartTimeRef.current = null;
      currentSlideIndexRef.current = null;
      return;
    }

    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      const results = event.results;
      if (!results || results.length === 0) return;
      const lastResult = results[results.length - 1];
      const transcript = String(lastResult[0]?.transcript || "").trim();
      if (!transcript) return;

      const normalizedTranscript = transcript
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!normalizedTranscript) return;
      if (normalizedTranscript === lastTranscriptRef.current) return;
      lastTranscriptRef.current = normalizedTranscript;

      if (slidesForGrid.length === 0) return;

      const words = normalizedTranscript.split(" ").filter(Boolean);
      if (words.length === 0) return;

      const scores: number[] = [];

      for (let i = 0; i < slidesForGrid.length; i += 1) {
        const slideText = String(slidesForGrid[i].slide.text || "")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!slideText) {
          scores[i] = 0;
          continue;
        }
        let score = 0;
        for (const w of words) {
          if (w && slideText.includes(w)) {
            score += 1;
          }
        }
        scores[i] = score;
      }

      const currentIndex = selected?.index ?? 0;
      const currentScore = scores[currentIndex] ?? 0;

      if (currentSlideIndexRef.current !== currentIndex) {
        currentSlideIndexRef.current = currentIndex;
        slideStartTimeRef.current = Date.now();
        lastMatchedIndexRef.current = null;
      }

      const nextIndex = currentIndex + 1;
      if (nextIndex >= slidesForGrid.length) return;

      const nextScore = scores[nextIndex] ?? 0;
      if (nextScore === 0) return;

      const now = Date.now();
      const MIN_HOLD_MS = 2500;
      const FINISH_SCORE = 3;

      if (slideStartTimeRef.current == null) {
        slideStartTimeRef.current = now;
        return;
      }

      const elapsed = now - slideStartTimeRef.current;
      const finished =
        currentScore >= FINISH_SCORE ||
        (elapsed >= MIN_HOLD_MS && currentScore > 0);

      if (!finished) return;

      if (nextScore <= currentScore) return;

      if (nextIndex === lastMatchedIndexRef.current) return;

      lastMatchedIndexRef.current = nextIndex;
      slideStartTimeRef.current = now;

      const target = slidesForGrid[nextIndex];
      if (!target) return;

      const slideId = target.song
        ? `${target.song._id}:${target.index}`
        : `scripture:${target.index}`;

      handleSelectSlide(slideId, target.slide.text, target.slide.footer);
    };

    recognition.onend = () => {
      if (isAutopilotEnabled && viewMode === "show") {
        try {
          recognition.start();
        } catch {
          // Ignore start errors on auto-restart
        }
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      // Ignore initial start error
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      lastTranscriptRef.current = "";
      lastMatchedIndexRef.current = null;
      slideStartTimeRef.current = null;
      currentSlideIndexRef.current = null;
    };
  }, [
    isAutopilotEnabled,
    viewMode,
    slidesForGrid,
    selected,
    handleSelectSlide,
  ]);
}
