import { useState } from "react";
import { AiGlow } from "./AiGlow";
import { useRealtimeOperator } from "./useRealtimeOperator";
import { useActivationKeyToggle } from "./useActivationKeyToggle";

interface AiOperatorRootProps {
  sessionToken?: string | null;
  speechInputDeviceId?: string | null;
  speechLang?: string;
}

export function AiOperatorRoot({
  sessionToken = null,
  speechInputDeviceId = null,
  speechLang = "en-US",
}: AiOperatorRootProps) {
  const operator = useRealtimeOperator({
    sessionToken,
    speechInputDeviceId,
    speechLang,
  });
  const [isPressing, setIsPressing] = useState(false);
  const showPressPreview = isPressing && operator.visualState === "idle";

  useActivationKeyToggle(operator.toggle, {
    onPressStart: () => setIsPressing(true),
    onPressEnd: () => setIsPressing(false),
  });

  return (
    <AiGlow
      state={showPressPreview ? "connecting" : operator.visualState}
      error={operator.error}
    />
  );
}
