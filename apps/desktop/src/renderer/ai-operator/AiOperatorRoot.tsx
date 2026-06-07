import { AiGlow } from "./AiGlow";
import { useRealtimeOperator } from "./useRealtimeOperator";
import { useSpacebarToggle } from "./useSpacebarToggle";

export function AiOperatorRoot() {
  const operator = useRealtimeOperator();

  // Long-press spacebar toggles the operator (and the glow) on/off. The glow
  // is only present while a session is active — its state drives the look.
  useSpacebarToggle(operator.toggle);

  return <AiGlow state={operator.visualState} error={operator.error} />;
}
