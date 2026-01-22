"use client";

import { useEffect, useState } from "react";
import { Check, X, Mic } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpeechScriptureSuggestionProps {
  reference: string;
  onAccept: (reference: string) => void;
  onDismiss: () => void;
  autoDismissMs?: number;
}

export function SpeechScriptureSuggestion({
  reference,
  onAccept,
  onDismiss,
  autoDismissMs = 8000,
}: SpeechScriptureSuggestionProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Animate in
    const timer = setTimeout(() => setIsVisible(true), 100);
    
    // Auto-dismiss
    const dismissTimer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onDismiss, 300); // Wait for exit animation
    }, autoDismissMs);

    return () => {
      clearTimeout(timer);
      clearTimeout(dismissTimer);
    };
  }, [onDismiss, autoDismissMs]);

  const handleAccept = () => {
    setIsVisible(false);
    setTimeout(() => onAccept(reference), 300);
  };

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(onDismiss, 300);
  };

  return (
    <div
      className={cn(
        "fixed bottom-24 right-8 z-50 transition-all duration-300 transform",
        isVisible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      )}
    >
      <div className="bg-card border border-primary/30 shadow-2xl rounded-xl p-4 w-72 backdrop-blur-md">
        <div className="flex items-start gap-4">
          <div className="bg-primary/10 p-2 rounded-lg">
            <Mic className="h-5 w-5 text-primary animate-pulse" />
          </div>
          
          <div className="flex-1 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Voice Suggestion
            </p>
            <h3 className="text-lg font-bold text-foreground">
              {reference}
            </h3>
            <p className="text-xs text-muted-foreground line-clamp-2">
              Spoken scripture detected.
            </p>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleDismiss}
            className="flex-1 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-accent transition-colors flex items-center justify-center gap-1.5"
          >
            <X className="h-3.5 w-3.5" />
            Dismiss
          </button>
          <button
            onClick={handleAccept}
            className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-1.5"
          >
            <Check className="h-3.5 w-3.5" />
            Accept
          </button>
        </div>
        
        {/* Progress bar for auto-dismiss */}
        <div className="absolute bottom-0 left-0 h-1 bg-primary/20 rounded-b-xl overflow-hidden w-full">
          <div 
            className="h-full bg-primary transition-all duration-8000 ease-linear"
            style={{ width: isVisible ? "0%" : "100%" }}
          />
        </div>
      </div>
    </div>
  );
}
