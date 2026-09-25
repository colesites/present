"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  Lock,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import type { PresentThemeTier } from "@present/shared";
import { CanvasSlideLayer } from "../../renderer/shared/components/CanvasSlideLayer";
import { FontFamilySelect } from "../../renderer/shared/components/FontFamilySelect";
import { cn } from "../../renderer/shared/lib/utils";
import { desktopWebBaseUrl } from "../../renderer/shared/store/desktopSession";
import {
  selectThemeTarget,
  useThemesModalStore,
} from "../../renderer/shared/store/themesModal";
import type { CanvasSizePreset, LibrarySlide, SlideElement } from "../../shared/types";
import {
  DEFAULT_CANVAS_SIZE,
  getCanvasSizeDimensions,
  normalizeLibrarySlide,
} from "../library/lib/library-items";
import {
  BUILT_IN_THEMES,
  applyLookToSlide,
  lookFromSlide,
  tierIncludes,
  type ThemeLayout,
  type ThemeLook,
  type ThemeShadow,
  type ThemeText,
  type ThemeTier,
} from "./theme-look.mjs";
import { useSavedThemes, type SavedTheme } from "./useSavedThemes";

type Entry = {
  id: string;
  name: string;
  look: ThemeLook;
  /** What it needs: a built-in's tier, or a saved theme's. */
  tier: ThemeTier;
  description?: string;
  saved: boolean;
};

/** How many of a song's slides the panel draws under the preview. */
const MAX_STRIP_SLIDES = 12;

const SAMPLE_SLIDE: LibrarySlide = {
  id: "theme-sample",
  text: "Amazing grace, how sweet the sound\nThat saved a wretch like me",
};

/** Standing in for a video or image where a theme leaves the slide clear. */
const MEDIA_STAND_IN =
  "radial-gradient(120% 90% at 20% 15%, #3b3f6b 0%, transparent 55%), radial-gradient(90% 80% at 85% 90%, #5a3a2e 0%, transparent 60%), #15161f";

const WEIGHTS: Array<[string, string]> = [
  ["300", "Light"],
  ["400", "Regular"],
  ["500", "Medium"],
  ["600", "Semibold"],
  ["700", "Bold"],
  ["800", "Extra bold"],
  ["900", "Black"],
];

const SHADOW_OPTIONS: Array<[ThemeShadow, string]> = [
  ["none", "None"],
  ["soft", "Soft"],
  ["strong", "Strong"],
  ["glow", "Glow"],
];

const SHADOW_LABELS: Record<ThemeShadow, string> = {
  none: "No shadow",
  soft: "Soft shadow",
  strong: "Strong shadow",
  glow: "Glow",
};

const LAYOUT_OPTIONS: Array<[ThemeLayout, string]> = [
  ["full", "Full"],
  ["lower-third", "Lower third"],
  ["upper-third", "Upper third"],
];

const planName = (tier: ThemeTier) => (tier === "advanced" ? "Power" : "Pro");

/** What a saved theme needs: Power for a gradient, Pro for the rest. */
const tierOfSaved = (look: ThemeLook): ThemeTier => (look.text.gradient ? "advanced" : "pro");

const errorText = (error: unknown, fallback: string) =>
  error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : error instanceof Error && error.message
      ? error.message.replace(/^.*ConvexError:\s*/, "").split("\n")[0]
      : fallback;

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const splitColor = (value: string | null | undefined): { hex: string; alpha: number } => {
  const text = (value ?? "").trim();
  const rgba = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (rgba) {
    const hex = `#${[rgba[1], rgba[2], rgba[3]]
      .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0"))
      .join("")}`;
    return { hex, alpha: rgba[4] === undefined ? 1 : Math.min(1, Number(rgba[4])) };
  }
  if (/^#[0-9a-f]{6}$/i.test(text)) return { hex: text.toLowerCase(), alpha: 1 };
  if (/^#[0-9a-f]{8}$/i.test(text)) {
    return { hex: text.slice(0, 7).toLowerCase(), alpha: parseInt(text.slice(7), 16) / 255 };
  }
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return { hex: `#${[...text.slice(1)].map((c) => c + c).join("")}`.toLowerCase(), alpha: 1 };
  }
  return { hex: "#000000", alpha: 1 };
};

