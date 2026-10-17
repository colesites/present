"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { Circle, Pause, Plus, Square, Trash2 } from "lucide-react";
import { Dialog } from "../../renderer/shared/components/Dialog";
import { Button } from "../../renderer/shared/components/ui/button";
import { Input } from "../../renderer/shared/components/ui/input";
import { logFault, userFacingText, userMessage } from "../../renderer/shared/lib/user-error";
import { cn } from "../../renderer/shared/lib/utils";
import { safelyUnlisten } from "../../renderer/tauri/electron-bridge";
import { isTauri } from "../../renderer/tauri/runtime";
import { listAudioDevices, type AudioDevice } from "../../renderer/tauri/sound";
import {
  acknowledgeExport,
  addRecordingTrack,
  exportRecording,
  pauseRecording,
  recordingSnapshot,
  removeRecordingTrack,
  renameRecordingTrack,
  setRecordingInput,
  startRecording,
  stopRecording,
  type RecordingFormat,
  type RecordingQuality,
  type RecordingSnapshot,
  type RecordingTrack,
} from "../../renderer/tauri/recorder";

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
  recordingTrackId: null,
  pausedTrackId: null,
  level: 0,
  warning: null,
  exportRequested: false,
  formats: ["mp3", "aiff", "wave"],
};

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.0";
  const total = Math.min(seconds, 99 * 60);
  const minutes = Math.floor(total / 60);
  const remain = total - minutes * 60;
  const whole = Math.floor(remain);
  const tenth = Math.floor((remain - whole) * 10);
  return `${minutes}:${whole.toString().padStart(2, "0")}.${tenth}`;
}

