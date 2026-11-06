"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Dialog } from "../../renderer/shared/components/Dialog";
import { Button } from "../../renderer/shared/components/ui/button";
import { Input } from "../../renderer/shared/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../../renderer/shared/components/ui/resizable";
import { logFault, userFacingText, userMessage } from "../../renderer/shared/lib/user-error";
import { toast } from "sonner";
import { safelyUnlisten } from "../../renderer/tauri/electron-bridge";
import { isTauri } from "../../renderer/tauri/runtime";
import { listAudioDevices, type AudioDevice } from "../../renderer/tauri/sound";
import {
  acknowledgeExport,
  addRecordingTrack,
  armRecordingTrack,
  clearRecordingTrack,
  exportRecording,
  monitoringFeedbackRisk,
  recordingSnapshot,
  removeRecordingTrack,
  renameRecordingTrack,
  resolveFeedback,
  setChannelStrip,
  setRecordingInput,
  setTrackMix,
  startRecording,
  stopRecording,
  type ChannelStrip,
  type RecordingFormat,
  type RecordingQuality,
  type RecordingSnapshot,
  type RecordingTrack,
  type TrackMix,
} from "../../renderer/tauri/recorder";
import { ControlBar, type TransportState } from "./components/ControlBar";
import { RecordingSettings } from "./components/RecordingSettings";
import { TrackArea } from "./components/TrackArea";
import { useAudioPlayback } from "./hooks/useAudioPlayback";

const FORMATS: { id: RecordingFormat; label: string }[] = [
  { id: "aac", label: "AAC" },
  { id: "mp3", label: "MP3" },
  { id: "aiff", label: "AIFF" },
  { id: "wave", label: "WAVE" },
];

const COMPRESSED: { id: RecordingQuality; label: string }[] = [
  { id: "low", label: "Low Quality (64 kbit/s)" },
  { id: "medium", label: "Medium Quality (128 kbit/s)" },
  { id: "high", label: "High Quality (192 kbit/s)" },
  { id: "highest", label: "Highest Quality (256 kbit/s)" },
];

const UNCOMPRESSED: { id: RecordingQuality; label: string }[] = [
  { id: "low", label: "Low Quality (22 kHz)" },
  { id: "medium", label: "Medium Quality (44.1 kHz)" },
  { id: "high", label: "High Quality (48 kHz)" },
  { id: "highest", label: "Highest Quality (48 kHz, 24-bit)" },
];

const EMPTY: RecordingSnapshot = {
  inputId: null,
  tracks: [],
  armedTrackId: null,
  recordingTrackId: null,
  pausedTrackId: null,
  level: 0,
  warning: null,
  feedback: false,
  exportRequested: false,
  formats: ["mp3", "aiff", "wave"],
  peaksPerSecond: 10,
};

function fileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/** Settings the window has changed. The window is their author, so a snapshot
 * read before a change reached the app does not move a slider back. */
type Local = Record<number, { strip?: ChannelStrip; mix?: TrackMix }>;

