"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clock3,
  Copy,
  Hourglass,
  LayoutTemplate,
  ListMusic,
  MonitorPlay,
  Plus,
  RotateCcw,
  Square,
  Tag,
  Timer,
  Trash2,
  Type,
  TextQuote,
} from "lucide-react";
import { FontFamilySelect } from "../../renderer/shared/components";
import { ColorInput, NumberInput, Segmented, SelectInput, StyleRow, StyleSection, Switch } from "../../renderer/shared/components/style-controls";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../renderer/shared/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../renderer/shared/components/ui/dropdown-menu";
import { getFontWeightOptionsForFamily, useFontCatalog } from "../../renderer/shared/hooks/useFontCatalog";
import { cn } from "../../renderer/shared/lib/utils";
import { updateScreen, useScreens } from "../../renderer/tauri/screens";
import {
  BUILT_IN_LAYOUTS,
  EDITOR_LAYOUT_EVENT,
  takeEditorLayout,
  newLayoutId,
  newObjectId,
  OBJECT_KINDS,
  objectOf,
  TEMPLATES,
  useStageLayouts,
  type StageLayout,
  type StageObject,
  type StageObjectKind,
  type StageObjectStyle,
} from "./layouts";
import { StageLayoutView } from "./StageLayoutView";
import { Fitted } from "./StageLayoutWindow";
import { useStageFeed } from "./useStageFeed";

const KIND_ICON: Record<StageObjectKind, typeof Type> = {
  "current-text": TextQuote,
  "next-text": ListMusic,
  "current-slide": MonitorPlay,
  section: Tag,
  "next-section": Tag,
  timer: Timer,
  "timer-label": Hourglass,
  clock: Clock3,
  text: Type,
  shape: Square,
};

const SIZES = [
  { value: "1920x1080", label: "1920 × 1080" },
  { value: "1280x720", label: "1280 × 720" },
  { value: "3840x2160", label: "3840 × 2160" },
  { value: "1920x1200", label: "1920 × 1200" },
  { value: "1024x768", label: "1024 × 768" },
];

/** Where things snap to, in the layout's pixels. Hold Alt to place freely. */
const GRID = 10;
const snap = (value: number, free: boolean) => (free ? Math.round(value) : Math.round(value / GRID) * GRID);

type Drag = {
  object: string;
  /** Which edges move: all four to move it, some to resize. */
  edges: { left: boolean; right: boolean; top: boolean; bottom: boolean };
  startX: number;
  startY: number;
  original: StageObject;
};

/**
 * Stage layouts, made and changed: ProPresenter's stage editor. The
 * layouts down the side, the one open in the middle with its objects to move
 * and resize, and what is selected to set on the right.
 */
