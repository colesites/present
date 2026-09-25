"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, Lock, Plus, Redo2, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { CanvasSlideLayer } from "../../renderer/shared/components/CanvasSlideLayer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../renderer/shared/components/ui/dropdown-menu";
import { Segmented, fillSwatchCss } from "../../renderer/shared/components/style-controls";
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
import { DesignCanvas, MEDIA_STAND_IN, type DesignTarget } from "./DesignCanvas";
import { nudgeFrame } from "./design-frames.mjs";
import { ThemeInspector } from "./ThemeInspector";
import {
  BUILT_IN_THEMES,
  applyLookToSlide,
  lookFromSlide,
  normalizeLook,
  tierIncludes,
  tierOfLook,
  type ThemeFrame,
  type ThemeLook,
  type ThemeTier,
} from "./theme-look.mjs";
import { useSavedThemes, type SavedTheme } from "./useSavedThemes";

type Entry = {
  id: string;
  name: string;
  look: ThemeLook;
  /** What using it needs. */
  tier: ThemeTier;
  description?: string;
  saved: boolean;
  /** A built-in theme changed here and not saved as a theme of its own. */
  edited: boolean;
};

/** How many of a song's slides the panel draws under the canvas. */
const MAX_STRIP_SLIDES = 12;
/** Changes closer together than this are one step to undo. */
const UNDO_BURST_MS = 600;
/** How long after the last change a saved theme is written. */
const SAVE_AFTER_MS = 600;

const SAMPLE_SLIDE: LibrarySlide = {
  id: "theme-sample",
  text: "Amazing grace, how sweet the sound\nThat saved a wretch like me",
};

const planName = (tier: ThemeTier) => (tier === "advanced" ? "Power" : "Pro");

const errorText = (error: unknown, fallback: string) =>
  error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : error instanceof Error && error.message
      ? error.message.replace(/^.*ConvexError:\s*/, "").split("\n")[0]
      : fallback;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

interface ThemesPanelProps {
  /** The organization, or `null` for the personal workspace. */
  workspaceId: string | null;
}

/**
 * The Themes panel: the themes on the left, the chosen one on the song's
 * slide in the middle, to drag and resize, and everything it is made of on
 * the right. It applies to the song open in Edit, or the one in Show.
 */
