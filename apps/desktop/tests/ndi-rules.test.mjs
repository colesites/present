import assert from "node:assert/strict";
import test from "node:test";

import {
  NDI_FALLBACK_HEIGHT,
  NDI_FALLBACK_WIDTH,
  NDI_FOURCC_BGRA,
  NDI_INPUT_NO_SOURCE_ERROR,
  NDI_INPUT_STOP_DELAY_MS,
  NDI_OUTPUT_INTERVAL_MS,
  describeNdiVideoFrame,
  isUsableNdiInputFrame,
  ndiDiscoveryOptions,
  ndiFrameRequestSourceName,
  ndiFrameResponse,
  ndiSenderOptions,
  normalizeNdiGroupName,
  normalizeNdiInputClientId,
  normalizeNdiSourceName,
  orderNdiSources,
  planNdiInputStart,
  planNdiInputStop,
  selectNdiInputFrame,
  shouldKeepNdiInputFrame,
} from "../src/shared/lib/ndi-rules.mjs";

/**
 * Characterisation suite: this pins the CURRENT behaviour of NDI in the
 * Electron build, extracted verbatim from `ndi.service.ts` and the `ndi-frame`
 * handler in `protocol.service.ts`, so the Rust port in Stage 6 can be checked
 * against the same cases. If an assertion here changes, that is a product
 * decision, not a refactor.
 *
 * NDI output is what a livestream or a recording desk takes, and NDI input is a
 * camera on the audience screen. Both are live during a service.
 */

const idle = { receiving: false, sourceName: null, clientIds: [] };
const receiving = (sourceName, ...clientIds) => ({ receiving: true, sourceName, clientIds });

// --- names -----------------------------------------------------------------

test("a blank source name becomes the default, and a real one is trimmed", () => {
  assert.equal(normalizeNdiSourceName(""), "Present Main Output");
  assert.equal(normalizeNdiSourceName("   "), "Present Main Output");
  assert.equal(normalizeNdiSourceName("  Sanctuary  "), "Sanctuary");
});

test("the group name is Public when blank, and any casing of public is Public", () => {
  assert.equal(normalizeNdiGroupName(""), "Public");
  assert.equal(normalizeNdiGroupName("  "), "Public");
  assert.equal(normalizeNdiGroupName("public"), "Public");
  assert.equal(normalizeNdiGroupName(" PUBLIC "), "Public");
  // Any other group keeps its casing: NDI groups are compared as written.
  assert.equal(normalizeNdiGroupName(" Streaming "), "Streaming");
});

test("a client id is trimmed, and blank or missing is no client at all", () => {
  assert.equal(normalizeNdiInputClientId(" output-1 "), "output-1");
  assert.equal(normalizeNdiInputClientId(""), null);
  assert.equal(normalizeNdiInputClientId("   "), null);
  assert.equal(normalizeNdiInputClientId(undefined), null);
  assert.equal(normalizeNdiInputClientId(null), null);
});

// --- output ----------------------------------------------------------------

test("the sender clocks on video and carries no audio", () => {
  assert.deepEqual(ndiSenderOptions("Sanctuary", "Public"), {
    name: "Sanctuary",
    groups: "Public",
    group: "Public",
    clockVideo: true,
    clockAudio: false,
  });
});

test("a frame is declared as progressive BGRA at exactly 30 fps", () => {
  assert.deepEqual(describeNdiVideoFrame(1920, 1080), {
    xres: 1920,
    yres: 1080,
    frameRateN: 30000,
    frameRateD: 1000,
    pictureAspectRatio: 1920 / 1080,
    lineStrideBytes: 1920 * 4,
    frameFormatType: 1,
    fourCC: 1095911234,
  });
});

test("the BGRA FourCC is the SDK's own macro, spelled out", () => {
  const fourCC = (a, b, c, d) =>
    a.charCodeAt(0) | (b.charCodeAt(0) << 8) | (c.charCodeAt(0) << 16) | (d.charCodeAt(0) << 24);
  assert.equal(NDI_FOURCC_BGRA, fourCC("B", "G", "R", "A"));
});

test("the library's own enum values win over the built-in ones, including zero", () => {
  const frame = describeNdiVideoFrame(1280, 720, { bgra: 7, progressive: 0 });
  assert.equal(frame.fourCC, 7);
  assert.equal(frame.frameFormatType, 0);
});

test("the capture interval is floor(1000 / 30), a hair under the declared rate", () => {
  assert.equal(NDI_OUTPUT_INTERVAL_MS, 33);
});

test("with no audience window, the stream is a 1280x720 frame", () => {
  // `Buffer.alloc` zero-fills, so this is transparent black, not opaque black.
  assert.equal(NDI_FALLBACK_WIDTH, 1280);
  assert.equal(NDI_FALLBACK_HEIGHT, 720);
});

