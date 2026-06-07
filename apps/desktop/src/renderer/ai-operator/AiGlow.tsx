import type { CSSProperties } from "react";
import type { AiOperatorVisualState } from "../../shared/ai-operator/types";

interface AiGlowProps {
  state: AiOperatorVisualState;
  error: string | null;
}

const stateLabels: Record<AiOperatorVisualState, string> = {
  idle: "AI Operator idle",
  connecting: "AI Operator connecting",
  listening: "AI Operator listening",
  thinking: "AI Operator thinking",
  executing: "AI Operator executing",
  success: "AI Operator action complete",
  error: "AI Operator error",
};

// Peak glow alpha + breathe speed per state. idle = 0 (the glow is OFF until
// the operator is toggled on with the spacebar).
const stateTuning: Record<
  AiOperatorVisualState,
  { intensity: number; breathe: string }
> = {
  idle: { intensity: 0, breathe: "0s" },
  connecting: { intensity: 0.6, breathe: "2.8s" },
  listening: { intensity: 0.7, breathe: "3.4s" },
  thinking: { intensity: 0.66, breathe: "2.2s" },
  executing: { intensity: 0.92, breathe: "1.4s" },
  success: { intensity: 0.72, breathe: "2.8s" },
  error: { intensity: 0.7, breathe: "2.8s" },
};

export function AiGlow({ state, error }: AiGlowProps) {
  const isVisible = state !== "idle";
  const { intensity, breathe } = stateTuning[state];

  const accent = state === "error" ? "var(--destructive)" : "var(--primary)";
  const strong = `color-mix(in srgb, ${accent} ${Math.round(
    intensity * 100,
  )}%, transparent)`;
  const soft = `color-mix(in srgb, ${accent} ${Math.round(
    intensity * 55,
  )}%, transparent)`;
  const faint = `color-mix(in srgb, ${accent} ${Math.round(
    intensity * 28,
  )}%, transparent)`;

  const shell: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    pointerEvents: "none",
    opacity: isVisible ? 1 : 0,
    transition: "opacity 300ms ease",
  };

  // A single continuous halo that bleeds inward from the left, bottom, and
  // right edges (no top) using layered inset box-shadows — soft, organic, and
  // connected like the Gemini Live glow, rather than hard rectangular bars.
  const halo: CSSProperties = {
    position: "absolute",
    inset: 0,
    boxShadow: [
      `inset 0 -160px 110px -90px ${strong}`, // bottom rises up
      `inset 0 -60px 50px -40px ${soft}`, // bottom inner core
      `inset 150px 0 120px -110px ${soft}`, // left
      `inset -150px 0 120px -110px ${soft}`, // right
      `inset 0 0 220px -40px ${faint}`, // overall ambient bloom
    ].join(", "),
    animation: isVisible
      ? `ai-glow-breathe ${breathe} ease-in-out infinite`
      : "none",
    willChange: "opacity",
  };

  return (
    <div
      data-state={state}
      aria-live="polite"
      aria-label={error ?? stateLabels[state]}
      title={error ?? stateLabels[state]}
      style={shell}
    >
      <style>
        {`@keyframes ai-glow-breathe {
            0%, 100% { opacity: 0.62; }
            50% { opacity: 1; }
          }`}
      </style>
      <div style={halo} />
    </div>
  );
}
