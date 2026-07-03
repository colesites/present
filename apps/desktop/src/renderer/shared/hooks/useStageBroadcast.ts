"use client";

import { useEffect, useState } from "react";

type StageBroadcastParams = {
  currentText: string | null;
  currentFooter: string | null;
  currentLabel?: string | null;
  currentRepeat?: string | null;
  nextText: string | null;
  nextFooter: string | null;
  nextLabel?: string | null;
  nextRepeat?: string | null;
};

export function useStageBroadcast({
  currentText,
  currentFooter,
  currentLabel,
  currentRepeat,
  nextText,
  nextFooter,
  nextLabel,
  nextRepeat,
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
      nextText,
      nextFooter,
      nextLabel,
      nextRepeat,
    });
    window.electronAPI.sendToWorshipStage?.({
      type: "stage-content",
      currentLabel,
      currentRepeat,
    });
  }, [
    currentText,
    currentFooter,
    currentLabel,
    currentRepeat,
    nextText,
    nextFooter,
    nextLabel,
    nextRepeat,
    syncTrigger,
  ]);
}
