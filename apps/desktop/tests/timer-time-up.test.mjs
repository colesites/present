import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TIME_UP,
  getLiveTimerText,
  isTimeUpShowing,
  normalizeTimeUp,
} from "../src/renderer/shared/hooks/useTimers.ts";

const timer = (overrides) => ({
  id: "sermon",
  name: "Sermon",
  type: "countdown",
  duration: "00:30:00",
  hour: 9,
  minute: 0,
  meridiem: "AM",
  elapsedStart: "00:00",
  elapsedEnd: "00:30",
  isRunning: false,
  secondsValue: 0,
  ...overrides,
});

test("a timer that ran out shows the message, not 00:00:00", () => {
  const ranOut = timer({ finished: true });
  assert.equal(isTimeUpShowing(ranOut, DEFAULT_TIME_UP), true);
  assert.equal(getLiveTimerText(ranOut, DEFAULT_TIME_UP), "TIME UP");
  assert.equal(
    getLiveTimerText(ranOut, { ...DEFAULT_TIME_UP, text: "  Please wrap up " }),
    "Please wrap up",
  );
  assert.equal(getLiveTimerText(ranOut, { ...DEFAULT_TIME_UP, text: "   " }), "TIME UP", "never blank");
});

test("a paused, reset or running timer shows its time", () => {
  // Stopped at zero by hand is not time up: only running out is.
  assert.equal(getLiveTimerText(timer({ secondsValue: 0 }), DEFAULT_TIME_UP), "00:00:00");
  assert.equal(getLiveTimerText(timer({ secondsValue: 90, isRunning: true }), DEFAULT_TIME_UP), "00:01:30");
  assert.equal(getLiveTimerText(timer({ finished: true, isRunning: true, secondsValue: 5 }), DEFAULT_TIME_UP), "00:00:05");
  assert.equal(getLiveTimerText(null, DEFAULT_TIME_UP), "00:00:00");
});

test("turned off in Settings, the clock stays at 00:00:00", () => {
  const off = { ...DEFAULT_TIME_UP, enabled: false };
  assert.equal(isTimeUpShowing(timer({ finished: true }), off), false);
  assert.equal(getLiveTimerText(timer({ finished: true }), off), "00:00:00");
});

test("a saved setting is read back whole, whatever it is missing", () => {
  assert.deepEqual(normalizeTimeUp(undefined), DEFAULT_TIME_UP);
  assert.deepEqual(normalizeTimeUp({ blink: false }), { ...DEFAULT_TIME_UP, blink: false });
  assert.deepEqual(normalizeTimeUp({ color: "  ", text: "Done" }), { ...DEFAULT_TIME_UP, text: "Done" });
  assert.equal(normalizeTimeUp({ text: "x".repeat(100) }).text.length, 40);
});
