import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/utils";

type Direction = "horizontal" | "vertical";

type NumericLike = number | string | undefined;

type ResizablePanelProps = {
  children?: React.ReactNode;
  className?: string;
  defaultSize?: NumericLike;
  minSize?: NumericLike;
  maxSize?: NumericLike;
  order?: number;
  id?: string;
};

type ResizableHandleProps = {
  className?: string;
  withHandle?: boolean;
};

type ResizablePanelGroupProps = {
  children: React.ReactNode;
  className?: string;
  direction?: Direction;
  orientation?: Direction;
  autoSaveId?: string;
  id?: string;
};

const STORAGE_PREFIX = "present:resizable:";

function toNumber(value: NumericLike, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSizes(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return values.map(() => 0);
  }
  return values.map((value) => (value / total) * 100);
}

export function ResizablePanelGroup({
  children,
  className,
  direction,
  orientation,
  autoSaveId,
  id,
}: ResizablePanelGroupProps) {
  const resolvedDirection = direction ?? orientation ?? "horizontal";
  const containerRef = useRef<HTMLDivElement>(null);
  const persistedKey = autoSaveId ?? id ?? null;

  const childArray = useMemo(() => Children.toArray(children), [children]);

  const panels = useMemo(
    () =>
      childArray.filter(
        (child): child is React.ReactElement<ResizablePanelProps> =>
          isValidElement(child) && child.type === ResizablePanel,
      ),
    [childArray],
  );

  const handles = useMemo(
    () =>
      childArray.filter(
        (child): child is React.ReactElement<ResizableHandleProps> =>
          isValidElement(child) && child.type === ResizableHandle,
      ),
    [childArray],
  );

  const panelConstraints = useMemo(
    () =>
      panels.map((panel) => ({
        min: clamp(toNumber(panel.props.minSize, 0), 0, 100),
        max: clamp(toNumber(panel.props.maxSize, 100), 0, 100),
        defaultSize: toNumber(panel.props.defaultSize, Number.NaN),
      })),
    [panels],
  );

  const initialSizes = useMemo(() => {
    if (panels.length === 0) {
      return [];
    }

    const defaults = panelConstraints.map((constraint) => constraint.defaultSize);
    const hasExplicitDefault = defaults.some((size) => Number.isFinite(size));

    if (!hasExplicitDefault) {
      return Array.from({ length: panels.length }, () => 100 / panels.length);
    }

    const explicitTotal = defaults.reduce(
      (sum, value) => sum + (Number.isFinite(value) ? value : 0),
      0,
    );
    const remainingPanels = defaults.filter((value) => !Number.isFinite(value)).length;
    const remainingSize = Math.max(0, 100 - explicitTotal);
    const fallbackSize = remainingPanels > 0 ? remainingSize / remainingPanels : 0;

    return normalizeSizes(
      defaults.map((value, index) => {
        const raw = Number.isFinite(value) ? value : fallbackSize;
        const { min, max } = panelConstraints[index];
        return clamp(raw, min, max);
      }),
    );
  }, [panelConstraints, panels.length]);

  const [sizes, setSizes] = useState<number[]>(() => {
    if (!persistedKey || typeof window === "undefined" || panels.length === 0) {
      return initialSizes;
    }

    try {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${persistedKey}`);
      if (!raw) {
        return initialSizes;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length !== panels.length) {
        return initialSizes;
      }

      return normalizeSizes(
        parsed.map((value, index) => {
          const numeric = toNumber(value, initialSizes[index] ?? 0);
          const { min, max } = panelConstraints[index];
          return clamp(numeric, min, max);
        }),
      );
    } catch (error) {
      console.error("Failed to restore panel layout:", error);
      return initialSizes;
    }
  });

  const effectiveSizes = sizes.length === panels.length ? sizes : initialSizes;

  useEffect(() => {
    if (
      !persistedKey ||
      typeof window === "undefined" ||
      effectiveSizes.length === 0
    ) {
      return;
    }

    try {
      window.localStorage.setItem(
        `${STORAGE_PREFIX}${persistedKey}`,
        JSON.stringify(effectiveSizes),
      );
    } catch (error) {
      console.error("Failed to persist panel layout:", error);
    }
  }, [effectiveSizes, persistedKey]);

  const startDrag = (handleIndex: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || panels.length < 2) {
      return;
    }

    event.preventDefault();

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const startPoint =
      resolvedDirection === "horizontal" ? event.clientX : event.clientY;
    const totalPixels =
      resolvedDirection === "horizontal" ? rect.width : rect.height;

    if (totalPixels <= 0) {
      return;
    }

    const leftIndex = handleIndex;
    const rightIndex = handleIndex + 1;
    const baseSizes = [...effectiveSizes];
    const pairTotal = (baseSizes[leftIndex] ?? 0) + (baseSizes[rightIndex] ?? 0);

    const leftBounds = panelConstraints[leftIndex];
    const rightBounds = panelConstraints[rightIndex];
    const isOpeningFromZero = (baseSizes[leftIndex] ?? 0) <= 0.5;
    let didMove = false;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const currentPoint =
        resolvedDirection === "horizontal" ? moveEvent.clientX : moveEvent.clientY;
      const pixelDelta = currentPoint - startPoint;
      if (Math.abs(pixelDelta) > 3) {
        didMove = true;
      }

      const deltaPercent = (pixelDelta / totalPixels) * 100;

      let nextLeft = (baseSizes[leftIndex] ?? 0) + deltaPercent;

      if (isOpeningFromZero) {
        // Dragging open from 0 width
        if (deltaPercent > 0.3) {
          const defaultSz = toNumber(panels[leftIndex]?.props.defaultSize, 34);
          const minReadable = Math.min(defaultSz, 20);
          nextLeft = clamp(Math.max(minReadable, deltaPercent), leftBounds.min, leftBounds.max);
        } else {
          nextLeft = 0;
        }
      } else {
        // Resizing open panel
        nextLeft = clamp(nextLeft, leftBounds.min, leftBounds.max);
        // Snap to close if dragged near the edge
        if (leftBounds.min === 0 && nextLeft < 6) {
          nextLeft = 0;
        }
      }

      let nextRight = pairTotal - nextLeft;

      if (nextRight < rightBounds.min) {
        nextRight = rightBounds.min;
        nextLeft = pairTotal - nextRight;
      }

      if (nextRight > rightBounds.max) {
        nextRight = rightBounds.max;
        nextLeft = pairTotal - nextRight;
      }

      setSizes((previous) => {
        const next = [...previous];
        next[leftIndex] = nextLeft;
        next[rightIndex] = nextRight;
        return next;
      });
    };

    const stopDrag = () => {
      // If user clicked without dragging on a collapsed handle, expand it to default size
      if (!didMove && isOpeningFromZero && leftBounds.min === 0) {
        const defaultSz = toNumber(panels[leftIndex]?.props.defaultSize, 34);
        setSizes((previous) => {
          const next = [...previous];
          next[leftIndex] = clamp(defaultSz, 15, leftBounds.max);
          next[rightIndex] = pairTotal - next[leftIndex];
          return next;
        });
      }

      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
  };

  const handleDoubleClick = (index: number) => {
    const leftBounds = panelConstraints[index];
    const rightBounds = panelConstraints[index + 1];
    if (!leftBounds || !rightBounds) return;

    const baseSizes = [...effectiveSizes];
    const pairTotal = (baseSizes[index] ?? 0) + (baseSizes[index + 1] ?? 0);

    if (leftBounds.min === 0) {
      setSizes((previous) => {
        const next = [...previous];
        const isClosed = (next[index] ?? 0) <= 0.5;
        const defaultSz = toNumber(panels[index]?.props.defaultSize, 34);
        if (isClosed) {
          next[index] = clamp(defaultSz, 15, leftBounds.max);
          next[index + 1] = pairTotal - next[index];
        } else {
          next[index] = 0;
          next[index + 1] = pairTotal;
        }
        return next;
      });
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full w-full overflow-hidden",
        resolvedDirection === "vertical" ? "flex-col" : "flex-row",
        className,
      )}
    >
      {panels.map((panel, index) => {
        const size = effectiveSizes[index] ?? initialSizes[index] ?? 0;
        const handle = handles[index];
        const isCollapsed = size <= 0.5;

        return (
          <Fragment key={`panel-${index}`}>
            <div
              className={cn("min-h-0 min-w-0 overflow-hidden", panel.props.className)}
              style={{
                flexBasis: `${size}%`,
                flexGrow: 0,
                flexShrink: 0,
              }}
            >
              {panel.props.children}
            </div>
            {index < panels.length - 1 ? (
              <div
                onPointerDown={(event) => startDrag(index, event)}
                onDoubleClick={() => handleDoubleClick(index)}
                className={cn(
                  "group relative z-30 shrink-0 transition-colors",
                  resolvedDirection === "horizontal"
                    ? cn(
                        "h-full cursor-col-resize",
                        isCollapsed
                          ? "w-1 bg-primary/50 hover:bg-primary shadow-[0_0_6px_rgba(99,102,241,0.6)]"
                          : "w-px bg-border hover:bg-primary/80",
                      )
                    : cn(
                        "w-full cursor-row-resize",
                        isCollapsed
                          ? "h-1 bg-primary/50 hover:bg-primary shadow-[0_0_6px_rgba(99,102,241,0.6)]"
                          : "h-px bg-border hover:bg-primary/80",
                      ),
                  handle?.props.className,
                )}
              >
                <div
                  className={cn(
                    "absolute z-10",
                    resolvedDirection === "horizontal"
                      ? isCollapsed
                        ? "inset-y-0 -left-1 -right-4"
                        : "inset-y-0 -left-2 -right-2"
                      : isCollapsed
                        ? "inset-x-0 -top-1 -bottom-4"
                        : "inset-x-0 -top-2 -bottom-2",
                  )}
                />
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

export function ResizablePanel({ children }: ResizablePanelProps) {
  return <>{children}</>;
}

export function ResizableHandle(props: ResizableHandleProps): null {
  void props;
  return null;
}