export function ThemesPanel({ workspaceId }: ThemesPanelProps) {
  const isOpen = useThemesModalStore((state) => state.isOpen);
  const close = useThemesModalStore((state) => state.close);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) close();
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
  const drafts = useThemesModalStore((state) => state.drafts);
  const setDraft = useThemesModalStore((state) => state.setDraft);
  // Offline, Convex doesn't answer and the copy kept on this computer shows.
  const saved = useSavedThemes({ workspaceId, enabled: true });
  const canCustomize = tierIncludes(saved.tier, "pro");
  const canGradient = tierIncludes(saved.tier, "advanced");

  const [selectedId, setSelectedId] = useState<string>(() => target?.themeId ?? BUILT_IN_THEMES[0].id);
  const [scope, setScope] = useState<"song" | "slide">("song");
  const [designTarget, setDesignTarget] = useState<DesignTarget | null>("words");
  // Changes to saved themes, shown at once and written a moment later.
  const [edits, setEdits] = useState<Record<string, ThemeLook>>({});
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingSaves = useRef(new Map<string, () => Promise<unknown>>());
  const [saving, setSaving] = useState(0);
  const history = useRef(new Map<string, { past: ThemeLook[]; future: ThemeLook[]; lastAt: number }>());
  const [historyTick, setHistoryTick] = useState(0);

  const entries = useMemo(() => {
    const builtIns: Entry[] = BUILT_IN_THEMES.map((theme) => {
      const draft = drafts[theme.id] ? normalizeLook(drafts[theme.id]) : null;
      return {
        ...theme,
        look: draft ?? theme.look,
        tier: draft ? (theme.tier === "advanced" ? "advanced" : tierOfLook(draft)) : theme.tier,
        saved: false,
        edited: Boolean(draft),
      };
    });
    const mine: Entry[] = (saved.themes ?? []).map((theme: SavedTheme) => {
      const look = edits[theme.id] ?? theme.look;
      return { id: theme.id, name: theme.name, look, tier: tierOfLook(look), saved: true, edited: false };
    });
    return { builtIns, mine };
  }, [drafts, edits, saved.themes]);

  const all = useMemo(() => [...entries.builtIns, ...entries.mine], [entries]);
  const selected = all.find((entry) => entry.id === selectedId) ?? all[0];
  const locked = !tierIncludes(saved.tier, selected.tier);
  const editable = canCustomize && (!selected.saved || saved.canSave);

  // Anything waiting to be written goes when the panel closes.
  useEffect(() => {
    const timers = saveTimers.current;
    const waiting = pendingSaves.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      for (const save of waiting.values()) void save().catch((): void => undefined);
    };
  }, []);

  /** Put a look on an entry: a saved theme is written soon, a built-in kept as a draft. */
  const writeLook = useCallback(
    (entry: Entry, look: ThemeLook) => {
      if (!entry.saved) {
        setDraft(entry.id, look);
        return;
      }
      setEdits((current) => ({ ...current, [entry.id]: look }));
      const save = () => saved.update(entry.id, { look });
      pendingSaves.current.set(entry.id, save);
      const previous = saveTimers.current.get(entry.id);
      if (previous) clearTimeout(previous);
      else setSaving((count) => count + 1);
      saveTimers.current.set(
        entry.id,
        setTimeout(() => {
          saveTimers.current.delete(entry.id);
          pendingSaves.current.delete(entry.id);
          setSaving((count) => Math.max(0, count - 1));
          save().catch((error) => toast.error(errorText(error, "That theme couldn't be saved.")));
        }, SAVE_AFTER_MS),
      );
    },
    [saved, setDraft],
  );

  /** A change from the inspector or the canvas, as one step to undo. */
  const change = useCallback(
    (look: ThemeLook, options: { endsStep?: boolean } = {}) => {
      if (!editable) return;
      const steps = history.current.get(selected.id) ?? { past: [], future: [], lastAt: 0 };
      const now = Date.now();
      if (now - steps.lastAt > UNDO_BURST_MS) steps.past = [...steps.past.slice(-49), selected.look];
      steps.future = [];
      steps.lastAt = options.endsStep ? 0 : now;
      history.current.set(selected.id, steps);
      setHistoryTick((tick) => tick + 1);
      writeLook(selected, look);
    },
    [editable, selected, writeLook],
  );

  const steps = useMemo(
    () => {
      const entry = history.current.get(selected.id);
      return { canUndo: Boolean(entry?.past.length), canRedo: Boolean(entry?.future.length) };
    },
    // Read again whenever the history changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historyTick, selected.id],
  );
  const undo = useCallback(() => {
    const entry = history.current.get(selected.id);
    const previous = entry?.past.at(-1);
    if (!entry || !previous) return;
    entry.past = entry.past.slice(0, -1);
    entry.future = [selected.look, ...entry.future];
    entry.lastAt = 0;
    setHistoryTick((tick) => tick + 1);
    writeLook(selected, previous);
  }, [selected, writeLook]);
  const redo = useCallback(() => {
    const entry = history.current.get(selected.id);
    const next = entry?.future[0];
    if (!entry || !next) return;
    entry.future = entry.future.slice(1);
    entry.past = [...entry.past, selected.look];
    entry.lastAt = 0;
    setHistoryTick((tick) => tick + 1);
    writeLook(selected, next);
  }, [selected, writeLook]);

  const onFrameChange = useCallback(
    (which: DesignTarget, frame: ThemeFrame, done: boolean) => {
      const look = selected.look;
      const next =
        which === "words" ? { ...look, frame } : look.box ? { ...look, box: { ...look.box, frame } } : look;
      change(next, { endsStep: done });
    },
    [change, selected.look],
  );

  // Undo, redo and nudging with the keyboard, outside text fields.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (!designTarget || !editable) return;
      const frame = designTarget === "words" ? selected.look.frame : selected.look.box?.frame;
      const nudged = frame ? nudgeFrame(frame, event.key, event.shiftKey) : null;
      if (nudged) {
        event.preventDefault();
        onFrameChange(designTarget, nudged, false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [designTarget, editable, onFrameChange, redo, selected.look, undo]);

  // The song, and the slide the canvas shows.
  const canvasSize: CanvasSizePreset = target?.canvasSize ?? DEFAULT_CANVAS_SIZE;
  const canvas = useMemo(() => getCanvasSizeDimensions(canvasSize), [canvasSize]);
  const songSlides = useMemo(
    () =>
      target
        ? target.slides.map((slide, index) =>
            normalizeLibrarySlide({ ...slide, id: slide.id ?? `slide-${index}` }, canvasSize),
          )
        : [],
    [canvasSize, target],
  );
  const [pickedIndex, setPickedIndex] = useState<number | null>(null);
  const firstWithWords = songSlides.findIndex((slide) => slide.text.trim());
  const slideIndex =
    pickedIndex !== null && pickedIndex < songSlides.length
      ? pickedIndex
      : target?.slideIndex !== null && target?.slideIndex !== undefined && target.slideIndex < songSlides.length
        ? target.slideIndex
        : firstWithWords >= 0
          ? firstWithWords
          : songSlides.length > 0
            ? 0
            : null;
  const shownSlide = slideIndex !== null ? songSlides[slideIndex] : null;
  const slideForCanvas = useMemo(
    () => (shownSlide && shownSlide.text.trim() ? shownSlide : normalizeLibrarySlide(SAMPLE_SLIDE, canvasSize)),
    [canvasSize, shownSlide],
  );
  const designed = useMemo(
    () => applyLookToSlide(slideForCanvas, selected.look, canvas) as LibrarySlide,
    [canvas, selected.look, slideForCanvas],
  );
  const stripLook = useDeferredValue(selected.look);

  const openPlans = () => {
    void window.electronAPI?.openExternalBrowser?.(`${desktopWebBaseUrl()}/dashboard/billing`);
  };

  const apply = (entry: Entry = selected) => {
    if (!tierIncludes(saved.tier, entry.tier)) {
      openPlans();
      return;
    }
    if (!target) return;
    dispatchApply({
      surface: target.surface,
      libraryId: target.libraryId,
      theme: { id: entry.id, name: entry.edited ? `${entry.name} (edited)` : entry.name, look: entry.look },
      onlySlideIndex: scope === "slide" ? slideIndex : null,
    });
  };

  const [isCreating, setIsCreating] = useState(false);
  const createFrom = async (name: string, look: ThemeLook, clearDraftOf?: string) => {
    if (!saved.canSave) {
      toast.error(saved.signedIn ? "You're offline. Themes can be saved once you're back online." : "Sign in to save your own themes.");
      return;
    }
    setIsCreating(true);
    try {
      // Pro saves everything but gradients; they become their first colour.
      const allowed = canGradient ? look : withoutGradients(look);
      const id = await saved.create(name, allowed);
      if (clearDraftOf) setDraft(clearDraftOf, null);
      setSelectedId(String(id));
      toast.success(`Saved ${name}`);
    } catch (error) {
      toast.error(errorText(error, "That theme couldn't be saved."));
    } finally {
      setIsCreating(false);
    }
  };

  const remove = async (entry: Entry) => {
    const timer = saveTimers.current.get(entry.id);
    if (timer) {
      clearTimeout(timer);
      setSaving((count) => Math.max(0, count - 1));
    }
    saveTimers.current.delete(entry.id);
    pendingSaves.current.delete(entry.id);
    try {
      await saved.remove(entry.id);
      setSelectedId(BUILT_IN_THEMES[0].id);
    } catch (error) {
      toast.error(errorText(error, "That theme couldn't be deleted."));
    }
  };

  const status = !canCustomize
    ? null
    : selected.saved
      ? !saved.canSave
        ? "Offline: changes wait until you're back online"
        : saving > 0
          ? "Saving…"
          : "Saved"
      : selected.edited
        ? "Edited, not saved as a theme yet"
        : "Built in. Change anything to make it yours.";

  const tierOfBuiltIn = (id: string) => BUILT_IN_THEMES.find((theme) => theme.id === id)?.tier;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Themes"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[min(860px,95vh)] w-[min(1380px,98vw)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
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

        <div className="grid min-h-0 flex-1 grid-cols-[212px_minmax(0,1fr)_316px]">
          {/* The themes */}
          <nav className="min-h-0 overflow-y-auto border-r border-border/70 py-2" aria-label="Themes">
            {(["basic", "pro", "advanced"] as const).map((tier) => (
              <ListSection
                key={tier}
                title={tier === "basic" ? "Built in" : planName(tier)}
                badge={tier === "basic" || tierIncludes(saved.tier, tier) ? null : planName(tier)}
              >
                {entries.builtIns
                  .filter((entry) => tierOfBuiltIn(entry.id) === tier)
                  .map((entry) => (
                    <ThemeRow
                      key={entry.id}
                      entry={entry}
                      isSelected={entry.id === selected.id}
                      isOnSong={entry.id === target?.themeId}
                      isLocked={!tierIncludes(saved.tier, entry.tier)}
                      onSelect={() => setSelectedId(entry.id)}
                      onApply={() => apply(entry)}
                    />
                  ))}
              </ListSection>
            ))}
            <ListSection
              title="Your themes"
              action={
                canCustomize ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={isCreating}
                      className="rounded p-0.5 text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground disabled:opacity-40"
                      aria-label="New theme"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="z-[200] w-56">
                      <DropdownMenuItem onSelect={() => void createFrom(`${selected.name} copy`, selected.look)}>
                        A copy of {selected.name}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!shownSlide?.text.trim()}
                        onSelect={() =>
                          shownSlide &&
                          void createFrom(`${target?.title ?? "Slide"} look`, lookFromSlide(shownSlide, canvas))
                        }
                      >
                        {slideIndex !== null ? `The look of slide ${slideIndex + 1}` : "The look of this slide"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null
              }
            >
              {saved.themes === null ? (
                <p className="px-4 py-1.5 text-[11px] text-muted-foreground">
                  {saved.signedIn ? "Loading…" : "Sign in to keep your own themes."}
                </p>
              ) : entries.mine.length === 0 ? (
                <p className="px-4 py-1.5 text-[11px] leading-4 text-muted-foreground">
                  {canCustomize
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

          {/* The slide, to design on */}
          <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto p-5">
            <div className="mx-auto flex min-h-7 w-full max-w-[880px] items-center gap-2">
              <p className="min-w-0 truncate text-[13px] font-semibold text-foreground">
                {selected.name}
                {selected.edited ? <span className="ml-1.5 font-normal text-muted-foreground">(edited)</span> : null}
              </p>
              {status ? <span className="truncate text-[11px] text-muted-foreground">{status}</span> : null}
              <span className="ml-auto flex items-center gap-1">
                <ToolButton label="Undo" disabled={!steps.canUndo} onClick={undo}>
                  <Undo2 className="h-3.5 w-3.5" />
                </ToolButton>
                <ToolButton label="Redo" disabled={!steps.canRedo} onClick={redo}>
                  <Redo2 className="h-3.5 w-3.5" />
                </ToolButton>
              </span>
            </div>

            <div className="mx-auto w-full max-w-[880px] pt-4">
              <DesignCanvas
                look={selected.look}
                slide={designed}
                canvasSize={canvasSize}
                selected={designTarget}
                editable={editable}
                onSelect={setDesignTarget}
                onFrameChange={onFrameChange}
              />
            </div>
            <p className="mx-auto w-full max-w-[880px] text-[11px] text-muted-foreground">
              {editable
                ? "Drag the words or the box to move them, and their corners to resize. The arrow keys nudge the one selected."
                : canCustomize
                  ? "You're offline. Your themes can be changed once you're back online."
                  : "Changing and saving themes comes with Pro and Power."}
            </p>

            {songSlides.length > 1 ? (
              <div className="mx-auto w-full max-w-[880px]">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">In this song</p>
                <div className="grid grid-cols-6 gap-2">
                  {songSlides.slice(0, MAX_STRIP_SLIDES).map((slide, index) => (
                    <button
                      key={`${slide.id}-${index}`}
                      type="button"
                      onClick={() => setPickedIndex(index)}
                      className={cn(
                        "relative overflow-hidden rounded-md ring-offset-2 ring-offset-card transition",
                        index === slideIndex ? "ring-2 ring-primary" : "opacity-75 hover:opacity-100",
                      )}
                      aria-label={`Slide ${index + 1}`}
                    >
                      <SlidePicture
                        slide={applyLookToSlide(slide, stripLook, canvas) as LibrarySlide}
                        look={stripLook}
                        canvasSize={canvasSize}
                      />
                      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] font-semibold text-white">
                        {index + 1}
                      </span>
                    </button>
                  ))}
                </div>
                {songSlides.length > MAX_STRIP_SLIDES ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">And {songSlides.length - MAX_STRIP_SLIDES} more</p>
                ) : null}
              </div>
            ) : null}

            <div className="mx-auto mt-auto flex w-full max-w-[880px] flex-wrap items-center gap-3 border-t border-border/60 pt-4">
              <Segmented
                label="Apply to"
                value={scope}
                disabled={!target}
                onChange={(value) => setScope(value as "song" | "slide")}
                options={[
                  { value: "song", label: "Whole song" },
                  {
                    value: "slide",
                    label: slideIndex !== null ? `Slide ${slideIndex + 1} only` : "This slide",
                    disabled: slideIndex === null,
                  },
                ]}
              />
              <button
                type="button"
                disabled={!target && !locked}
                onClick={() => apply()}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
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
          <aside className="flex min-h-0 min-w-0 flex-col border-l border-border/70">
            <ThemeHeader
              entry={selected}
              canCustomize={canCustomize}
              canSave={saved.canSave}
              isCreating={isCreating}
              onRename={(name) =>
                void saved
                  .update(selected.id, { name })
                  .catch((error) => toast.error(errorText(error, "That name couldn't be saved.")))
              }
              onDelete={() => void remove(selected)}
              onSaveDraft={() => void createFrom(selected.name, selected.look, selected.id)}
              onResetDraft={() => {
                history.current.delete(selected.id);
                setHistoryTick((tick) => tick + 1);
                setDraft(selected.id, null);
              }}
              onOpenPlans={openPlans}
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ThemeInspector
                key={selected.id}
                look={selected.look}
                disabled={!editable}
                canGradient={canGradient}
                onChange={(look) => change(look)}
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** A look with its gradients as their first colours, for a plan without them. */
function withoutGradients(look: ThemeLook): ThemeLook {
  const plain = (fill: ThemeLook["background"]): ThemeLook["background"] =>
    fill && fill.kind !== "color"
      ? { kind: "color", color: fill.kind === "gradient" ? fill.from : fill.base }
      : fill;
  return {
    ...look,
    text: { ...look.text, gradient: null, color: look.text.gradient?.from ?? look.text.color },
    background: plain(look.background),
    box: look.box ? { ...look.box, fill: plain(look.box.fill) ?? look.box.fill } : null,
  };
}

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** The chosen theme's name and what can be done with it. */
function ThemeHeader({
  entry,
  canCustomize,
  canSave,
  isCreating,
  onRename,
  onDelete,
  onSaveDraft,
  onResetDraft,
  onOpenPlans,
}: {
  entry: Entry;
  canCustomize: boolean;
  canSave: boolean;
  isCreating: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onSaveDraft: () => void;
  onResetDraft: () => void;
  onOpenPlans: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const description = BUILT_IN_THEMES.find((theme) => theme.id === entry.id)?.description;
  return (
    <div className="flex flex-col gap-2 border-b border-border/70 px-4 py-3">
      {entry.saved ? (
        <div className="flex items-center gap-2">
          <input
            key={entry.id}
            type="text"
            defaultValue={entry.name}
            maxLength={60}
            aria-label="Theme name"
            disabled={!canSave}
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
              disabled={!canSave}
              onClick={() => setConfirmDelete(true)}
              className="rounded-md p-2 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
              aria-label="Delete theme"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div>
          <p className="text-[13px] font-semibold text-foreground">{entry.name}</p>
          {description ? <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p> : null}
        </div>
      )}
      {!canCustomize ? (
        <div className="flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-2">
          <p className="min-w-0 flex-1 text-[11px] leading-4 text-muted-foreground">
            Changing and saving themes comes with Pro and Power.
          </p>
          <button
            type="button"
            onClick={onOpenPlans}
            className="flex-none rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground"
          >
            See plans
          </button>
        </div>
      ) : entry.edited ? (
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={isCreating || !canSave}
            onClick={onSaveDraft}
            className="h-8 flex-1 rounded-md bg-primary text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Save as my theme
          </button>
          <button
            type="button"
            onClick={onResetDraft}
            className="flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-[12px] text-muted-foreground hover:text-foreground"
            title="Put this built-in theme back as it was"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>
      ) : null}
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
        {badge ? <span className="rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold text-primary">{badge}</span> : null}
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
        <span className={cn("min-w-0 flex-1 truncate", isLocked && "text-muted-foreground")}>
          {entry.name}
          {entry.edited ? <span className="text-muted-foreground"> (edited)</span> : null}
        </span>
        {isOnSong ? <Check className="h-3.5 w-3.5 flex-none text-primary" aria-label="On this song" /> : null}
        {isLocked ? <Lock className="h-3 w-3 flex-none text-muted-foreground" aria-label="Locked" /> : null}
      </button>
    </li>
  );
}

/** A theme in miniature: its background, its box, and "Aa" in its words' style. */
function Swatch({ look }: { look: ThemeLook }) {
  const { text } = look;
  return (
    <span
      className="relative flex h-[24px] w-[42px] flex-none overflow-hidden rounded-[4px] border border-white/10"
      style={{ background: look.background ? fillSwatchCss(look.background) : MEDIA_STAND_IN }}
      aria-hidden
    >
      {look.box ? (
        <span
          className="absolute"
          style={{
            left: `${look.box.frame.x * 100}%`,
            top: `${look.box.frame.y * 100}%`,
            width: `${look.box.frame.width * 100}%`,
            height: `${look.box.frame.height * 100}%`,
            background: fillSwatchCss(look.box.fill),
            borderRadius: Math.min(4, look.box.radius / 10),
          }}
        />
      ) : null}
      <span
        className="absolute flex items-center justify-center text-[10px] leading-none"
        style={{
          left: `${look.frame.x * 100}%`,
          top: `${look.frame.y * 100}%`,
          width: `${look.frame.width * 100}%`,
          height: `${look.frame.height * 100}%`,
          fontFamily: text.fontFamily,
          fontWeight: Number(text.fontWeight),
          fontStyle: text.italic ? "italic" : "normal",
          textTransform: text.case === "upper" ? "uppercase" : text.case === "lower" ? "lowercase" : "none",
          color: text.gradient ? "transparent" : text.color,
          opacity: text.opacity,
          backgroundImage: text.gradient
            ? `linear-gradient(${text.gradient.angle}deg, ${text.gradient.from}, ${text.gradient.to})`
            : undefined,
          WebkitBackgroundClip: text.gradient ? "text" : undefined,
          backgroundClip: text.gradient ? "text" : undefined,
          WebkitTextStroke: text.outline ? `0.6px ${text.outline.color}` : undefined,
        }}
      >
        Aa
      </span>
    </span>
  );
}

/** A slide drawn by the renderer the output uses, over its background. */
function SlidePicture({
  slide,
  look,
  canvasSize,
}: {
  slide: LibrarySlide;
  look: ThemeLook;
  canvasSize: CanvasSizePreset;
}) {
  const { width, height } = getCanvasSizeDimensions(canvasSize);
  return (
    <div
      className="relative w-full overflow-hidden border border-border/60"
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