// --- discovery -------------------------------------------------------------

test("discovery includes this machine's own sources and normalises the group", () => {
  assert.deepEqual(ndiDiscoveryOptions(undefined), { showLocalSources: true, groups: undefined });
  assert.deepEqual(ndiDiscoveryOptions(""), { showLocalSources: true, groups: undefined });
  assert.deepEqual(ndiDiscoveryOptions("public"), { showLocalSources: true, groups: "Public" });
  assert.deepEqual(ndiDiscoveryOptions(" Cams "), { showLocalSources: true, groups: "Cams" });
});

test("sources without a name are dropped and the rest sorted by name", () => {
  const sources = orderNdiSources([
    { name: "ZED (Camera 2)", urlAddress: "10.0.0.3:5961" },
    { name: "" },
    { urlAddress: "10.0.0.9:5961" },
    { name: 42 },
    { name: "BIRDDOG (Pulpit)", urlAddress: "10.0.0.2:5961" },
  ]);
  assert.deepEqual(
    sources.map((source) => source.name),
    ["BIRDDOG (Pulpit)", "ZED (Camera 2)"],
  );
  assert.equal(sources[0].urlAddress, "10.0.0.2:5961", "the address travels with its name");
});

test("sources sort the way a person reads them, not by character code", () => {
  // `localeCompare`: case is ignored until it is the only difference, and then
  // lower case comes first; punctuation and digits come before letters. A
  // character-code sort would put every upper-case machine name before every
  // lower-case one.
  const names = ["b", "A", "a", "B", "ZED (Cam)", "birddog (x)", "BIRDDOG (Pulpit)", "_x", "9 cams"];
  assert.deepEqual(
    orderNdiSources(names.map((name) => ({ name }))).map((source) => source.name),
    ["_x", "9 cams", "a", "A", "b", "B", "BIRDDOG (Pulpit)", "birddog (x)", "ZED (Cam)"],
  );
});

// --- input: one shared receiver --------------------------------------------

test("starting with no source is refused, and stops the receiver if nobody holds it", () => {
  const plan = planNdiInputStart(receiving("Cam", "output-1"), "  ", "output-1");
  assert.deepEqual(plan, {
    kind: "rejected",
    error: NDI_INPUT_NO_SOURCE_ERROR,
    stopNow: true,
    clientIds: [],
  });
  assert.equal(NDI_INPUT_NO_SOURCE_ERROR, "Select an NDI source first.");
});

test("starting with no source leaves the receiver alone while another client holds it", () => {
  const plan = planNdiInputStart(receiving("Cam", "output-1", "preview-1"), "", "output-1");
  assert.equal(plan.kind, "rejected");
  assert.equal(plan.stopNow, false);
  assert.deepEqual(plan.clientIds, ["preview-1"]);
});

test("starting with no source and no client id drops nobody", () => {
  const plan = planNdiInputStart(receiving("Cam", "output-1"), "", undefined);
  assert.equal(plan.stopNow, false);
  assert.deepEqual(plan.clientIds, ["output-1"]);

  assert.equal(planNdiInputStart(idle, "", undefined).stopNow, true);
});

test("a second surface on the same source joins the receiver rather than reopening it", () => {
  // The audience window and the operator's preview both show the same prop.
  const plan = planNdiInputStart(receiving("Cam", "output-1"), " Cam ", "preview-1");
  assert.deepEqual(plan, {
    kind: "reuse",
    sourceName: "Cam",
    clientIds: ["output-1", "preview-1"],
  });
});

test("joining twice with one client id counts it once", () => {
  const plan = planNdiInputStart(receiving("Cam", "output-1"), "Cam", "output-1");
  assert.deepEqual(plan.clientIds, ["output-1"]);
});

test("a new source replaces the receiver and every client of the old one", () => {
  // One receiver for the whole app: a prop on another camera takes it from
  // whoever had it. Pinned as it is, not as it should be.
  const plan = planNdiInputStart(receiving("Cam", "output-1", "preview-1"), "Pulpit", "output-2");
  assert.deepEqual(plan, { kind: "connect", sourceName: "Pulpit", clientId: "output-2" });
});

test("a matching name is not enough without a live receiver", () => {
  const stale = { receiving: false, sourceName: "Cam", clientIds: [] };
  assert.equal(planNdiInputStart(stale, "Cam", "output-1").kind, "connect");
});

test("source names match exactly after trimming, not case-insensitively", () => {
  assert.equal(planNdiInputStart(receiving("Cam", "a"), "cam", "b").kind, "connect");
});

test("stopping one of two clients keeps the receiver", () => {
  const plan = planNdiInputStop(receiving("Cam", "output-1", "preview-1"), "output-1");
  assert.deepEqual(plan, { kind: "keep", clientIds: ["preview-1"] });
});

