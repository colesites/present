"use client";

import { useEffect, useState } from "react";

type StageBroadcastParams = {
  currentText: string | null;
  currentFooter: string | null;
  currentLabel?: string | null;
  currentRepeat?: string | null;
  currentInlineInstruction?: string | null;
  nextText: string | null;
  nextFooter: string | null;
  nextLabel?: string | null;
  nextRepeat?: string | null;
  nextInlineInstruction?: string | null;
  /** Speaker notes, for a stage layout's Speaker Notes object. */
  currentNotes?: string | null;
  nextNotes?: string | null;
};

export function useStageBroadcast({
  currentText,
  currentFooter,
  currentLabel,
  currentRepeat,
  currentInlineInstruction,
  nextText,
  nextFooter,
  nextLabel,
  nextRepeat,
  nextInlineInstruction,
  currentNotes,
  nextNotes,
}: StageBroadcastParams) {
  const [syncTrigger, setSyncTrigger] = useState(0);

  useEffect(() => {
    if (!window.electronAPI?.onStageReady) {
      return;
    }
    return window.electronAPI.onStageReady(() => {
      setSyncTrigger((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.sendToStage) {
      return;
    }

    window.electronAPI.sendToStage({
      type: "stage-content",
      currentText,
      currentFooter,
      currentLabel,
      currentRepeat,
      currentInlineInstruction,
      nextText,
      nextFooter,
      nextLabel,
      nextRepeat,
      nextInlineInstruction,
      currentNotes,
      nextNotes,
    });
    window.electronAPI.sendToWorshipStage?.({
      type: "stage-content",
      currentLabel,
      currentRepeat,
      currentInlineInstruction,
    });
  }, [
    currentText,
    currentFooter,
    currentLabel,
    currentRepeat,
    currentInlineInstruction,
    nextText,
    nextFooter,
    nextLabel,
    nextRepeat,
    nextInlineInstruction,
    currentNotes,
    nextNotes,
    syncTrigger,
  ]);
}