function formatMark(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${remain.toString().padStart(2, "0")}`;
}

function fileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function RecorderWindow() {
  const [snapshot, setSnapshot] = useState<RecordingSnapshot | null>(null);
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportName, setExportName] = useState("Recording");
  const [format, setFormat] = useState<RecordingFormat>("mp3");
  const [quality, setQuality] = useState<RecordingQuality>("medium");
  const [separate, setSeparate] = useState(false);
  const reported = useRef<string | null>(null);
  const exportArmed = useRef(false);
  const exportNameForMenu = useRef("Recording");

  const recording = snapshot?.recordingTrackId != null;
  const view = snapshot ?? EMPTY;
  const selected =
    view.tracks.find((track) => track.id === chosen)?.id ??
    view.recordingTrackId ??
    view.pausedTrackId ??
    view.tracks[0]?.id ??
    null;
  const clockTrack =
    view.tracks.find((track) => track.recording) ??
    view.tracks.find((track) => track.paused) ??
    view.tracks.find((track) => track.id === selected);
  const span = Math.max(30, ...view.tracks.map((track) => track.seconds), 0) * (view.tracks.some((track) => track.seconds > 20) ? 1.08 : 1);

  const noteError = useCallback((caught: unknown, fallback: string) => {
    const written = userFacingText(caught);
    const message = written ?? fallback;
    if (reported.current !== message) {
      if (!written) logFault(caught, "recorder");
      reported.current = message;
    }
    setError(message);
  }, []);

  const openExport = useCallback((name: string) => {
    if (!exportArmed.current) setExportName(name);
    exportArmed.current = true;
    setExportOpen(true);
    if (isTauri()) void acknowledgeExport().catch((): undefined => undefined);
  }, []);

  const refresh = useCallback(async () => {
    const next = await recordingSnapshot();
    reported.current = null;
    setSnapshot(next);
    setError((current) => (current === "The recording could not be read." ? null : current));
    if (next.exportRequested) {
      const track =
        next.tracks.find((item) => item.id === (next.pausedTrackId ?? next.tracks[0]?.id)) ??
        next.tracks[0];
      openExport(track?.name || "Recording");
    } else {
      exportArmed.current = false;
    }
  }, [openExport]);

  useEffect(() => {
    let stop = false;
    const tick = () => {
      void recordingSnapshot()
        .then((next) => {
          if (stop) return;
          reported.current = null;
          setSnapshot(next);
          setError((current) => (current === "The recording could not be read." ? null : current));
          if (next.exportRequested) {
            const track = next.tracks.find((item) => item.seconds > 0) ?? next.tracks[0];
            openExport(track?.name || "Recording");
          } else {
            exportArmed.current = false;
          }
        })
        .catch((caught: unknown) => {
          if (!stop) noteError(caught, "The recording could not be read.");
        });
    };
    tick();
    const id = window.setInterval(tick, recording ? 80 : 1000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [noteError, openExport, recording]);

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
        if (!stop) setError(userMessage(caught, "The microphones could not be listed.", "recorder"));
      });
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const run = useCallback(
    async (action: () => Promise<void>, fallback: string) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        await refresh();
      } catch (caught) {
        setError(userMessage(caught, fallback, "recorder"));
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
    setError(null);
    setNotice(null);
    try {
      const paths = await exportRecording(
        chosenFormat,
        quality,
        exportName,
        separate ? "separate" : "mix",
      );
      if (paths.length === 1) setNotice(`Saved ${fileName(paths[0])}`);
      else if (paths.length > 1) setNotice(`Saved ${paths.length} tracks`);
      if (paths.length > 0) {
        exportArmed.current = false;
        setExportOpen(false);
      }
    } catch (caught) {
      setError(userMessage(caught, "The recording could not be exported.", "recorder"));
    } finally {
      setBusy(false);
      await refresh().catch((): undefined => undefined);
    }
  };

  const qualities = chosenFormat === "aac" || chosenFormat === "mp3" ? COMPRESSED : UNCOMPRESSED;
  const hasAudio = view.tracks.some((track) => track.seconds > 0);
  const markStep = span > 180 ? 30 : span > 60 ? 10 : 5;
  exportNameForMenu.current =
    view.tracks.find((track) => track.id === selected)?.name || view.tracks[0]?.name || "Recording";

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3">
        <div className="w-[5.5rem] rounded-md bg-black/50 px-2 py-1 text-center font-mono text-sm text-foreground tabular-nums">
          {formatClock(clockTrack?.seconds ?? 0)}
        </div>
        <TransportButton
          label={recording ? "Recording" : "Record"}
          pressed={recording}
          disabled={busy || snapshot === null || selected == null}
          onClick={() => {
            if (selected == null) return;
            void run(() => startRecording(selected), "The microphone could not be opened.");
          }}
          className={recording ? "bg-red-600 text-white" : "text-red-500"}
        >
          <Circle className={cn("size-3.5", recording && "fill-current")} />
        </TransportButton>
        <TransportButton
          label="Pause"
          pressed={view.pausedTrackId != null && !recording}
          disabled={busy || (!recording && view.pausedTrackId == null)}
          onClick={() => void run(() => pauseRecording(), "The recording could not be paused.")}
        >
          <Pause className="size-3.5 fill-current" />
        </TransportButton>
        <TransportButton
          label="Stop"
          disabled={busy || (!recording && view.pausedTrackId == null)}
          onClick={() => void run(() => stopRecording(), "The recording could not be stopped.")}
        >
          <Square className="size-3 fill-current" />
        </TransportButton>
        <div className="min-w-0 flex-1" />
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          Microphone
          <select
            className="h-8 max-w-56 rounded-md border border-border bg-background px-2 text-xs text-foreground disabled:opacity-50"
            value={view.inputId ?? ""}
            disabled={recording || busy || snapshot === null}
            onChange={(event) => {
              const deviceId = event.target.value || null;
              void run(() => setRecordingInput(deviceId), "The microphone could not be changed.");
            }}
          >
            <option value="">System default</option>
            {view.inputId && !inputs.some((device) => device.id === view.inputId) ? (
              <option value={view.inputId}>Previous microphone</option>
            ) : null}
            {inputs.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
                {device.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error || view.warning ? (
        <p className="shrink-0 border-b border-border px-4 py-2 text-xs text-destructive">
          {error ?? view.warning}
        </p>
      ) : null}
      {notice ? (
        <p className="shrink-0 border-b border-border px-4 py-2 text-xs text-muted-foreground">{notice}</p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 border-b border-border">
          <div className="w-56 shrink-0 border-r border-border" />
          <div className="relative h-7 min-w-0 flex-1">
            {Array.from({ length: Math.floor(span / markStep) + 1 }, (_, index) => index * markStep)
              .filter((mark) => mark <= span)
              .map((mark) => (
                <span
                  key={mark}
                  className="absolute top-1.5 pl-1 text-[10px] text-muted-foreground tabular-nums"
                  style={{ left: `${(mark / span) * 100}%` }}
                >
                  {formatMark(mark)}
                </span>
              ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {view.tracks.map((track) => (
            <div key={track.id} className="flex">
              <TrackHeader
                track={track}
                selected={track.id === selected}
                level={track.recording ? view.level : 0}
                canDelete={view.tracks.length > 1 || track.seconds > 0}
                busy={busy || snapshot === null}
                onSelect={() => setChosen(track.id)}
                onRename={(name) =>
                  void run(() => renameRecordingTrack(track.id, name), "The track could not be renamed.")
                }
                onDelete={() =>
                  void run(() => removeRecordingTrack(track.id), "The track could not be removed.")
                }
              />
              <button
                type="button"
                aria-label={track.name}
                className={cn(
                  "relative block h-[4.5rem] min-w-0 flex-1 border-b border-border text-left",
                  track.id === selected && "bg-sky-500/5",
                )}
                onClick={() => setChosen(track.id)}
              >
                {track.seconds > 0 ? (
                  <span
                    className={cn(
                      "absolute inset-y-1 left-0 overflow-hidden rounded-sm",
                      track.recording ? "bg-red-600/25" : "bg-foreground/5",
                    )}
                    style={{ width: `${Math.min(100, (track.seconds / span) * 100)}%` }}
                  >
                    <Waveform peaks={track.peaks} hot={track.recording} />
                    {track.recording ? <span className="absolute inset-y-0 right-0 w-px bg-red-500" /> : null}
                  </span>
                ) : null}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="flex h-10 w-56 items-center gap-1.5 border-r border-border px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            disabled={busy || snapshot === null}
            onClick={() => {
              void run(async () => {
                const added = await addRecordingTrack();
                setChosen(added.id);
              }, "A track could not be added.");
            }}
          >
            <Plus className="size-3.5" />
            Track
          </button>
        </div>
      </div>

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

function TransportButton({
  label,
  pressed,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground disabled:opacity-40",
        pressed && "border-transparent",
        className,
      )}
    >
      {children}
    </button>
  );
}

function TrackHeader({
  track,
  selected,
  level,
  canDelete,
  busy,
  onSelect,
  onRename,
  onDelete,
}: {
  track: RecordingTrack;
  selected: boolean;
  level: number;
  canDelete: boolean;
  busy: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? track.name;
  const commit = () => {
    const next = name.trim();
    setDraft(null);
    if (next && next !== track.name) onRename(next);
  };

  return (
    <div
      className={cn(
        "flex h-[4.5rem] w-56 shrink-0 flex-col justify-center gap-1 border-r border-b border-border px-3",
        selected && "border-l-2 border-l-sky-500 bg-sky-500/5",
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-1">
        <input
          value={name}
          aria-label="Track name"
          className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
          {formatMark(track.seconds)}
        </span>
        <button
          type="button"
          aria-label={`Remove ${track.name}`}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={busy || !canDelete || track.recording}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={cn("h-full rounded-full", track.recording ? "bg-emerald-500" : "bg-foreground/20")}
          style={{ width: `${Math.min(100, Math.round((track.recording ? level : 0) * 100))}%` }}
        />
      </div>
    </div>
  );
}

function Waveform({ peaks, hot }: { peaks: number[]; hot: boolean }) {
  if (peaks.length === 0) return null;
  const height = 64;
  const mid = height / 2;
  return (
    <svg
      viewBox={`0 0 ${peaks.length} ${height}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      aria-hidden
    >
      {peaks.map((peak, index) => {
        const amp = Math.max(0.6, Math.min(1, peak) * (mid - 4));
        return (
          <line
            key={index}
            x1={index + 0.5}
            x2={index + 0.5}
            y1={mid - amp}
            y2={mid + amp}
            stroke={hot ? "#fecaca" : "currentColor"}
            strokeWidth={0.8}
            className={hot ? undefined : "text-foreground/70"}
          />
        );
      })}
    </svg>
  );
}