test("the last client leaving stops the receiver after a grace period", () => {
  const plan = planNdiInputStop(receiving("Cam", "output-1"), "output-1");
  assert.deepEqual(plan, { kind: "stop-later", delayMs: 1200, clientIds: [] });
  assert.equal(NDI_INPUT_STOP_DELAY_MS, 1200);
});

test("stopping without a client id releases every client", () => {
  const plan = planNdiInputStop(receiving("Cam", "output-1", "preview-1"), undefined);
  assert.deepEqual(plan, { kind: "stop-later", delayMs: 1200, clientIds: [] });
});

test("stopping a client that was never registered still stops a receiver nobody holds", () => {
  const plan = planNdiInputStop(receiving("Cam"), "stranger");
  assert.equal(plan.kind, "stop-later");
});

test("stopping a client that was never registered keeps a receiver somebody holds", () => {
  const plan = planNdiInputStop(receiving("Cam", "output-1"), "stranger");
  assert.deepEqual(plan, { kind: "keep", clientIds: ["output-1"] });
});

test("stopping with no receiver resets rather than scheduling anything", () => {
  assert.deepEqual(planNdiInputStop(idle, "output-1"), { kind: "reset", clientIds: [] });
  assert.deepEqual(planNdiInputStop(idle, undefined), { kind: "reset", clientIds: [] });
});

// --- input: frames ---------------------------------------------------------

test("received frames are kept at most every 125 ms, and the first always is", () => {
  assert.equal(shouldKeepNdiInputFrame(1_000_000, 0), true);
  assert.equal(shouldKeepNdiInputFrame(1_000_124, 1_000_000), false);
  assert.equal(shouldKeepNdiInputFrame(1_000_125, 1_000_000), true);
});

test("a frame without size or pixels is skipped", () => {
  assert.equal(isUsableNdiInputFrame(null), false);
  assert.equal(isUsableNdiInputFrame(undefined), false);
  assert.equal(isUsableNdiInputFrame({ xres: 0, yres: 720, data: [1] }), false);
  assert.equal(isUsableNdiInputFrame({ xres: 1280, yres: -1, data: [1] }), false);
  assert.equal(isUsableNdiInputFrame({ xres: 1280, yres: 720 }), false);
  assert.equal(isUsableNdiInputFrame({ xres: 1280, yres: 720, data: [1] }), true);
});

const active = {
  sourceName: "Cam",
  image: "jpeg-bytes",
  contentType: "image/jpeg",
  frameAtMs: 5_000,
  lastError: null,
};

test("asking for the source being received returns its latest frame", () => {
  assert.deepEqual(selectNdiInputFrame(active, "Cam"), {
    data: "jpeg-bytes",
    contentType: "image/jpeg",
    updatedAtMs: 5_000,
    error: null,
  });
  assert.equal(selectNdiInputFrame(active, null).data, "jpeg-bytes", "no name asks for whatever is live");
});

test("asking for a different source returns nothing, never another camera's frame", () => {
  assert.deepEqual(selectNdiInputFrame(active, "Pulpit"), {
    data: null,
    contentType: "image/jpeg",
    updatedAtMs: 0,
    error: 'NDI source "Pulpit" is not active.',
  });
});

test("asking while nothing is received returns the empty frame and the last error", () => {
  const nothing = { ...active, sourceName: null, image: null, frameAtMs: 0, lastError: "timed out" };
  assert.deepEqual(selectNdiInputFrame(nothing, "Pulpit"), {
    data: null,
    contentType: "image/jpeg",
    updatedAtMs: 0,
    error: "timed out",
  });
});

// --- the ndi-frame scheme --------------------------------------------------

test("an ndi-frame URL names its source in the path, percent-decoded", () => {
  assert.equal(ndiFrameRequestSourceName("ndi-frame://frame/BIRDDOG%20(Pulpit)?t=123"), "BIRDDOG (Pulpit)");
  assert.equal(ndiFrameRequestSourceName("ndi-frame://frame/"), null);
  assert.equal(ndiFrameRequestSourceName("ndi-frame://frame"), null);
  assert.throws(() => ndiFrameRequestSourceName("ndi-frame://frame/%E0%A4%A"), URIError);
});

test("no frame is a 204 that is never cached", () => {
  assert.deepEqual(ndiFrameResponse({ data: null, contentType: "image/jpeg", updatedAtMs: 0 }), {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
});

test("a frame is served with its type and the time it arrived", () => {
  assert.deepEqual(ndiFrameResponse({ data: "jpeg-bytes", contentType: "image/jpeg", updatedAtMs: 5_000 }), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "image/jpeg",
      "X-NDI-Frame-Updated-At": "5000",
    },
  });
});
