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
        min: clamp(toNumber(panel.props.minSize, 8), 2, 95),
        max: clamp(toNumber(panel.props.maxSize, 92), 5, 98),
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

    const onPointerMove = (moveEvent: PointerEvent) => {
      const currentPoint =
        resolvedDirection === "horizontal" ? moveEvent.clientX : moveEvent.clientY;
      const deltaPercent = ((currentPoint - startPoint) / totalPixels) * 100;

      let nextLeft = clamp(
        (baseSizes[leftIndex] ?? 0) + deltaPercent,
        leftBounds.min,
        leftBounds.max,
      );
      let nextRight = pairTotal - nextLeft;

      if (nextRight < rightBounds.min) {
        nextRight = rightBounds.min;
        nextLeft = pairTotal - nextRight;
      }

      if (nextRight > rightBounds.max) {
        nextRight = rightBounds.max;
        nextLeft = pairTotal - nextRight;
      }

      nextLeft = clamp(nextLeft, leftBounds.min, leftBounds.max);
      nextRight = clamp(nextRight, rightBounds.min, rightBounds.max);

      setSizes((previous) => {
        const next = [...previous];
        next[leftIndex] = nextLeft;
        next[rightIndex] = nextRight;
        return next;
      });
    };

    const stopDrag = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
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
                className={cn(
                  "relative shrink-0 bg-transparent transition-colors",
                  resolvedDirection === "horizontal"
                    ? "h-full w-1.5 cursor-col-resize hover:bg-primary/25"
                    : "h-1.5 w-full cursor-row-resize hover:bg-primary/25",
                  handle?.props.className,
                )}
              />
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