const joinColor = (hex: string, alpha: number) => {
  if (alpha >= 0.995) return hex;
  const channel = (start: number) => parseInt(hex.slice(start, start + 2), 16);
  return `rgba(${channel(1)},${channel(3)},${channel(5)},${Math.round(alpha * 100) / 100})`;
};

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

interface ThemesPanelProps {
  /** The organization, or `null` for the personal workspace. */
  workspaceId: string | null;
}

/**
 * The Themes panel: the themes on the left, the one chosen drawn in the
 * middle by the renderer the output uses, and what it is made of on the
 * right. It applies to the song open in Edit, or the one showing in Show.
 */
export function ThemesPanel({ workspaceId }: ThemesPanelProps) {
  const isOpen = useThemesModalStore((state) => state.isOpen);
  const close = useThemesModalStore((state) => state.close);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close, isOpen]);

  if (!isOpen) return null;
  return <ThemesDialog workspaceId={workspaceId} onClose={close} />;
}

function ThemesDialog({ workspaceId, onClose }: ThemesPanelProps & { onClose: () => void }) {
  const target = useThemesModalStore(selectThemeTarget);
  const dispatchApply = useThemesModalStore((state) => state.dispatchApply);
  // Offline, Convex doesn't answer and the copy kept on this computer shows.
  const saved = useSavedThemes({ workspaceId, enabled: true });
  const canCustom = tierIncludes(saved.tier, "pro");

  const [selectedId, setSelectedId] = useState<string>(
    () => target?.themeId ?? BUILT_IN_THEMES[0].id,
  );
  const [scope, setScope] = useState<"song" | "slide">("song");
  // Edits to saved themes, shown at once and saved a moment later.
  const [edits, setEdits] = useState<Record<string, ThemeLook>>({});
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingSaves = useRef(new Map<string, () => Promise<unknown>>());

  const entries = useMemo(() => {
    const builtIns: Entry[] = BUILT_IN_THEMES.map((theme) => ({ ...theme, saved: false }));
    const mine: Entry[] = (saved.themes ?? []).map((theme: SavedTheme) => {
      const look = edits[theme.id] ?? theme.look;
      return { id: theme.id, name: theme.name, look, tier: tierOfSaved(look), saved: true };
    });
    return { builtIns, mine };
  }, [edits, saved.themes]);

  const all = useMemo(() => [...entries.builtIns, ...entries.mine], [entries]);
  const selected = all.find((entry) => entry.id === selectedId) ?? all[0];
  const locked = !tierIncludes(saved.tier, selected.tier);

  // Anything waiting to save goes when the panel closes.
  useEffect(() => {
    const timers = saveTimers.current;
    const waiting = pendingSaves.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      for (const save of waiting.values()) void save().catch((): void => undefined);
    };
  }, []);

  const editLook = useCallback(
    (id: string, look: ThemeLook) => {
      setEdits((current) => ({ ...current, [id]: look }));
      const save = () => saved.update(id, { look });
      pendingSaves.current.set(id, save);
      const previous = saveTimers.current.get(id);
      if (previous) clearTimeout(previous);
      saveTimers.current.set(
        id,
        setTimeout(() => {
          saveTimers.current.delete(id);
          pendingSaves.current.delete(id);
          save().catch((error) => toast.error(errorText(error, "That theme couldn't be saved.")));
        }, 500),
      );
    },
    [saved],
  );

  const canvasSize = target?.canvasSize ?? DEFAULT_CANVAS_SIZE;
  const canvas = useMemo(() => getCanvasSizeDimensions(canvasSize), [canvasSize]);
  const songSlides = useMemo(
    () => (target ? target.slides.map((slide) => normalizeLibrarySlide(slide, canvasSize)) : []),
    [canvasSize, target],
  );
  // The slide in the big preview, which "This slide" means: the one picked
  // below, else the one selected in Edit or live in Show, else the first
  // with words.
  const [pickedSlideId, setPickedSlideId] = useState<string | null>(null);
  const targetSlide =
    songSlides.find((slide) => slide.id === pickedSlideId) ??
    songSlides.find((slide) => slide.id === target?.slideId) ??
    songSlides.find((slide) => slide.text.trim()) ??
    songSlides[0] ??
    null;

  const preview = useMemo(
    () =>
      applyLookToSlide(
        targetSlide && targetSlide.text.trim() ? targetSlide : normalizeLibrarySlide(SAMPLE_SLIDE, canvasSize),
        selected.look,
        canvas,
      ) as LibrarySlide,
    [canvas, canvasSize, selected.look, targetSlide],
  );

  const openPlans = () => {
    void window.electronAPI?.openExternalBrowser?.(`${desktopWebBaseUrl()}/dashboard/billing`);
  };

  const apply = (entry: Entry = selected) => {
    if (!tierIncludes(saved.tier, entry.tier)) {
      openPlans();
      return;
    }
    if (!target) return;
    const onlySlideId = scope === "slide" ? targetSlide?.id ?? null : null;
    dispatchApply({
      surface: target.surface,
      libraryId: target.libraryId,
      theme: { id: entry.id, name: entry.name, look: entry.look },
      onlySlideId,
    });
  };

  const [isCreating, setIsCreating] = useState(false);
  const createFrom = async (name: string, look: ThemeLook) => {
    setIsCreating(true);
    try {
      // Pro can save everything but a gradient; the words keep their colour.
      const allowed =
        look.text.gradient && !tierIncludes(saved.tier, "advanced")
          ? { ...look, text: { ...look.text, gradient: null } }
          : look;
      const id = await saved.create(name, allowed);
      setSelectedId(String(id));
    } catch (error) {
      toast.error(errorText(error, "That theme couldn't be saved."));
    } finally {
      setIsCreating(false);
    }
  };

  const remove = async (entry: Entry) => {
    const timer = saveTimers.current.get(entry.id);
    if (timer) clearTimeout(timer);
    saveTimers.current.delete(entry.id);
    pendingSaves.current.delete(entry.id);
    try {
      await saved.remove(entry.id);
      setSelectedId(BUILT_IN_THEMES[0].id);
    } catch (error) {
      toast.error(errorText(error, "That theme couldn't be deleted."));
    }
  };

  const savingBlocked = !saved.signedIn
    ? "Sign in to save your own themes."
    : !saved.canSave
      ? "You're offline. Your themes can be changed once you're back online."
      : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Themes"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[min(640px,90vh)] w-[min(1060px,96vw)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex h-11 flex-none items-center gap-3 border-b border-border/70 px-4">
          <p className="text-[13px] font-semibold text-foreground">Themes</p>
          <p className="min-w-0 truncate text-[12px] text-muted-foreground">
            {target ? `For ${target.title}` : "Open a song in Show or Edit to apply a theme"}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md p-1.5 text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)_280px]">
          {/* The themes */}
          <nav className="min-h-0 overflow-y-auto border-r border-border/70 py-2" aria-label="Themes">
            <ListSection title="Built in">
              {entries.builtIns
                .filter((entry) => entry.tier === "basic")
                .map((entry) => (
                  <ThemeRow
                    key={entry.id}
                    entry={entry}
                    isSelected={entry.id === selected.id}
                    isOnSong={entry.id === target?.themeId}
                    isLocked={false}
                    onSelect={() => setSelectedId(entry.id)}
                    onApply={() => apply(entry)}
                  />
                ))}
            </ListSection>
            {(["pro", "advanced"] as const).map((tier) => (
              <ListSection
                key={tier}
                title={planName(tier)}
                badge={tierIncludes(saved.tier, tier) ? null : planName(tier)}
              >
                {entries.builtIns
                  .filter((entry) => entry.tier === tier)
                  .map((entry) => (
                    <ThemeRow
                      key={entry.id}
                      entry={entry}
                      isSelected={entry.id === selected.id}
                      isOnSong={entry.id === target?.themeId}
                      isLocked={!tierIncludes(saved.tier, tier)}
                      onSelect={() => setSelectedId(entry.id)}
                      onApply={() => apply(entry)}
                    />
                  ))}
              </ListSection>
            ))}
            <ListSection
              title="Your themes"
              action={
                canCustom && !savingBlocked ? (
                  <button
                    type="button"
                    disabled={isCreating}
                    onClick={() => void createFrom(`${selected.name} copy`, selected.look)}
                    className="rounded p-0.5 text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground disabled:opacity-40"
                    aria-label="New theme from the one selected"
                    title="New theme from the one selected"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                ) : null
              }
            >
              {saved.themes === null ? (
                <p className="px-4 py-1.5 text-[11px] text-muted-foreground">
                  {saved.signedIn ? "Loading…" : "Sign in to keep your own themes."}
                </p>
              ) : entries.mine.length === 0 ? (
                <p className="px-4 py-1.5 text-[11px] leading-4 text-muted-foreground">
                  {canCustom
                    ? workspaceId
                      ? "Themes you save are shared with everyone in this workspace."
                      : "Themes you save are kept with your account."
                    : "Saving your own themes comes with Pro and Power."}
                </p>
              ) : (
                entries.mine.map((entry) => (
                  <ThemeRow
                    key={entry.id}
                    entry={entry}
                    isSelected={entry.id === selected.id}
                    isOnSong={entry.id === target?.themeId}
                    isLocked={!tierIncludes(saved.tier, entry.tier)}
                    onSelect={() => setSelectedId(entry.id)}
                    onApply={() => apply(entry)}
                  />
                ))
              )}
            </ListSection>
          </nav>

          {/* The preview */}
          <section className="flex min-h-0 min-w-0 flex-col gap-3 p-5">
            <SlidePicture slide={preview} look={selected.look} canvasSize={canvasSize} className="rounded-lg" />
            <p className="text-[11px] text-muted-foreground">
              {selected.look.background
                ? targetSlide?.text.trim()
                  ? "A slide from this song, as the audience will see it."
                  : "Sample words, as the audience will see them."
                : "This theme leaves the background clear, so your video, image or camera shows behind the words."}
            </p>

            {songSlides.length > 1 ? (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  In this song
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {songSlides.slice(0, MAX_STRIP_SLIDES).map((slide) => (
                    <button
                      key={slide.id}
                      type="button"
                      onClick={() => setPickedSlideId(slide.id ?? null)}
                      className={cn(
                        "overflow-hidden rounded-md ring-offset-2 ring-offset-card transition",
                        slide.id === targetSlide?.id ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100",
                      )}
                      aria-label={slide.label || slide.text.split("\n")[0] || "Slide"}
                    >
                      <SlidePicture
                        slide={applyLookToSlide(slide, selected.look, canvas) as LibrarySlide}
                        look={selected.look}
                        canvasSize={canvasSize}
                      />
                    </button>
                  ))}
                </div>
                {songSlides.length > MAX_STRIP_SLIDES ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    And {songSlides.length - MAX_STRIP_SLIDES} more
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex-1" />
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
              <Segmented
                label="Apply to"
                value={scope}
                disabled={!target}
                options={[
                  ["song", "Whole song"],
                  ["slide", "This slide", !targetSlide],
                ]}
                onChange={(value) => setScope(value as "song" | "slide")}
              />
              <button
                type="button"
                disabled={!target && !locked}
                onClick={() => apply()}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {locked ? (
                  <>
                    <Lock className="h-3.5 w-3.5" /> Get {planName(selected.tier)}
                  </>
                ) : (
                  "Apply"
                )}
              </button>
            </div>
          </section>

          {/* What it is made of */}
          <aside className="min-h-0 overflow-y-auto border-l border-border/70">
            {selected.saved && !locked ? (
              <ThemeEditor
                key={selected.id}
                entry={selected}
                tier={saved.tier}
                blocked={savingBlocked}
                onChange={(look) => editLook(selected.id, look)}
                onRename={(name) =>
                  void saved
                    .update(selected.id, { name })
                    .catch((error) => toast.error(errorText(error, "That name couldn't be saved.")))
                }
                onDelete={() => void remove(selected)}
              />
            ) : (
              <ThemeSummary
                entry={selected}
                locked={locked}
                footer={
                  locked ? (
                    <UpgradeNote tier={selected.tier} onOpen={openPlans} />
                  ) : !canCustom ? (
                    <UpgradeNote tier="pro" onOpen={openPlans} saving />
                  ) : savingBlocked ? (
                    <p className="text-[11px] leading-4 text-muted-foreground">{savingBlocked}</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        disabled={isCreating}
                        onClick={() => void createFrom(`${selected.name} copy`, selected.look)}
                        className="h-8 rounded-md border border-border bg-background/40 text-[12px] font-medium text-foreground transition hover:border-primary/50 disabled:opacity-50"
                      >
                        Make a copy to change
                      </button>
                      {targetSlide?.text.trim() ? (
                        <button
                          type="button"
                          disabled={isCreating}
                          onClick={() =>
                            void createFrom(
                              `${target?.title ?? "Slide"} look`,
                              lookFromSlide(targetSlide, canvas) as ThemeLook,
                            )
                          }
                          className="h-8 rounded-md border border-border bg-background/40 text-[12px] font-medium text-foreground transition hover:border-primary/50 disabled:opacity-50"
                        >
                          Save this slide&apos;s look
                        </button>
                      ) : null}
                    </div>
                  )
                }
              />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

/** A slide drawn by the renderer the output uses, over its background. */
function SlidePicture({
  slide,
  look,
  canvasSize,
  className,
}: {
  slide: LibrarySlide;
  look: ThemeLook;
  canvasSize: CanvasSizePreset;
  className?: string;
}) {
  const { width, height } = getCanvasSizeDimensions(canvasSize);
  return (
    <div
      className={cn("relative w-full overflow-hidden border border-border/60", className)}
      style={{
        aspectRatio: `${width} / ${height}`,
        background: slide.useBackgroundColor && slide.backgroundColor ? slide.backgroundColor : MEDIA_STAND_IN,
      }}
    >
      <CanvasSlideLayer
        text={slide.text}
        elements={(slide.elements ?? []) as SlideElement[]}
        canvasSize={canvasSize}
        className="absolute inset-0"
        libraryStyle={{
          fontFamily: look.text.fontFamily,
          fontSize: look.text.fontSize,
          fontBold: false,
          fontItalic: false,
          fontUnderline: false,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function ListSection({
  title,
  badge,
  action,
  children,
}: {
  title: string;
  badge?: string | null;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="pb-2">
      <div className="flex h-7 items-center gap-2 px-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</span>
        {badge ? (
          <span className="rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold text-primary">{badge}</span>
        ) : null}
        <span className="ml-auto">{action}</span>
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function ThemeRow({
  entry,
  isSelected,
  isOnSong,
  isLocked,
  onSelect,
  onApply,
}: {
  entry: Entry;
  isSelected: boolean;
  isOnSong: boolean;
  isLocked: boolean;
  onSelect: () => void;
  onApply: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onApply}
        aria-current={isSelected ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition",
          isSelected ? "bg-primary/15 text-foreground" : "text-foreground/85 hover:bg-foreground/5",
        )}
      >
        <Swatch look={entry.look} />
        <span className={cn("min-w-0 flex-1 truncate", isLocked && "text-muted-foreground")}>{entry.name}</span>
        {isOnSong ? <Check className="h-3.5 w-3.5 flex-none text-primary" aria-label="On this song" /> : null}
        {isLocked ? <Lock className="h-3 w-3 flex-none text-muted-foreground" aria-label="Locked" /> : null}
      </button>
    </li>
  );
}

/** A theme in miniature: its background, a band if it has one, and "Aa". */
function Swatch({ look }: { look: ThemeLook }) {
  const { text } = look;
  const band = look.band && look.layout !== "full";
  return (
    <span
      className="relative flex h-[22px] w-[38px] flex-none items-center justify-center overflow-hidden rounded-[4px] border border-white/10"
      style={{ background: look.background ?? MEDIA_STAND_IN }}
      aria-hidden
    >
      {band ? (
        <span
          className={cn("absolute inset-x-0 h-[9px]", look.layout === "upper-third" ? "top-0" : "bottom-0")}
          style={{ background: look.band?.color }}
        />
      ) : null}
      <span
        className={cn(
          "relative text-[10px] leading-none",
          look.layout === "lower-third" && "mt-auto mb-[1px]",
          look.layout === "upper-third" && "mb-auto mt-[1px]",
        )}
        style={{
          fontFamily: text.fontFamily,
          fontWeight: Number(text.fontWeight),
          fontStyle: text.italic ? "italic" : "normal",
          textTransform: text.uppercase ? "uppercase" : "none",
          color: text.gradient ? "transparent" : text.color,
          backgroundImage: text.gradient
            ? `linear-gradient(${text.gradient.angle}deg, ${text.gradient.from}, ${text.gradient.to})`
            : undefined,
          WebkitBackgroundClip: text.gradient ? "text" : undefined,
          backgroundClip: text.gradient ? "text" : undefined,
          WebkitTextStroke: text.outline ? `0.6px ${text.outline.color}` : undefined,
          textShadow: text.shadow === "glow" ? "0 0 4px rgba(140,120,255,0.9)" : undefined,
        }}
      >
        Aa
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// What a theme is made of
// ---------------------------------------------------------------------------

const weightLabel = (weight: string) => WEIGHTS.find(([value]) => value === weight)?.[1] ?? weight;

function describeFont(text: ThemeText) {
  return [
    `${text.fontFamily}, ${text.fontSize}`,
    weightLabel(text.fontWeight).toLowerCase(),
    text.italic ? "italic" : null,
    text.uppercase ? "capitals" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function ThemeSummary({ entry, locked, footer }: { entry: Entry; locked: boolean; footer: ReactNode }) {
  const { look } = entry;
  const { text } = look;
  const rows: Array<[string, string]> = [
    ["Font", describeFont(text)],
    ["Colour", text.gradient ? `Gradient, ${text.gradient.from} to ${text.gradient.to}` : text.color],
    [
      "Shadow and outline",
      SHADOW_LABELS[text.shadow] + (text.outline ? `, ${Math.round(text.outline.width)} px outline` : ""),
    ],
    [
      "Position",
      `${LAYOUT_OPTIONS.find(([value]) => value === look.layout)?.[1] ?? "Full"}, ${text.align === "center" ? "centred" : `${text.align} aligned`}`,
    ],
    ["Background", look.background ? look.background : "Clear, so your media shows"],
  ];
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          {entry.name}
          {locked ? <Lock className="h-3 w-3 text-muted-foreground" /> : null}
        </p>
        {entry.description ? (
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{entry.description}</p>
        ) : null}
      </div>
      <dl className="flex flex-col gap-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-[12px] text-foreground/90">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-border/60 pt-4">{footer}</div>
    </div>
  );
}

function UpgradeNote({ tier, onOpen, saving }: { tier: ThemeTier; onOpen: () => void; saving?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] leading-4 text-muted-foreground">
        {saving
          ? "Saving and changing your own themes comes with Pro and Power."
          : tier === "advanced"
            ? "Gradient themes come with Power."
            : "This theme comes with Pro and Power."}
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="h-8 rounded-md border border-border bg-background/40 text-[12px] font-medium text-foreground transition hover:border-primary/50"
      >
        See plans
      </button>
    </div>
  );
}

function ThemeEditor({
  entry,
  tier,
  blocked,
  onChange,
  onRename,
  onDelete,
}: {
  entry: Entry;
  tier: PresentThemeTier;
  blocked: string | null;
  onChange: (look: ThemeLook) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { look } = entry;
  const { text } = look;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const disabled = Boolean(blocked);
  const canGradient = tierIncludes(tier, "advanced");

  const setText = (patch: Partial<ThemeText>) => onChange({ ...look, text: { ...text, ...patch } });
  const band = splitColor(look.band?.color ?? "rgba(0,0,0,0.6)");

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-5 p-4 disabled:opacity-60">
      <div className="flex items-center gap-2">
        <input
          type="text"
          defaultValue={entry.name}
          maxLength={60}
          aria-label="Theme name"
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== entry.name) onRename(name);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background/40 px-2 text-[12px] font-medium text-foreground outline-none focus:border-primary/60"
        />
        {confirmDelete ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={onDelete}
              className="h-8 rounded-md bg-red-500/15 px-2 text-[11px] font-semibold text-red-400 hover:bg-red-500/25"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="h-8 rounded-md px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded-md p-2 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
            aria-label="Delete theme"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {blocked ? <p className="-mt-2 text-[11px] leading-4 text-muted-foreground">{blocked}</p> : null}

      <Group title="Words">
        <FontFamilySelect value={text.fontFamily} onChange={(fontFamily) => setText({ fontFamily })} />
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
          <NumberField
            label="Size"
            value={text.fontSize}
            min={12}
            max={240}
            onChange={(fontSize) => setText({ fontSize })}
          />
          <select
            value={text.fontWeight}
            onChange={(event) => setText({ fontWeight: event.target.value })}
            aria-label="Weight"
            className="h-8 rounded-md border border-border bg-background/40 px-2 text-[12px] text-foreground outline-none focus:border-primary/60"
          >
            {WEIGHTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <Toggle label="Italic" checked={text.italic} onChange={(italic) => setText({ italic })} />
          <Toggle label="Capitals" checked={text.uppercase} onChange={(uppercase) => setText({ uppercase })} />
        </div>
      </Group>

      <Group title="Colour">
        <div className="flex items-center gap-2">
          <ColorSwatch
            label="Words"
            value={text.gradient ? text.gradient.from : text.color}
            onChange={(color) =>
              text.gradient ? setText({ gradient: { ...text.gradient, from: color } }) : setText({ color })
            }
          />
          {text.gradient ? (
            <ColorSwatch
              label="Gradient end"
              value={text.gradient.to}
              onChange={(to) => text.gradient && setText({ gradient: { ...text.gradient, to } })}
            />
          ) : null}
          <Toggle
            label="Gradient"
            checked={Boolean(text.gradient)}
            disabled={!canGradient && !text.gradient}
            title={canGradient ? undefined : "Gradient themes come with Power"}
            onChange={(on) =>
              setText({ gradient: on ? { from: text.color, to: "#9ca3af", angle: 135 } : null, color: text.gradient?.from ?? text.color })
            }
          />
        </div>
        {!canGradient && !text.gradient ? (
          <p className="text-[10px] text-muted-foreground">Gradients come with Power.</p>
        ) : null}
      </Group>

      <Group title="Shadow and outline">
        <Segmented
          value={text.shadow}
          options={SHADOW_OPTIONS}
          onChange={(shadow) => setText({ shadow: shadow as ThemeShadow })}
        />
        <div className="flex items-center gap-2">
          <Toggle
            label="Outline"
            checked={Boolean(text.outline)}
            onChange={(on) => setText({ outline: on ? { color: "#000000", width: 4 } : null })}
          />
          {text.outline ? (
            <>
              <ColorSwatch
                label="Outline colour"
                value={text.outline.color}
                onChange={(color) => text.outline && setText({ outline: { ...text.outline, color } })}
              />
              <input
                type="range"
                min={1}
                max={24}
                step={1}
                value={Math.round(text.outline.width)}
                aria-label="Outline width"
                onChange={(event) =>
                  text.outline && setText({ outline: { ...text.outline, width: Number(event.target.value) } })
                }
                className="min-w-0 flex-1 accent-primary"
              />
            </>
          ) : null}
        </div>
      </Group>

      <Group title="Position">
        <Segmented
          value={look.layout}
          options={LAYOUT_OPTIONS}
          onChange={(layout) =>
            onChange({
              ...look,
              layout: layout as ThemeLayout,
              band: layout === "full" ? null : look.band ?? { color: "rgba(0,0,0,0.6)" },
            })
          }
        />
        <div className="flex items-center gap-2">
          <Segmented
            value={text.align}
            label="Alignment"
            options={[
              ["left", <AlignLeft key="l" className="h-3.5 w-3.5" aria-label="Left" />],
              ["center", <AlignCenter key="c" className="h-3.5 w-3.5" aria-label="Centre" />],
              ["right", <AlignRight key="r" className="h-3.5 w-3.5" aria-label="Right" />],
            ]}
            onChange={(align) => setText({ align: align as ThemeText["align"] })}
          />
          <Segmented
            value={text.verticalAlign}
            label="Vertical position"
            options={[
              ["top", "Top"],
              ["middle", "Middle"],
              ["bottom", "Bottom"],
            ]}
            onChange={(verticalAlign) => setText({ verticalAlign: verticalAlign as ThemeText["verticalAlign"] })}
          />
        </div>
        {look.layout !== "full" ? (
          <div className="flex items-center gap-2">
            <Toggle
              label="Band"
              checked={Boolean(look.band)}
              onChange={(on) => onChange({ ...look, band: on ? { color: "rgba(0,0,0,0.6)" } : null })}
            />
            {look.band ? (
              <>
                <ColorSwatch
                  label="Band colour"
                  value={band.hex}
                  onChange={(hex) => onChange({ ...look, band: { color: joinColor(hex, band.alpha) } })}
                />
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={band.alpha}
                  aria-label="Band opacity"
                  onChange={(event) =>
                    onChange({ ...look, band: { color: joinColor(band.hex, Number(event.target.value)) } })
                  }
                  className="min-w-0 flex-1 accent-primary"
                />
              </>
            ) : null}
          </div>
        ) : null}
      </Group>

      <Group title="Background">
        <div className="flex items-center gap-2">
          <Segmented
            value={look.background ? "colour" : "clear"}
            options={[
              ["clear", "Clear"],
              ["colour", "Colour"],
            ]}
            onChange={(value) => onChange({ ...look, background: value === "clear" ? null : "#000000" })}
          />
          {look.background ? (
            <ColorSwatch
              label="Background colour"
              value={splitColor(look.background).hex}
              onChange={(background) => onChange({ ...look, background })}
            />
          ) : null}
        </div>
        <p className="text-[10px] leading-4 text-muted-foreground">
          {look.background
            ? "The colour covers any video or image behind the slide."
            : "Your video, image or camera shows behind the words."}
        </p>
      </Group>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Segmented({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: string;
  options: Array<[string, ReactNode] | [string, ReactNode, boolean]>;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("flex rounded-md border border-border bg-background/40 p-0.5", disabled && "opacity-40")}
    >
      {options.map(([option, content, optionDisabled]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          disabled={disabled || optionDisabled}
          onClick={() => onChange(option)}
          className={cn(
            "flex h-7 flex-1 items-center justify-center whitespace-nowrap rounded-[5px] px-2 text-[11px] font-medium transition disabled:cursor-not-allowed",
            value === option ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground",
            optionDisabled && "opacity-40",
          )}
        >
          {content}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className={cn(
        "h-8 rounded-md border px-2.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
        checked
          ? "border-primary/60 bg-primary/15 text-foreground"
          : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function ColorSwatch({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { hex } = splitColor(value);
  return (
    <label
      className="relative h-8 w-10 flex-none cursor-pointer overflow-hidden rounded-md border border-border"
      title={label}
    >
      <span className="absolute inset-1 rounded-[4px]" style={{ background: hex }} />
      <input
        type="color"
        value={hex}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  // Typed freely and taken on Enter or leaving the field, so "120" can be
  // typed through "1" and "12" without either being refused.
  const commit = (input: HTMLInputElement) => {
    const next = Number(input.value);
    if (!Number.isFinite(next) || input.value.trim() === "") {
      input.value = String(value);
      return;
    }
    const clamped = Math.round(Math.min(max, Math.max(min, next)));
    input.value = String(clamped);
    if (clamped !== value) onChange(clamped);
  };
  return (
    <input
      key={value}
      type="number"
      aria-label={label}
      title={label}
      defaultValue={value}
      min={min}
      max={max}
      onBlur={(event) => commit(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit(event.currentTarget);
      }}
      className="h-8 rounded-md border border-border bg-background/40 px-2 text-[12px] text-foreground outline-none focus:border-primary/60"
    />
  );
}
