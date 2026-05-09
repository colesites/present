"use client";

import { useEffect, useState } from "react";

type StageBroadcastParams = {
  currentText: string | null;
  currentFooter: string | null;
  nextText: string | null;
  nextFooter: string | null;
};

export function useStageBroadcast({
  currentText,
  currentFooter,
  nextText,
  nextFooter,
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
      nextText,
      nextFooter,
    });
  }, [currentText, currentFooter, nextText, nextFooter, syncTrigger]);
}