export function StageLayoutEditor() {
  const { layouts, save, remove } = useStageLayouts();
  const { screens } = useScreens();
  const feed = useStageFeed();
  const [layoutId, setLayoutId] = useState(() => takeEditorLayout() || BUILT_IN_LAYOUTS[0]);
  // Asked for another from Screen Configuration while open.
  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>(EDITOR_LAYOUT_EVENT, ({ payload }) => {
          if (typeof payload === "string") {
            setLayoutId(payload);
            setSelectedId(null);
            takeEditorLayout();
          }
        }),
      )
      .then((unlisten) => {
        if (cancelled) unlisten();
        else detach = unlisten;
      })
      .catch((): void => undefined);
    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);
  const stored = layouts.find((layout) => layout.id === layoutId) ?? layouts[0];
  // A drag is drawn from here, and saved when it ends: a layout is written
  // and sent to every stage screen once a move, not sixty times a second.
  const [draft, setDraft] = useState<StageLayout | null>(null);
  const layout = draft && draft.id === stored?.id ? draft : stored;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = layout?.objects.find((object) => object.id === selectedId) ?? null;
  const drag = useRef<Drag | null>(null);

  const stageScreens = (screens ?? []).filter((screen) => screen.group === "stage");

  const change = useCallback(
    (next: StageLayout) => {
      setDraft(null);
      save(next);
    },
    [save],
  );

  const changeObject = useCallback(
    (id: string, patch: Partial<StageObject>) => {
      if (!layout) return;
      change({ ...layout, objects: layout.objects.map((object) => (object.id === id ? { ...object, ...patch } : object)) });
    },
    [change, layout],
  );

  const changeStyle = useCallback(
    (id: string, patch: Partial<StageObjectStyle>) => {
      const object = layout?.objects.find((each) => each.id === id);
      if (object) changeObject(id, { style: { ...object.style, ...patch } });
    },
    [changeObject, layout],
  );

  const addObject = (kind: StageObjectKind) => {
    if (!layout) return;
    const width = kind === "current-slide" ? layout.width : Math.round(layout.width * 0.4);
    const height = kind === "current-slide" ? layout.height : Math.round(layout.height * 0.22);
    const object = objectOf(kind, {
      x: snap((layout.width - width) / 2, false),
      y: snap((layout.height - height) / 2, false),
      width,
      height,
    });
    change({ ...layout, objects: [...layout.objects, object] });
    setSelectedId(object.id);
  };

  const removeObject = useCallback(
    (id: string) => {
      if (!layout) return;
      change({ ...layout, objects: layout.objects.filter((object) => object.id !== id) });
      setSelectedId(null);
    },
    [change, layout],
  );

  const duplicateObject = useCallback(
    (id: string) => {
      const object = layout?.objects.find((each) => each.id === id);
      if (!layout || !object) return;
      const copy = { ...object, id: newObjectId(), x: object.x + 30, y: object.y + 30 };
      change({ ...layout, objects: [...layout.objects, copy] });
      setSelectedId(copy.id);
    },
    [change, layout],
  );

  const restack = (id: string, direction: 1 | -1) => {
    if (!layout) return;
    const at = layout.objects.findIndex((object) => object.id === id);
    const to = at + direction;
    if (at < 0 || to < 0 || to >= layout.objects.length) return;
    const objects = [...layout.objects];
    const [moved] = objects.splice(at, 1);
    objects.splice(to, 0, moved);
    change({ ...layout, objects });
  };

  const newLayout = (template: (typeof TEMPLATES)[number]) => {
    const made = { ...template.make(), id: newLayoutId() };
    const names = new Set(layouts.map((each) => each.name));
    let name = made.name;
    for (let count = 2; names.has(name); count += 1) name = `${made.name} ${count}`;
    save({ ...made, name });
    setLayoutId(made.id);
    setSelectedId(null);
  };

  const duplicateLayout = (source: StageLayout) => {
    const copy = {
      ...source,
      id: newLayoutId(),
      name: `${source.name} copy`,
      objects: source.objects.map((object) => ({ ...object, id: newObjectId() })),
    };
    save(copy);
    setLayoutId(copy.id);
  };

  // The keyboard, while nothing is being typed into.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!selected || !layout) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeObject(selected.id);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateObject(selected.id);
      } else if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        changeObject(selected.id, { x: selected.x + dx, y: selected.y + dy });
      } else if (event.key === "Escape") {
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changeObject, duplicateObject, layout, removeObject, selected]);

  // The canvas: the layout fitted to the space, and the objects moved in the
  // layout's own pixels.
  const [area, setArea] = useState({ width: 0, height: 0 });
  const areaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = areaRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setArea({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const scale = layout && area.width > 0 ? Math.min((area.width - 48) / layout.width, (area.height - 48) / layout.height) : 0;

  const startDrag = (event: ReactPointerEvent, object: StageObject, edges: Drag["edges"]) => {
    event.stopPropagation();
    event.preventDefault();
    setSelectedId(object.id);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { object: object.id, edges, startX: event.clientX, startY: event.clientY, original: object };
  };
  const moveDrag = (event: ReactPointerEvent) => {
    const current = drag.current;
    if (!current || !layout || scale <= 0) return;
    const dx = (event.clientX - current.startX) / scale;
    const dy = (event.clientY - current.startY) / scale;
    const free = event.altKey;
    const { original, edges } = current;
    const moveAll = edges.left && edges.right && edges.top && edges.bottom;
    let { x, y, width, height } = original;
    if (moveAll) {
      x = snap(original.x + dx, free);
      y = snap(original.y + dy, free);
    } else {
      if (edges.left) {
        const left = snap(original.x + dx, free);
        width = Math.max(20, original.x + original.width - left);
        x = original.x + original.width - width;
      }
      if (edges.right) width = Math.max(20, snap(original.x + original.width + dx, free) - original.x);
      if (edges.top) {
        const top = snap(original.y + dy, free);
        height = Math.max(20, original.y + original.height - top);
        y = original.y + original.height - height;
      }
      if (edges.bottom) height = Math.max(20, snap(original.y + original.height + dy, free) - original.y);
    }
    setDraft({
      ...layout,
      objects: layout.objects.map((object) => (object.id === current.object ? { ...object, x, y, width, height } : object)),
    });
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    if (draft) change(draft);
  };

  const usedBy = (id: string) => stageScreens.filter((screen) => (screen.layout ?? (screen.id === "media" ? "media" : "worship")) === id);

  if (!layout) return null;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex flex-none items-center justify-between gap-4 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold">Stage Layouts</h1>
          <p className="text-[12px] text-muted-foreground">
            What each stage screen shows. Add objects from the bar, drag them into place, and set them on the right.
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[250px] flex-none flex-col border-r border-border bg-card/40">
          <div className="flex items-center justify-between px-3 pb-2 pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Layouts</span>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
                aria-label="New layout"
                title="New layout"
              >
                <Plus className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[300px]">
                <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">New layout from</DropdownMenuLabel>
                {TEMPLATES.map((template) => (
                  <DropdownMenuItem key={template.id} onSelect={() => newLayout(template)} className="items-start">
                    <LayoutTemplate className="mt-0.5 h-4 w-4" />
                    <span className="min-w-0">
                      <span className="block text-[13px]">{template.name}</span>
                      <span className="block text-[11px] leading-[15px] text-muted-foreground">{template.description}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
            {layouts.map((each) => {
              const users = usedBy(each.id);
              const builtIn = BUILT_IN_LAYOUTS.includes(each.id);
              return (
                <ContextMenu key={each.id}>
                  <ContextMenuTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setLayoutId(each.id);
                        setSelectedId(null);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition",
                        each.id === layout.id ? "bg-foreground/[0.09]" : "hover:bg-foreground/[0.04]",
                      )}
                    >
                      <span
                        className="relative block flex-none overflow-hidden rounded ring-1 ring-white/10"
                        style={{ width: 72, height: Math.round((72 * each.height) / each.width), background: "#000" }}
                      >
                        <Fitted layout={each} feed={feed} sample />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{each.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {users.length > 0 ? users.map((screen) => screen.name).join(", ") : "Not on a screen"}
                        </span>
                      </span>
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => duplicateLayout(each)}>
                      <Copy className="h-4 w-4" />
                      Duplicate
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onSelect={() => remove(each.id)}>
                      {builtIn ? <RotateCcw className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                      {builtIn ? "Put back as it started" : "Delete"}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-none flex-wrap items-center gap-1 border-b border-border px-3 py-2">
            {OBJECT_KINDS.map(({ kind, label, description }) => {
              const Icon = KIND_ICON[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => addObject(kind)}
                  title={description}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
          <div
            ref={areaRef}
            className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:16px_16px]"
            onPointerDown={() => setSelectedId(null)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {scale > 0 ? (
              <div
                className="absolute shadow-2xl ring-1 ring-white/15"
                style={{
                  left: (area.width - layout.width * scale) / 2,
                  top: (area.height - layout.height * scale) / 2,
                  width: layout.width * scale,
                  height: layout.height * scale,
                }}
              >
                <div style={{ transformOrigin: "0 0", transform: `scale(${scale})` }}>
                  <StageLayoutView layout={layout} feed={feed} sample>
                    {layout.objects.map((object) => (
                      <ObjectHandles
                        key={object.id}
                        object={object}
                        selected={object.id === selectedId}
                        scale={scale}
                        onGrab={startDrag}
                      />
                    ))}
                  </StageLayoutView>
                </div>
              </div>
            ) : null}
          </div>
        </main>

        <aside className="w-[300px] flex-none overflow-y-auto border-l border-border bg-card/40">
          {selected ? (
            <ObjectInspector
              object={selected}
              onChange={(patch) => changeObject(selected.id, patch)}
              onStyle={(patch) => changeStyle(selected.id, patch)}
              onDuplicate={() => duplicateObject(selected.id)}
              onForward={() => restack(selected.id, 1)}
              onBackward={() => restack(selected.id, -1)}
              onDelete={() => removeObject(selected.id)}
            />
          ) : (
            <LayoutInspector
              layout={layout}
              stageScreens={stageScreens.map((screen) => ({
                id: screen.id,
                name: screen.name,
                using: (screen.layout ?? (screen.id === "media" ? "media" : "worship")) === layout.id,
              }))}
              onChange={change}
              onUse={(screen) => {
                void updateScreen(screen, { layout: layout.id }).catch((error: unknown) =>
                  console.error("[Stage] could not put the layout on a screen", error),
                );
              }}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

/** The outline and handles of one object, over the canvas. */
function ObjectHandles({
  object,
  selected,
  scale,
  onGrab,
}: {
  object: StageObject;
  selected: boolean;
  scale: number;
  onGrab: (event: ReactPointerEvent, object: StageObject, edges: Drag["edges"]) => void;
}) {
  const all = { left: true, right: true, top: true, bottom: true };
  const handle = 10 / scale;
  const corners: Array<[string, Drag["edges"], string]> = [
    ["nw", { left: true, right: false, top: true, bottom: false }, "cursor-nwse-resize"],
    ["ne", { left: false, right: true, top: true, bottom: false }, "cursor-nesw-resize"],
    ["sw", { left: true, right: false, top: false, bottom: true }, "cursor-nesw-resize"],
    ["se", { left: false, right: true, top: false, bottom: true }, "cursor-nwse-resize"],
    ["n", { left: false, right: false, top: true, bottom: false }, "cursor-ns-resize"],
    ["s", { left: false, right: false, top: false, bottom: true }, "cursor-ns-resize"],
    ["w", { left: true, right: false, top: false, bottom: false }, "cursor-ew-resize"],
    ["e", { left: false, right: true, top: false, bottom: false }, "cursor-ew-resize"],
  ];
  const at = (name: string) => ({
    left: name.includes("w") ? -handle / 2 : name.includes("e") ? object.width - handle / 2 : object.width / 2 - handle / 2,
    top: name.includes("n") ? -handle / 2 : name.includes("s") ? object.height - handle / 2 : object.height / 2 - handle / 2,
  });
  return (
    <div
      className={cn("absolute cursor-move", selected ? "outline outline-primary" : "hover:outline hover:outline-primary/50")}
      style={{
        left: object.x,
        top: object.y,
        width: object.width,
        height: object.height,
        outlineWidth: 2 / scale,
        outlineOffset: 0,
      }}
      onPointerDown={(event) => onGrab(event, object, all)}
    >
      {selected
        ? corners.map(([name, edges, cursor]) => (
            <span
              key={name}
              className={cn("absolute rounded-sm border border-primary bg-white", cursor)}
              style={{ ...at(name), width: handle, height: handle, borderWidth: 1 / scale }}
              onPointerDown={(event) => onGrab(event, object, edges)}
            />
          ))
        : null}
    </div>
  );
}

function LayoutInspector({
  layout,
  stageScreens,
  onChange,
  onUse,
}: {
  layout: StageLayout;
  stageScreens: Array<{ id: string; name: string; using: boolean }>;
  onChange: (layout: StageLayout) => void;
  onUse: (screen: string) => void;
}) {
  const [name, setName] = useState(layout.name);
  const [named, setNamed] = useState(layout.name);
  if (named !== layout.name) {
    setNamed(layout.name);
    setName(layout.name);
  }
  const size = `${layout.width}x${layout.height}`;
  return (
    <div>
      <StyleSection title="Layout">
        <StyleRow label="Name">
          <input
            aria-label="Layout name"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const next = name.trim();
              if (next && next !== layout.name) onChange({ ...layout, name: next });
              else setName(layout.name);
            }}
            onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
            className="h-8 w-full rounded-md border border-border bg-background/40 px-2 text-[12px] outline-none focus:border-primary/60"
          />
        </StyleRow>
        <StyleRow label="Size">
          <SelectInput
            label="Layout size"
            value={SIZES.some((each) => each.value === size) ? size : "custom"}
            onChange={(value) => {
              if (value === "custom") return;
              const [width, height] = value.split("x").map(Number);
              onChange({ ...layout, width, height });
            }}
            options={[...SIZES, ...(SIZES.some((each) => each.value === size) ? [] : [{ value: "custom", label: `${layout.width} × ${layout.height}` }])]}
          />
        </StyleRow>
      </StyleSection>
      <StyleSection
        title="Background"
        enabled={Boolean(layout.background)}
        onEnabledChange={(on) => onChange({ ...layout, background: on ? "#000000" : null })}
      >
        {layout.background ? (
          <ColorInput label="Background" alpha value={layout.background} onChange={(background) => onChange({ ...layout, background })} />
        ) : null}
      </StyleSection>
      {!layout.background ? (
        <p className="border-b border-border/60 px-4 pb-3 text-[11.5px] leading-[16px] text-muted-foreground">
          Off, the stage screen&apos;s own colour shows behind it.
        </p>
      ) : null}
      <StyleSection title="On screens">
        {stageScreens.map((screen) => (
          <div key={screen.id} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="truncate">{screen.name}</span>
            {screen.using ? (
              <span className="text-[11px] font-medium text-emerald-500">Showing</span>
            ) : (
              <button
                type="button"
                onClick={() => onUse(screen.id)}
                className="rounded-md px-2 py-0.5 text-[11px] font-medium text-primary transition hover:bg-primary/10"
              >
                Use here
              </button>
            )}
          </div>
        ))}
      </StyleSection>
      <p className="px-4 py-3 text-[11.5px] leading-[16px] text-muted-foreground">
        Select an object to set it. Arrow keys nudge it, Shift for ten; ⌘D duplicates; Delete removes. Hold Alt while
        dragging to place off the grid.
      </p>
    </div>
  );
}

function ObjectInspector({
  object,
  onChange,
  onStyle,
  onDuplicate,
  onForward,
  onBackward,
  onDelete,
}: {
  object: StageObject;
  onChange: (patch: Partial<StageObject>) => void;
  onStyle: (patch: Partial<StageObjectStyle>) => void;
  onDuplicate: () => void;
  onForward: () => void;
  onBackward: () => void;
  onDelete: () => void;
}) {
  const style = object.style;
  const { faces } = useFontCatalog();
  const weights = useMemo(() => getFontWeightOptionsForFamily(faces, style.fontFamily), [faces, style.fontFamily]);
  const kind = OBJECT_KINDS.find((each) => each.kind === object.kind);
  const hasWords = object.kind !== "shape" && object.kind !== "current-slide";
  const [text, setText] = useState(object.text ?? "");
  const [shownText, setShownText] = useState(object.text ?? "");
  if (shownText !== (object.text ?? "")) {
    setShownText(object.text ?? "");
    setText(object.text ?? "");
  }
  const [caption, setCaption] = useState(object.caption ?? "");
  const [shownCaption, setShownCaption] = useState(object.caption ?? "");
  if (shownCaption !== (object.caption ?? "")) {
    setShownCaption(object.caption ?? "");
    setCaption(object.caption ?? "");
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{kind?.label ?? object.kind}</div>
          <div className="text-[11px] text-muted-foreground">{kind?.description}</div>
        </div>
        <div className="flex flex-none items-center gap-0.5">
          {(
            [
              [onBackward, ArrowDown, "Send backward"],
              [onForward, ArrowUp, "Bring forward"],
              [onDuplicate, Copy, "Duplicate"],
              [onDelete, Trash2, "Delete"],
            ] as const
          ).map(([action, Icon, label]) => (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={label}
              onClick={action}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      <StyleSection title="Position">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["x", "X"],
              ["y", "Y"],
              ["width", "W"],
              ["height", "H"],
            ] as const
          ).map(([key, label]) => (
            <StyleRow key={key} label={label} className="grid-cols-[20px_minmax(0,1fr)]">
              <NumberInput
                label={label}
                value={object[key]}
                min={key === "width" || key === "height" ? 20 : -10000}
                max={10000}
                suffix="px"
                onChange={(value) => onChange({ [key]: value })}
              />
            </StyleRow>
          ))}
        </div>
      </StyleSection>

      {object.kind === "text" ? (
        <StyleSection title="Words">
          <textarea
            aria-label="Words"
            value={text}
            rows={3}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => text !== (object.text ?? "") && onChange({ text })}
            className="w-full resize-y rounded-md border border-border bg-background/40 px-2 py-1.5 text-[12px] outline-none focus:border-primary/60"
          />
        </StyleSection>
      ) : null}

      {object.kind === "shape" ? (
        <StyleSection title="Shape">
          <Segmented
            label="Shape"
            value={object.shape ?? "rectangle"}
            onChange={(value) => onChange({ shape: value === "ellipse" ? "ellipse" : "rectangle" })}
            options={[
              { value: "rectangle", label: "Box" },
              { value: "ellipse", label: "Circle" },
            ]}
          />
        </StyleSection>
      ) : null}

      {object.kind === "clock" ? (
        <StyleSection title="Clock">
          <StyleRow label="24-hour">
            <Switch
              label="24-hour clock"
              checked={object.clock?.hours24 ?? false}
              onChange={(hours24) => onChange({ clock: { seconds: object.clock?.seconds ?? true, hours24 } })}
            />
          </StyleRow>
          <StyleRow label="Seconds">
            <Switch
              label="Show seconds"
              checked={object.clock?.seconds ?? true}
              onChange={(seconds) => onChange({ clock: { hours24: object.clock?.hours24 ?? false, seconds } })}
            />
          </StyleRow>
        </StyleSection>
      ) : null}

      {hasWords ? (
        <StyleSection title="Text">
          <StyleRow label="Font">
            <FontFamilySelect
              value={style.fontFamily}
              onChange={(fontFamily) => onStyle({ fontFamily })}
              className="w-full"
              triggerClassName="h-8 w-full rounded-md border border-border bg-background/40 px-2 text-[11px]"
            />
          </StyleRow>
          <StyleRow label="Weight">
            <SelectInput
              label="Weight"
              value={style.fontWeight}
              onChange={(fontWeight) => onStyle({ fontWeight })}
              options={weights.length > 0 ? weights : [{ value: style.fontWeight, label: style.fontWeight }]}
            />
          </StyleRow>
          <StyleRow label="Size">
            <NumberInput label="Size" value={style.fontSize} min={8} max={800} suffix="px" onChange={(fontSize) => onStyle({ fontSize })} />
          </StyleRow>
          <StyleRow label="Color">
            <ColorInput label="Text color" value={style.color} onChange={(color) => onStyle({ color })} />
          </StyleRow>
          <StyleRow label="Across">
            <Segmented
              label="Align across"
              value={style.align}
              onChange={(value) => onStyle({ align: value as StageObjectStyle["align"] })}
              options={[
                { value: "left", label: "Left" },
                { value: "center", label: "Center" },
                { value: "right", label: "Right" },
              ]}
            />
          </StyleRow>
          <StyleRow label="Down">
            <Segmented
              label="Align down"
              value={style.valign}
              onChange={(value) => onStyle({ valign: value as StageObjectStyle["valign"] })}
              options={[
                { value: "top", label: "Top" },
                { value: "middle", label: "Middle" },
                { value: "bottom", label: "Bottom" },
              ]}
            />
          </StyleRow>
          <StyleRow label="Capitals">
            <Switch label="All capitals" checked={style.uppercase} onChange={(uppercase) => onStyle({ uppercase })} />
          </StyleRow>
          <StyleRow label="Fit">
            <Switch label="Shrink to fit" checked={style.fit} onChange={(fit) => onStyle({ fit })} />
            <span className="text-[10.5px] text-muted-foreground">Shrink long words to fit</span>
          </StyleRow>
        </StyleSection>
      ) : null}

      {hasWords && object.kind !== "section" && object.kind !== "next-section" ? (
        <StyleSection title="Caption">
          <input
            aria-label="Caption"
            value={caption}
            maxLength={40}
            placeholder="None"
            onChange={(event) => setCaption(event.target.value)}
            onBlur={() => caption !== (object.caption ?? "") && onChange({ caption: caption.trim() || null })}
            className="h-8 w-full rounded-md border border-border bg-background/40 px-2 text-[12px] outline-none focus:border-primary/60"
          />
          <p className="text-[10.5px] text-muted-foreground">
            A small title at the bottom of the box.{object.kind === "timer" ? " {timer} is the timer's name." : ""}
          </p>
        </StyleSection>
      ) : null}

      <StyleSection
        title="Fill"
        enabled={Boolean(style.background)}
        onEnabledChange={(on) => onStyle({ background: on ? "rgba(0, 0, 0, 0.8)" : null })}
      >
        {style.background ? (
          <ColorInput label="Fill" alpha value={style.background} onChange={(background) => onStyle({ background })} />
        ) : null}
      </StyleSection>
      <StyleSection
        title="Border"
        enabled={Boolean(style.borderColor) && style.borderWidth > 0}
        onEnabledChange={(on) => onStyle(on ? { borderColor: "rgba(161, 161, 170, 0.7)", borderWidth: 2 } : { borderColor: null, borderWidth: 0 })}
      >
        {style.borderColor ? (
          <>
            <ColorInput label="Border" alpha value={style.borderColor} onChange={(borderColor) => onStyle({ borderColor })} />
            <StyleRow label="Width">
              <NumberInput label="Border width" value={style.borderWidth} min={0} max={40} suffix="px" onChange={(borderWidth) => onStyle({ borderWidth })} />
            </StyleRow>
          </>
        ) : null}
      </StyleSection>
      <StyleSection title="Box">
        <StyleRow label="Corners">
          <NumberInput label="Corner radius" value={style.radius} min={0} max={400} suffix="px" onChange={(radius) => onStyle({ radius })} />
        </StyleRow>
        <StyleRow label="Padding">
          <NumberInput label="Padding" value={style.padding} min={0} max={400} suffix="px" onChange={(padding) => onStyle({ padding })} />
        </StyleRow>
      </StyleSection>
    </div>
  );
}
