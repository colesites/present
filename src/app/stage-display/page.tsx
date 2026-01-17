"use client";

import { useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import type { Id } from "@/../convex/_generated/dataModel";
import { api } from "@/../convex/_generated/api";

export default function StageDisplayPage() {
  const { isSignedIn } = useAuth();
  const current = useQuery(api.users.getCurrentWithOrg);
  const playback = useQuery(
    api.playback.getByOrg,
    current?.org ? { orgId: current.org._id } : "skip",
  );
  const songs = useQuery(
    api.songs.listByOrg,
    current?.org ? { orgId: current.org._id } : "skip",
  );

  const currentSlide = useMemo(() => {
    if (!playback?.activeSlideId || !songs) return null;
    const [songId, indexString] = playback.activeSlideId.split(":");
    const song = songs.find((item) => item._id === (songId as Id<"songs">));
    if (!song) return null;
    const index = Number(indexString);
    return {
      current: song.slides[index],
      next: song.slides[index + 1] ?? null,
    };
  }, [playback?.activeSlideId, songs]);

  return (
    <div className="grid min-h-screen grid-cols-[2fr_1fr] gap-6 bg-black px-12 py-10 text-white">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-10">
        <p className="text-sm uppercase tracking-[0.3em] text-zinc-400">
          Current
        </p>
        <div className="mt-6 space-y-4">
          {isSignedIn && currentSlide?.current ? (
            <>
              {currentSlide.current.label ? (
                <span className="inline-flex items-center rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-200">
                  {currentSlide.current.label}
                </span>
              ) : null}
              <p className="whitespace-pre-line text-4xl font-semibold leading-tight">
                {currentSlide.current.text}
              </p>
            </>
          ) : (
            <p className="text-zinc-400">Awaiting slide</p>
          )}
        </div>
      </section>
      <section className="rounded-3xl border border-white/10 bg-white/5 p-8">
        <p className="text-sm uppercase tracking-[0.3em] text-zinc-400">Next</p>
        <div className="mt-6 space-y-3">
          {isSignedIn && currentSlide?.next ? (
            <>
              {currentSlide.next.label ? (
                <span className="inline-flex items-center rounded-full border border-white/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-200">
                  {currentSlide.next.label}
                </span>
              ) : null}
              <p className="whitespace-pre-line text-xl text-zinc-200">
                {currentSlide.next.text}
              </p>
            </>
          ) : (
            <p className="text-zinc-500">No upcoming slide</p>
          )}
        </div>
      </section>
    </div>
  );
}
