"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { ChevronLeft, Sparkles } from "lucide-react";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import {
  breakLyricsIntoChunks,
  cleanLyricsLocally,
  lyricsFromSlides,
  slidesFromLyrics,
  stripBracketsForDisplay,
  type StoredSlide,
} from "../../../../../../../packages/shared/src/lyrics";
import type { DashboardLibraryItem } from "../../types";
import { useDashboard } from "../DashboardShell";
import { formatRelative } from "../format";
import { Button, Dialog, EmptyState, Field, Notice, Page, Select, Skeleton, cx, fieldClass, friendlyError } from "../ui";
import { useCategories } from "./LibraryListPage";

const newSlideId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `slide_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;

/** Only the fields Convex's slide validator accepts. */
const storable = (slide: StoredSlide): StoredSlide => {
  const keys = ["id", "text", "elements", "label", "labelColor", "modifier", "sectionRepeat", "backgroundId", "backgroundColor", "useBackgroundColor"] as const;
  const out: Record<string, unknown> = {};
  for (const key of keys) if (slide[key] !== undefined) out[key] = slide[key];
  return out as StoredSlide;
};

/**
 * A song, to write or change: its details and its lyrics, with the slides
 * they make shown as they're typed. Saving goes through the same Convex
 * functions the desktop app syncs, and keeps each slide's look
 * (`slidesFromLyrics`).
 */
export function SongEditorPage({ itemId }: { itemId?: string }) {
  const { libraryItems } = useDashboard();
  const item = itemId ? libraryItems?.find((each) => each._id === itemId) : undefined;

  if (itemId && !libraryItems) {
    return (
      <Page wide>
        <Skeleton className="h-4 w-16" />
        <Skeleton className="mt-4 h-9 w-80" />
        <Skeleton className="mt-8 h-[420px] w-full rounded-card" />
      </Page>
    );
  }
  if (itemId && !item) {
    return (
      <Page>
        <EmptyState
          title="This song isn't here"
          action={
            <Link href="/dashboard/library" className="text-sm font-medium text-primary hover:underline">
              Back to the library
            </Link>
          }
        >
          It may have been deleted, or it belongs to another organization.
        </EmptyState>
      </Page>
    );
  }
  // Keyed so switching songs starts the form again from that song.
  return <SongForm key={item?._id ?? "new"} item={item ?? null} />;
}

function SongForm({ item }: { item: DashboardLibraryItem | null }) {
  const router = useRouter();
  const { workspaceId, services } = useDashboard();
  const categories = useCategories();
  const create = useMutation(api.libraries.create);
  const update = useMutation(api.libraries.update);
  const remove = useMutation(api.libraries.remove);
  const fixWithAi = useAction(api.lyrics.fixLyrics);

  const initial = useMemo(
    () => ({
      title: item?.title ?? "",
      artist: (item?.content?.presentation?.artist as string | undefined) ?? "",
      author: (item?.content?.presentation?.author as string | undefined) ?? "",
      categoryId: item?.categoryId ?? "",
      // The slides are what the app shows, so the lyrics are read from them.
      lyrics: item ? lyricsFromSlides(item.slides as StoredSlide[]) : "",
    }),
    [item],
  );
  const [title, setTitle] = useState(initial.title);
  const [artist, setArtist] = useState(initial.artist);
  const [author, setAuthor] = useState(initial.author);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [lyrics, setLyrics] = useState(initial.lyrics);
  const [saving, setSaving] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A new song goes in the first category, as the app does.
  const defaultCategory = categories?.[0]?._id as string | undefined;
  const effectiveCategory = categoryId || (item ? "" : defaultCategory ?? "");

  const dirty =
    title !== initial.title ||
    artist !== initial.artist ||
    author !== initial.author ||
    categoryId !== initial.categoryId ||
    lyrics !== initial.lyrics;

  const previewSlides = useMemo(
    () => slidesFromLyrics(lyrics, (item?.slides ?? []) as StoredSlide[], () => "preview"),
    [item?.slides, lyrics],
  );

  const usedIn = useMemo(
    () => (item ? (services ?? []).filter((service) => service.items.some((entry) => entry.type === "library" && entry.refId === item._id)) : []),
    [item, services],
  );

  const save = useCallback(async () => {
    if (!workspaceId || !title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const slides = slidesFromLyrics(lyrics, (item?.slides ?? []) as StoredSlide[], newSlideId).map(storable);
      // Convex takes no `undefined` inside an object, so empty fields are left out.
      const presentation: Record<string, unknown> = { ...(item?.content?.presentation ?? {}) };
      delete presentation.artist;
      delete presentation.author;
      if (artist.trim()) presentation.artist = artist.trim();
      if (author.trim()) presentation.author = author.trim();
      const content = { ...(item?.content ?? {}), presentation };
      const body = lyricsFromSlides(slides);
      if (item) {
        await update({
          workspaceId,
          libraryId: item._id,
          title: title.trim(),
          body,
          slides,
          content,
          ...(categoryId ? { categoryId } : {}),
        });
        // Show what was saved, as the slides spell it, so nothing reads as
        // unsaved just because blank lines or repeats were tidied.
        setTitle(title.trim());
        setArtist(artist.trim());
        setAuthor(author.trim());
        setLyrics(body);
        setSavedAt(Date.now());
      } else {
        const id = await create({
          workspaceId,
          title: title.trim(),
          body,
          slides,
          content,
          ...(effectiveCategory ? { categoryId: effectiveCategory } : {}),
        });
        router.replace(`/dashboard/library/${id}`);
      }
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setSaving(false);
    }
  }, [artist, author, categoryId, create, effectiveCategory, item, lyrics, router, saving, title, update, workspaceId]);

  // Ctrl/⌘+S saves, and leaving with changes asks first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    const onLeave = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [dirty, save]);

  const runAiFix = async () => {
    if (!lyrics.trim()) return;
    setFixing(true);
    setError(null);
    try {
      const result = await fixWithAi({ lyrics });
      if (result?.cleanedLyrics) setLyrics(result.cleanedLyrics);
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setFixing(false);
    }
  };

  const deleteSong = async () => {
    if (!item || !workspaceId) return;
    setSaving(true);
    try {
      await remove({ workspaceId, libraryId: item._id });
      router.replace("/dashboard/library");
    } catch (failure) {
      setError(friendlyError(failure));
      setSaving(false);
    }
  };

  return (
    <Page wide>
      <Link href="/dashboard/library" className="inline-flex items-center gap-1 text-sm text-[#6b7285] hover:text-[#1d2240]">
        <ChevronLeft className="h-4 w-4" /> Library
      </Link>

      <div className="mt-3 flex flex-col gap-4 border-b border-[#eceef3] pb-6 sm:flex-row sm:items-start sm:justify-between">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Song title"
          aria-label="Title"
          autoFocus={!item}
          className="-mx-1.5 min-w-0 flex-1 rounded-[8px] px-1.5 text-[1.6rem] font-semibold tracking-[-0.03em] outline-none placeholder:text-[#c3c8d3] hover:bg-[#f5f6f9] focus:bg-white focus:ring-[3px] focus:ring-primary/15 sm:text-[1.85rem]"
        />
        <div className="flex flex-none items-center gap-2">
          {saving || dirty || savedAt || item ? (
            <span className="text-sm text-[#9aa1b1]">
              {saving
                ? "Saving…"
                : dirty
                  ? "Unsaved changes"
                  : savedAt
                    ? "Saved"
                    : `Edited ${formatRelative(item!.updatedAt ?? item!._creationTime).toLowerCase()}`}
            </span>
          ) : null}
          {item ? (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          ) : null}
          <Button onClick={() => void save()} busy={saving} disabled={!title.trim() || (!!item && !dirty)}>
            {item ? "Save" : "Create song"}
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Field label="Artist" htmlFor="song-artist">
          <input id="song-artist" value={artist} onChange={(event) => setArtist(event.target.value)} className={fieldClass} placeholder="Who sings it" />
        </Field>
        <Field label="Author" htmlFor="song-author">
          <input id="song-author" value={author} onChange={(event) => setAuthor(event.target.value)} className={fieldClass} placeholder="Who wrote it" />
        </Field>
        <Field label="Category" htmlFor="song-category">
          <Select id="song-category" value={effectiveCategory} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">None</option>
            {(categories ?? []).map((category) => (
              <option key={category._id} value={category._id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {error ? (
        <div className="mt-5">
          <Notice kind="error">{error}</Notice>
        </div>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Lyrics</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setLyrics(cleanLyricsLocally(lyrics))} disabled={!lyrics.trim()}>
                Tidy up
              </Button>
              <Select
                compact
                aria-label="Split into slides"
                value=""
                onChange={(event) => {
                  const lines = Number(event.target.value);
                  if (lines) setLyrics(breakLyricsIntoChunks(lyrics, lines));
                }}
                disabled={!lyrics.trim()}
              >
                <option value="">Split into…</option>
                {[1, 2, 3, 4, 6].map((lines) => (
                  <option key={lines} value={lines}>
                    {lines} {lines === 1 ? "line" : "lines"} per slide
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="outline" onClick={() => void runAiFix()} busy={fixing} disabled={!lyrics.trim()}>
                <Sparkles className="h-3.5 w-3.5" /> Fix with AI
              </Button>
            </div>
          </div>
          <textarea
            value={lyrics}
            onChange={(event) => setLyrics(event.target.value)}
            spellCheck
            aria-label="Lyrics"
            placeholder={"[Verse 1]\nAmazing grace, how sweet the sound\nThat saved a wretch like me\n\n[Chorus]\nMy chains are gone\nI've been set free"}
            className="block min-h-[26rem] w-full resize-y rounded-card border border-[#dfe2ea] bg-white px-4 py-3.5 text-[0.95rem] leading-7 text-[#1d2240] outline-none transition placeholder:text-[#b9bfcb] focus:border-primary/60 focus:ring-[3px] focus:ring-primary/15 lg:min-h-[34rem]"
          />
          <p className="mt-2 text-[0.8rem] leading-5 text-[#9aa1b1]">
            A blank line starts a new slide. A line like [Verse 1], [Chorus] or [Bridge] names the section after it, and
            [Chorus x2] repeats it.
          </p>
        </section>

        <section className="min-w-0">
          <h2 className="mb-3 font-semibold">
            Slides <span className="font-normal text-[#9aa1b1]">{previewSlides.length}</span>
          </h2>
          {previewSlides.length === 0 ? (
            <div className="flex aspect-video items-center justify-center rounded-card border border-dashed border-[#dfe2ea] text-sm text-[#9aa1b1]">
              Slides appear here as you type.
            </div>
          ) : (
            <ol className="grid gap-3 sm:grid-cols-2">
              {previewSlides.map((slide, index) => (
                <SlideTile key={index} slide={slide} number={index + 1} />
              ))}
            </ol>
          )}
        </section>
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${item?.title ?? "this song"}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void deleteSong()} busy={saving}>
              Delete song
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-[#6b7285]">
          It goes from the library in everyone&apos;s app.
          {usedIn.length > 0
            ? ` It's in ${usedIn.length} ${usedIn.length === 1 ? "service" : "services"} (${usedIn
                .slice(0, 3)
                .map((service) => service.name)
                .join(", ")}${usedIn.length > 3 ? "…" : ""}), which will show it as missing.`
            : ""}
        </p>
      </Dialog>
    </Page>
  );
}

type TextStyle = { color?: string; fontFamily?: string; fontWeight?: string; textAlign?: "left" | "center" | "right" | "justify"; capitalization?: string };

/** A slide roughly as the audience sees it: its background, and its words in its own text style. */
function SlideTile({ slide, number }: { slide: StoredSlide; number: number }) {
  const elements = (Array.isArray(slide.elements) ? slide.elements : []) as Array<{ type?: string; style?: TextStyle }>;
  const style = elements.find((element) => element.type === "text")?.style ?? {};
  const background = slide.useBackgroundColor && slide.backgroundColor ? slide.backgroundColor : "#0d0f16";
  const upper = style.capitalization === "uppercase" || style.capitalization === "allCaps";
  return (
    <li className="min-w-0">
      <div className="mb-1.5 flex items-center gap-2 text-[0.78rem]">
        <span className="tabular-nums text-[#9aa1b1]">{number}</span>
        {slide.label ? <span className="font-medium text-[#3c418f]">{slide.label}</span> : null}
        {slide.sectionRepeat ? <span className="text-[#9aa1b1]">{slide.sectionRepeat}</span> : null}
        {slide.modifier ? <span className="text-[#9aa1b1]">[{slide.modifier}]</span> : null}
      </div>
      <div
        className="flex aspect-video items-center justify-center overflow-hidden rounded-[10px] border border-black/5 px-[8%]"
        style={{ background }}
      >
        <p
          className={cx("line-clamp-6 whitespace-pre-line text-[0.78rem] leading-snug sm:text-[0.72rem] xl:text-[0.8rem]", upper && "uppercase")}
          style={{
            color: style.color ?? "#ffffff",
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight ?? 600,
            textAlign: style.textAlign === "left" || style.textAlign === "right" ? style.textAlign : "center",
          }}
        >
          {stripBracketsForDisplay(slide.text)}
        </p>
      </div>
    </li>
  );
}