export function RecorderWindow() {
  const [snapshot, setSnapshot] = useState<RecordingSnapshot | null>(null);
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [local, setLocal] = useState<Local>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportName, setExportName] = useState("Recording");
  const [format, setFormat] = useState<RecordingFormat>("mp3");
  const [quality, setQuality] = useState<RecordingQuality>("medium");
  const [separate, setSeparate] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(null);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [transportPlaying, setTransportPlaying] = useState(false);
  /** Monitoring was asked for on a track whose input and speakers are one source. */
  const [feedbackAsk, setFeedbackAsk] = useState<number | null>(null);
  const reported = useRef<string | null>(null);
  const warned = useRef<string | null>(null);
  const exportArmed = useRef(false);
  const exportNameForMenu = useRef("Recording");

  const audio = useAudioPlayback();
  const transportPlayingRef = useRef(false);
  const playheadRef = useRef(0);
  const transportFrame = useRef<number | null>(null);
  const transportOrigin = useRef({ perf: 0, seconds: 0 });
  /** Waiting for the takes to load: the playhead holds still until sound starts. */
  const audioPending = useRef(false);

  const recording = snapshot?.recordingTrackId != null;
  const view = snapshot ?? EMPTY;
  const activeLevel = view.inputId ? view.level : 0;

  const tracks: RecordingTrack[] = useMemo(
    () =>
      view.tracks.map((track) => ({
        ...track,
        strip: local[track.id]?.strip ?? track.strip,
        mix: local[track.id]?.mix ?? track.mix,
      })),
    [view.tracks, local],
  );
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  const selected =
    tracks.find((track) => track.id === chosen)?.id ??
    view.recordingTrackId ??
    view.armedTrackId ??
    tracks[0]?.id ??
    null;
  const selectedTrack = tracks.find((track) => track.id === selected) ?? null;

  // The app records onto, and monitors through, the selected track.
  useEffect(() => {
    if (selected == null || snapshot == null || snapshot.armedTrackId === selected || recording) return;
    void armRecordingTrack(selected).catch((): undefined => undefined);
  }, [selected, snapshot, recording]);

  const noteError = useCallback((caught: unknown, fallback: string) => {
    const written = userFacingText(caught);
    const message = written ?? fallback;
    if (reported.current === message) return;
    if (!written) logFault(caught, "recorder");
    reported.current = message;
    toast.error(message, { id: "recorder" });
  }, []);

  const openExport = useCallback((name: string) => {
    if (!exportArmed.current) setExportName(name);
    exportArmed.current = true;
    setExportOpen(true);
    if (isTauri()) void acknowledgeExport().catch((): undefined => undefined);
  }, []);

  const accept = useCallback(
    (next: RecordingSnapshot) => {
      reported.current = null;
      setSnapshot(next);
      if (next.exportRequested) {
        const track =
          next.tracks.find((item) => item.id === (next.pausedTrackId ?? next.tracks[0]?.id)) ?? next.tracks[0];
        openExport(track?.name || "Recording");
      } else {
        exportArmed.current = false;
      }
    },
    [openExport],
  );

  const refresh = useCallback(async () => {
    accept(await recordingSnapshot());
  }, [accept]);

  useEffect(() => {
    let stop = false;
    let inFlight = false;
    const tick = () => {
      if (inFlight) return;
      inFlight = true;
      void recordingSnapshot()
        .then((next) => {
          if (!stop) accept(next);
        })
        .catch((caught: unknown) => {
          if (!stop) noteError(caught, "The recording could not be read.");
        })
        .finally(() => {
          inFlight = false;
        });
    };
    tick();
    const id = window.setInterval(tick, recording ? 60 : 120);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [accept, noteError, recording]);

  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen("recorder:export", () => {
      openExport(exportNameForMenu.current);
    });
    return () => {
      void unlisten.then((stop) => safelyUnlisten(stop));
    };
  }, [openExport]);

  useEffect(() => {
    let stop = false;
    void listAudioDevices()
      .then((devices) => {
        if (!stop) setInputs(devices.inputs);
      })
      .catch((caught: unknown) => {
        if (!stop) toast.error(userMessage(caught, "The microphones could not be listed.", "recorder"), { id: "recorder" });
      });
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    const warning = snapshot?.warning ?? null;
    if (warning === warned.current) return;
    warned.current = warning;
    if (warning) toast.error(warning, { id: "recorder" });
  }, [snapshot?.warning]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const run = useCallback(
    async (action: () => Promise<void>, fallback: string) => {
      setBusy(true);
      try {
        await action();
        await refresh();
      } catch (caught) {
        toast.error(userMessage(caught, fallback, "recorder"), { id: "recorder" });
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const formats = FORMATS.filter((item) => view.formats.includes(item.id));
  const chosenFormat = formats.some((item) => item.id === format) ? format : (formats[0]?.id ?? "mp3");

  const onExport = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const paths = await exportRecording(chosenFormat, quality, exportName, separate ? "separate" : "mix");
      if (paths.length === 1) setNotice(`Saved ${fileName(paths[0])}`);
      else if (paths.length > 1) setNotice(`Saved ${paths.length} tracks`);
      if (paths.length > 0) {
        exportArmed.current = false;
        setExportOpen(false);
      }
    } catch (caught) {
      toast.error(userMessage(caught, "The recording could not be exported.", "recorder"), { id: "recorder" });
    } finally {
      setBusy(false);
      await refresh().catch((): undefined => undefined);
    }
  };

  const qualities = chosenFormat === "aac" || chosenFormat === "mp3" ? COMPRESSED : UNCOMPRESSED;
  const hasAudio = tracks.some((track) => track.seconds > 0);
  exportNameForMenu.current = selectedTrack?.name || tracks[0]?.name || "Recording";

  const state: TransportState = recording
    ? "recording"
    : transportPlaying
      ? "playing"
      : playbackSeconds > 0.05
        ? "paused"
        : "ready";
  const canHold = !busy && (recording || view.pausedTrackId != null);
  const canRecord = !busy && snapshot !== null && selected != null;

  // ── Transport ──────────────────────────────────────────────────────────

  const stopClock = useCallback(() => {
    if (transportFrame.current != null) {
      cancelAnimationFrame(transportFrame.current);
      transportFrame.current = null;
    }
  }, []);

  const park = useCallback((seconds: number) => {
    const at = Math.max(0, seconds);
    playheadRef.current = at;
    setPlaybackSeconds(at);
  }, []);

  const pauseTransport = useCallback(() => {
    transportPlayingRef.current = false;
    audioPending.current = false;
    setTransportPlaying(false);
    stopClock();
    audio.stop();
  }, [audio, stopClock]);

  /**
   * Run the clock from `from`, playing every track but `except` (the one
   * being recorded). The clock follows the audio once it sounds, so the
   * playhead is where the music is.
   */
  const startTransport = useCallback(
    (from: number, except: number | null = null) => {
      stopClock();
      const startAt = Math.max(0, from);
      park(startAt);
      transportOrigin.current = { perf: performance.now(), seconds: startAt };
      transportPlayingRef.current = true;
      audioPending.current = true;
      setTransportPlaying(true);
      const tick = () => {
        if (!transportPlayingRef.current) return;
        const heard = audio.position();
        let next: number;
        if (heard != null) next = heard;
        else if (audioPending.current) next = startAt;
        else next = transportOrigin.current.seconds + (performance.now() - transportOrigin.current.perf) / 1000;
        playheadRef.current = next;
        setPlaybackSeconds(next);
        transportFrame.current = requestAnimationFrame(tick);
      };
      transportFrame.current = requestAnimationFrame(tick);
      const playable = tracksRef.current.filter((track) => track.id !== except && !track.recording);
      void audio.play(startAt, playable).then((sounding) => {
        if (!transportPlayingRef.current || !audioPending.current) return;
        audioPending.current = false;
        // Nothing to hear: keep time from now.
        if (!sounding) transportOrigin.current = { perf: performance.now(), seconds: startAt };
      });
    },
    [audio, park, stopClock],
  );

  useEffect(() => stopClock, [stopClock]);

  const finishRecording = useCallback(() => {
    const at = playheadRef.current;
    pauseTransport();
    park(at);
    void run(() => stopRecording(), "The recording could not be stopped.");
  }, [park, pauseTransport, run]);

  const onPlayToggle = useCallback(() => {
    if (recording) {
      finishRecording();
      return;
    }
    if (transportPlayingRef.current) {
      pauseTransport();
      return;
    }
    startTransport(playheadRef.current);
  }, [recording, finishRecording, pauseTransport, startTransport]);

  const onRecordToggle = useCallback(() => {
    if (recording) {
      finishRecording();
      return;
    }
    if (selected == null) return;
    const track = tracksRef.current.find((item) => item.id === selected);
    // A paused take continues where it stopped; anything else starts at the playhead.
    const at =
      view.pausedTrackId === selected && track ? track.start + track.seconds : playheadRef.current;
    pauseTransport();
    park(at);
    void run(async () => {
      await startRecording(selected, at);
      // The other tracks play along, as they do in GarageBand.
      startTransport(at, selected);
    }, "The microphone could not be opened.");
  }, [recording, finishRecording, selected, view.pausedTrackId, pauseTransport, park, run, startTransport]);

  const onStopAll = useCallback(() => {
    if (recording || view.pausedTrackId != null) {
      finishRecording();
      return;
    }
    const at = playheadRef.current;
    pauseTransport();
    park(at);
  }, [recording, view.pausedTrackId, finishRecording, pauseTransport, park]);

  const onGoToBeginning = useCallback(() => {
    if (recording) return;
    if (transportPlayingRef.current) startTransport(0);
    else park(0);
  }, [recording, park, startTransport]);

  const onSeek = useCallback(
    (seconds: number) => {
      if (recording) return;
      if (transportPlayingRef.current) startTransport(Math.max(0, seconds));
      else park(seconds);
    },
    [recording, park, startTransport],
  );

  const onRewind = useCallback(() => onSeek(Math.max(0, playheadRef.current - 5)), [onSeek]);
  const onForward = useCallback(() => onSeek(playheadRef.current + 5), [onSeek]);

  // A new take, or a smart-control change, is heard straight away while playing.
  const revisions = tracks.map((track) => `${track.id}:${track.revision}`).join(",");
  const lastRevisions = useRef(revisions);
  useEffect(() => {
    if (lastRevisions.current === revisions) return;
    lastRevisions.current = revisions;
    if (!transportPlayingRef.current || recording) return;
    const id = window.setTimeout(() => {
      if (transportPlayingRef.current && !recording) startTransport(playheadRef.current);
    }, 150);
    return () => window.clearTimeout(id);
  }, [revisions, recording, startTransport]);

  // ── Track settings ─────────────────────────────────────────────────────

  const applyStrip = useCallback((id: number, next: ChannelStrip) => {
    setLocal((before) => ({ ...before, [id]: { ...before[id], strip: next } }));
    void setChannelStrip(id, next).catch((caught: unknown) =>
      noteError(caught, "The setting could not be changed."),
    );
  }, [noteError]);

  const updateStrip = useCallback(
    (next: ChannelStrip) => {
      if (selected != null) applyStrip(selected, next);
    },
    [selected, applyStrip],
  );

  const updateMix = useCallback(
    (id: number, mix: TrackMix) => {
      setLocal((before) => ({ ...before, [id]: { ...before[id], mix } }));
      audio.setMixes(tracksRef.current.map((track) => (track.id === id ? { id, mix } : track)));
      void setTrackMix(id, mix).catch((caught: unknown) =>
        noteError(caught, "The track could not be changed."),
      );
    },
    [audio, noteError],
  );

  /** Input monitoring on a track. Turning it on where the input and the
   * speakers are one source asks about feedback protection first. */
  const toggleMonitoring = useCallback(
    (id: number) => {
      const track = tracksRef.current.find((item) => item.id === id);
      if (!track) return;
      setChosen(id);
      if (track.strip.monitor) {
        applyStrip(id, { ...track.strip, monitor: false });
        return;
      }
      if (track.strip.feedbackProtection) {
        applyStrip(id, { ...track.strip, monitor: true });
        return;
      }
      void monitoringFeedbackRisk()
        .catch((): boolean => false)
        .then((risk) => {
          const now = tracksRef.current.find((item) => item.id === id);
          if (!now) return;
          if (risk) setFeedbackAsk(id);
          else applyStrip(id, { ...now.strip, monitor: true });
        });
    },
    [applyStrip],
  );

  const answerFeedbackAsk = (choice: "protect" | "anyway" | "cancel") => {
    const id = feedbackAsk;
    setFeedbackAsk(null);
    if (id == null || choice === "cancel") return;
    const track = tracksRef.current.find((item) => item.id === id);
    if (!track) return;
    applyStrip(id, { ...track.strip, monitor: true, feedbackProtection: choice === "protect" || track.strip.feedbackProtection });
  };

  const answerFeedback = (keepMonitoring: boolean) => {
    const armed = view.armedTrackId;
    if (!keepMonitoring && armed != null) {
      const track = tracksRef.current.find((item) => item.id === armed);
      if (track) setLocal((before) => ({ ...before, [armed]: { ...before[armed], strip: { ...track.strip, monitor: false } } }));
    }
    void resolveFeedback(keepMonitoring)
      .then(refresh)
      .catch((caught: unknown) => noteError(caught, "Monitoring could not be changed."));
  };

  const deleteTrack = useCallback(
    (id: number) => {
      if (busy || recording) return;
      void run(async () => {
        await removeRecordingTrack(id);
        audio.invalidate(id);
        setSelectedRegionId(null);
      }, "The track could not be deleted.");
    },
    [busy, recording, run, audio],
  );

  const deleteRecording = useCallback(
    (id: number) => {
      if (busy || recording) return;
      void run(async () => {
        await clearRecordingTrack(id);
        audio.invalidate(id);
        setSelectedRegionId(null);
      }, "The recording could not be deleted.");
    },
    [busy, recording, run, audio],
  );

  const keys = useRef({
    onRecordToggle,
    onPlayToggle,
    onStopAll,
    onGoToBeginning,
    deleteTrack,
    deleteRecording,
    updateMix,
    selected,
    selectedRegionId,
    tracks,
  });
  keys.current = {
    onRecordToggle,
    onPlayToggle,
    onStopAll,
    onGoToBeginning,
    deleteTrack,
    deleteRecording,
    updateMix,
    selected,
    selectedRegionId,
    tracks,
  };

  const dialogOpen = exportOpen || feedbackAsk != null || view.feedback;
  useEffect(() => {
    if (dialogOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, select, textarea, [contenteditable='true'], [role='slider']")) return;
      const now = keys.current;
      const current = now.tracks.find((track) => track.id === now.selected);

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (now.selectedRegionId != null) now.deleteRecording(now.selectedRegionId);
        else if (now.selected != null) now.deleteTrack(now.selected);
      } else if (event.key === "Enter" || event.key === "Return") {
        event.preventDefault();
        now.onGoToBeginning();
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        now.onRecordToggle();
      } else if (event.key === " ") {
        event.preventDefault();
        now.onPlayToggle();
      } else if (event.key === "Escape") {
        event.preventDefault();
        now.onStopAll();
      } else if ((event.key === "m" || event.key === "M") && current) {
        event.preventDefault();
        now.updateMix(current.id, { ...current.mix, mute: !current.mix.mute });
      } else if ((event.key === "s" || event.key === "S") && current) {
        event.preventDefault();
        now.updateMix(current.id, { ...current.mix, solo: !current.mix.solo });
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (now.tracks.length === 0) return;
        event.preventDefault();
        const at = now.tracks.findIndex((track) => track.id === now.selected);
        const next = Math.max(0, Math.min(now.tracks.length - 1, at + (event.key === "ArrowUp" ? -1 : 1)));
        setChosen(now.tracks[next].id);
        setSelectedRegionId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground select-none">
      <ControlBar
        state={state}
        seconds={playbackSeconds}
        settingsOpen={settingsOpen}
        canRecord={canRecord}
        canHold={canHold}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        onRewind={onRewind}
        onForward={onForward}
        onGoToBeginning={onGoToBeginning}
        onStop={onStopAll}
        onPlay={onPlayToggle}
        onRecord={onRecordToggle}
      />

      {notice ? (
        <p role="status" className="shrink-0 border-b border-border bg-emerald-500/10 px-4 py-1.5 text-xs text-emerald-400">
          {notice}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ResizablePanelGroup direction="vertical" className="h-full w-full" autoSaveId="present-recorder-smart-controls">
          <ResizablePanel defaultSize={settingsOpen ? 46 : 100} minSize={22} maxSize={settingsOpen ? 68 : 100} order={1}>
            <div className="h-full w-full overflow-hidden">
              <TrackArea
                tracks={tracks}
                armedId={selected}
                selectedRegionId={selectedRegionId}
                level={activeLevel}
                playhead={playbackSeconds}
                playing={transportPlaying}
                recordingActive={recording}
                busy={busy || snapshot === null}
                peaksPerSecond={view.peaksPerSecond}
                onArm={(id) => {
                  if (recording) return;
                  setChosen(id);
                  setSelectedRegionId(null);
                }}
                onSelectRegion={(id) => setSelectedRegionId(id)}
                onRename={(id, name) => void run(() => renameRecordingTrack(id, name), "The track could not be renamed.")}
                onAdd={() => {
                  void run(async () => {
                    const added = await addRecordingTrack();
                    setChosen(added.id);
                    setSelectedRegionId(null);
                  }, "A track could not be added.");
                }}
                onDeleteTrack={deleteTrack}
                onDeleteRecording={deleteRecording}
                onSeek={onSeek}
                onMonitoring={toggleMonitoring}
                onMix={updateMix}
              />
            </div>
          </ResizablePanel>

          {settingsOpen && <ResizableHandle />}
          {settingsOpen && selectedTrack && (
            <ResizablePanel defaultSize={54} minSize={36} maxSize={78} order={2}>
              <RecordingSettings
                trackName={selectedTrack.name}
                inputId={view.inputId}
                inputs={inputs}
                level={activeLevel}
                recording={recording}
                inputLocked={recording || busy || snapshot === null}
                canExport={hasAudio && !recording && !busy}
                strip={selectedTrack.strip}
                onInput={(deviceId) => void run(() => setRecordingInput(deviceId), "The microphone could not be changed.")}
                onExport={() => openExport(exportNameForMenu.current)}
                onStrip={updateStrip}
                onMonitoring={() => toggleMonitoring(selectedTrack.id)}
              />
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      </div>

      {feedbackAsk != null ? (
        <Dialog title="Feedback Protection" contentClassName="max-w-md" onClose={() => answerFeedbackAsk("cancel")}>
          <div className="space-y-4">
            <p className="text-sm">
              Your microphone and speakers are on the same device. Monitoring through the speakers can cause loud
              feedback.
            </p>
            <p className="text-xs text-muted-foreground">
              Feedback protection mutes monitoring if feedback starts. Headphones avoid it altogether.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => answerFeedbackAsk("cancel")}>
                Cancel
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => answerFeedbackAsk("anyway")}>
                Monitor Without It
              </Button>
              <Button type="button" size="sm" onClick={() => answerFeedbackAsk("protect")}>
                Turn On Feedback Protection
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {view.feedback && feedbackAsk == null ? (
        <Dialog title="Feedback Detected" contentClassName="max-w-md" onClose={() => answerFeedback(false)}>
          <div className="space-y-4">
            <p className="text-sm">
              Feedback was heard, so monitoring has been muted. Recording carries on.
            </p>
            <p className="text-xs text-muted-foreground">
              Turn the speakers down or use headphones before monitoring again.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => answerFeedback(true)}>
                Monitor Again
              </Button>
              <Button type="button" size="sm" onClick={() => answerFeedback(false)}>
                Turn Monitoring Off
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {/* Export Dialog */}
      {exportOpen ? (
        <Dialog
          title="Export Recording"
          contentClassName="max-w-md"
          onClose={() => {
            exportArmed.current = false;
            setExportOpen(false);
          }}
        >
          <div className="space-y-4">
            <label className="block text-xs text-muted-foreground">
              Save As
              <Input
                value={exportName}
                className="mt-1"
                disabled={separate}
                onChange={(event) => setExportName(event.target.value)}
              />
            </label>
            <fieldset>
              <legend className="text-xs text-muted-foreground">Format</legend>
              <div className="mt-2 flex gap-4">
                {formats.map((item) => (
                  <label key={item.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name="recording-format"
                      checked={chosenFormat === item.id}
                      onChange={() => setFormat(item.id)}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-xs text-muted-foreground">
              Quality
              <select
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                value={quality}
                onChange={(event) => setQuality(event.target.value as RecordingQuality)}
              >
                {qualities.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={separate}
                onChange={(event) => setSeparate(event.target.checked)}
              />
              Each track as its own file
            </label>
            {recording ? (
              <p className="text-xs text-destructive">Pause or stop the recording before exporting.</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  exportArmed.current = false;
                  setExportOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy || recording || !hasAudio}
                onClick={() => void onExport()}
              >
                Export
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
