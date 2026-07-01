"use client";

import { SpeechScriptureStack } from "./SpeechScriptureStack";
import { useSpeechScriptureOverlayStore } from "../lib/speech-scripture-overlay";

export function SpeechScriptureOverlayHost() {
  const activeVersePk = useSpeechScriptureOverlayStore(
    (state) => state.activeVersePk,
  );
  const candidates = useSpeechScriptureOverlayStore(
    (state) => state.candidates,
  );
  const handlers = useSpeechScriptureOverlayStore((state) => state.handlers);

  if (!handlers) {
    return null;
  }

  return (
    <SpeechScriptureStack
      activeVersePk={activeVersePk}
      candidates={candidates}
      onAccept={handlers.onAccept}
      onDecline={handlers.onDecline}
      onNext={handlers.onNext}
      onPrevious={handlers.onPrevious}
    />
  );
}
