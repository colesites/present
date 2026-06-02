"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Pause,
  Play,
  Plus,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
} from "lucide-react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { cn } from "../../../renderer/shared/lib/utils";

interface AudioTabPanelProps {
  orgId: Id<"organizations"> | null;
}

type Playlist = {
  _id: string;
  name: string;
  order: number;
};

type Track = {
  _id: string;
  playlistId: string;
  title: string;
  localPath: string;
  durationSeconds?: number;
  order: number;
};

type LocalAudioState = {
  playlists: Playlist[];
  tracks: Track[];
};

const AUDIO_STORAGE_KEY = "present-local-audio-v1";

const createLocalId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
};

const readLocalAudioState = (): LocalAudioState => {
  if (typeof window === "undefined") {
    return { playlists: [], tracks: [] };
  }
  try {
    const raw = window.localStorage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) return { playlists: [], tracks: [] };
    const parsed = JSON.parse(raw) as Partial<LocalAudioState>;
    return {
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
    };
  } catch {
    return { playlists: [], tracks: [] };
  }
};

const writeLocalAudioState = (state: LocalAudioState): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(state));
};

const formatDuration = (seconds: number | undefined): string => {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

const pathToFileUrl = (path: string): string => {
  if (path.startsWith("local-media://")) return path;
  return `local-media://media${encodeURI(path.startsWith("/") ? path : `/${path}`)}`;
};

export function AudioTabPanel({ orgId: _orgId }: AudioTabPanelProps) {
  const [audioState, setAudioState] = useState<LocalAudioState>(() =>
    readLocalAudioState(),
  );

  const updateAudioState = (
    updater: (current: LocalAudioState) => LocalAudioState,
  ) => {
    setAudioState((current) => {
      const next = updater(current);
      writeLocalAudioState(next);
      return next;
    });
  };

  const sortedPlaylists = useMemo(
    () => [...audioState.playlists].sort((a, b) => a.order - b.order),
    [audioState.playlists],
  );
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);

  useEffect(() => {
    if (!activePlaylistId && sortedPlaylists.length > 0) {
      setActivePlaylistId(sortedPlaylists[0]._id);
    }
    if (
      activePlaylistId &&
      !sortedPlaylists.some((p) => p._id === activePlaylistId)
    ) {
      setActivePlaylistId(sortedPlaylists[0]?._id ?? null);
    }
  }, [activePlaylistId, sortedPlaylists]);

  const sortedTracks = useMemo(
    () =>
      audioState.tracks
        .filter((track) => track.playlistId === activePlaylistId)
        .sort((a, b) => a.order - b.order),
    [activePlaylistId, audioState.tracks],
  );

  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [isShuffle, setIsShuffle] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (audioRef.current === null && typeof window !== "undefined") {
    audioRef.current = new Audio();
  }
  const audio = audioRef.current;

  const currentTrack = useMemo(
    () => sortedTracks.find((t) => t._id === currentTrackId) ?? null,
    [currentTrackId, sortedTracks],
  );

  useEffect(() => {
    if (!audio) return;
    audio.volume = volume;
  }, [audio, volume]);

  useEffect(() => {
    if (!audio || !currentTrack) return;
    const src = pathToFileUrl(currentTrack.localPath);
    if (audio.src !== src) {
      audio.src = src;
    }
    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [audio, currentTrack, isPlaying]);

  useEffect(() => {
    if (!audio) return;
    const onTime = () => setProgress(audio.currentTime);
    const onEnd = () => playNext();
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, sortedTracks, currentTrackId, isShuffle]);

  const playNext = () => {
    if (sortedTracks.length === 0) return;
    if (isShuffle) {
      const candidates = sortedTracks.filter((t) => t._id !== currentTrackId);
      const next = candidates[Math.floor(Math.random() * candidates.length)];
      if (next) setCurrentTrackId(next._id);
      return;
    }
    const idx = sortedTracks.findIndex((t) => t._id === currentTrackId);
    const next = sortedTracks[(idx + 1) % sortedTracks.length];
    if (next) setCurrentTrackId(next._id);
  };

  const playPrev = () => {
    if (sortedTracks.length === 0) return;
    const idx = sortedTracks.findIndex((t) => t._id === currentTrackId);
    const prev =
      sortedTracks[(idx - 1 + sortedTracks.length) % sortedTracks.length];
    if (prev) setCurrentTrackId(prev._id);
  };

  const handleImport = async () => {
    if (!activePlaylistId) return;
    if (!window.electronAPI?.selectAudioFiles) return;
    const files = await window.electronAPI.selectAudioFiles();
    if (files.length === 0) return;
    updateAudioState((current) => {
      const playlistTracks = current.tracks.filter(
        (track) => track.playlistId === activePlaylistId,
      );
      const firstOrder =
        playlistTracks.reduce(
          (max, track) => (track.order > max ? track.order : max),
          -1,
        ) + 1;
      const nextTracks = files.map((file, index) => ({
        _id: createLocalId("track"),
        playlistId: activePlaylistId,
        title: file.name.replace(/\.[^.]+$/, "") || "Untitled",
        localPath: file.path,
        order: firstOrder + index,
      }));
      return {
        ...current,
        tracks: [...current.tracks, ...nextTracks],
      };
    });
  };

  const handleCreatePlaylist = () => {
    const id = createLocalId("playlist");
    updateAudioState((current) => ({
      ...current,
      playlists: [
        ...current.playlists,
        {
          _id: id,
          name: "Playlist",
          order:
            current.playlists.reduce(
              (max, playlist) =>
                playlist.order > max ? playlist.order : max,
              -1,
            ) + 1,
        },
      ],
    }));
    setActivePlaylistId(id);
  };

  useEffect(() => {
    if (sortedPlaylists.length === 0) {
      const id = createLocalId("playlist");
      updateAudioState((current) =>
        current.playlists.length > 0
          ? current
          : {
              ...current,
              playlists: [{ _id: id, name: "Playlist", order: 0 }],
            },
      );
      setActivePlaylistId(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedPlaylists.length]);

  const duration = audio?.duration && Number.isFinite(audio.duration)
    ? audio.duration
    : currentTrack?.durationSeconds ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Section header with playlist switcher */}
      <header className="flex items-center justify-between px-3 py-2">
        <PlaylistSwitcher
          playlists={sortedPlaylists}
          activeId={activePlaylistId}
          onSelect={setActivePlaylistId}
          onRename={(id, name) =>
            updateAudioState((current) => ({
              ...current,
              playlists: current.playlists.map((playlist) =>
                playlist._id === id
                  ? { ...playlist, name: name.trim() || "Playlist" }
                  : playlist,
              ),
            }))
          }
          onCreate={handleCreatePlaylist}
          onRemove={(id) => {
            updateAudioState((current) => ({
              playlists: current.playlists.filter(
                (playlist) => playlist._id !== id,
              ),
              tracks: current.tracks.filter((track) => track.playlistId !== id),
            }));
            if (activePlaylistId === id) {
              setActivePlaylistId(null);
            }
          }}
        />
      </header>

      {/* Track list */}
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {sortedTracks.length === 0 ? (
          <li className="flex h-full flex-col items-center justify-center gap-2 px-6 py-8 text-center">
            <p className="text-[12px] font-medium text-foreground">No tracks</p>
            <p className="text-[11px] text-muted-foreground">
              Import mp3/wav from disk to build your playlist.
            </p>
            <button
              type="button"
              onClick={handleImport}
              className="mt-2 rounded-sm bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Import Audio
            </button>
          </li>
        ) : (
          sortedTracks.map((track) => {
            const isCurrent = track._id === currentTrackId;
            return (
              <li
                key={track._id}
                className={cn(
                  "group flex items-center gap-2 border-b border-border/40 px-3 py-2 transition",
                  isCurrent
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (isCurrent) {
                      setIsPlaying((p) => !p);
                    } else {
                      setCurrentTrackId(track._id);
                      setIsPlaying(true);
                    }
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground/10 hover:bg-foreground/20"
                  aria-label={isCurrent && isPlaying ? "Pause" : "Play"}
                >
                  {isCurrent && isPlaying ? (
                    <Pause className="h-3 w-3" strokeWidth={2} />
                  ) : (
                    <Play className="h-3 w-3" strokeWidth={2} />
                  )}
                </button>
                <span className="flex-1 truncate text-[12px]">
                  {track.title}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground/80">
                  {formatDuration(track.durationSeconds)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    updateAudioState((current) => ({
                      ...current,
                      tracks: current.tracks.filter(
                        (candidate) => candidate._id !== track._id,
                      ),
                    }));
                    if (currentTrackId === track._id) {
                      setCurrentTrackId(null);
                      setIsPlaying(false);
                    }
                  }}
                  className="rounded-sm p-1 text-muted-foreground opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                  aria-label="Remove track"
                >
                  <Trash2 className="h-3 w-3" strokeWidth={1.6} />
                </button>
              </li>
            );
          })
        )}
      </ul>

      {/* Player footer */}
      <footer className="border-t border-border/70 bg-background/30 p-3">
        <p className="mb-2 truncate text-[11px] font-medium text-foreground">
          {currentTrack?.title ?? "—"}
        </p>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(progress, duration || 0)}
          onChange={(event) => {
            const next = Number(event.target.value);
            setProgress(next);
            if (audio) audio.currentTime = next;
          }}
          className="mb-1 w-full accent-primary"
        />
        <div className="mb-2 flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>{formatDuration(progress)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsShuffle((s) => !s)}
            className={cn(
              "rounded-sm p-1.5 transition",
              isShuffle
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-label="Shuffle"
            title="Shuffle"
          >
            <Shuffle className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={playPrev}
            className="rounded-sm p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Previous"
          >
            <SkipBack className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (!currentTrackId && sortedTracks[0]) {
                setCurrentTrackId(sortedTracks[0]._id);
                setIsPlaying(true);
                return;
              }
              setIsPlaying((p) => !p);
            }}
            className="rounded-full bg-primary p-2 text-primary-foreground hover:bg-primary/90"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Play className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
          <button
            type="button"
            onClick={playNext}
            className="rounded-sm p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Next"
          >
            <SkipForward className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <div className="flex flex-1 items-center gap-1.5 pl-2">
            <Volume2 className="h-3 w-3 text-muted-foreground" strokeWidth={1.6} />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              className="flex-1 accent-primary"
            />
          </div>
          <button
            type="button"
            onClick={handleImport}
            className="rounded-sm border border-border/70 bg-background/40 p-1.5 text-muted-foreground hover:border-primary/60 hover:text-foreground"
            aria-label="Import audio"
            title="Import audio"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
      </footer>
    </div>
  );
}

function PlaylistSwitcher({
  playlists,
  activeId,
  onSelect,
  onRename,
  onCreate,
  onRemove,
}: {
  playlists: Playlist[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCreate: () => void;
  onRemove: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const active = playlists.find((p) => p._id === activeId);

  return (
    <div className="relative flex-1">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center gap-1 text-[11px] font-medium text-foreground hover:text-primary"
      >
        {active?.name ?? "Playlist"}
        <ChevronDown className="h-3 w-3" strokeWidth={1.8} />
      </button>
      {isOpen && (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-sm border border-border/70 bg-card shadow-lg"
          onMouseLeave={() => setIsOpen(false)}
        >
          {playlists.map((playlist) => (
            <div
              key={playlist._id}
              className="group flex items-center gap-1.5 px-2 py-1.5 hover:bg-foreground/5"
            >
              <button
                type="button"
                onClick={() => {
                  onSelect(playlist._id);
                  setIsOpen(false);
                }}
                className="flex-1 truncate text-left text-[11px] text-foreground"
              >
                {playlist.name}
              </button>
              <input
                type="text"
                defaultValue={playlist.name}
                onBlur={(event) => {
                  if (event.target.value !== playlist.name) {
                    onRename(playlist._id, event.target.value);
                  }
                }}
                className="hidden flex-1 rounded-sm border border-border/60 bg-background/40 px-1 text-[11px] focus:outline-hidden group-focus-within:block"
              />
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(playlist._id);
                }}
                className="rounded-sm p-1 text-muted-foreground opacity-0 hover:text-red-400 group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" strokeWidth={1.6} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              onCreate();
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-1.5 border-t border-border/70 px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3 w-3" strokeWidth={1.6} />
            New playlist
          </button>
        </div>
      )}
    </div>
  );
}
