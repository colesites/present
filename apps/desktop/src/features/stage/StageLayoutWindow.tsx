"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { ownScreenId, useOwnScreen } from "../../renderer/tauri/screens";
import { cn } from "../../renderer/shared/lib/utils";
import { MEDIA_LAYOUT, WORSHIP_LAYOUT, useStageLayouts, type StageLayout } from "./layouts";
import { StageLayoutView } from "./StageLayoutView";
import { useStageFeed } from "./useStageFeed";

/**
 * A stage screen: the layout its screen in Screen Configuration names, drawn
 * from what the stage is being sent, scaled to fit the picture.
 */
export function StageLayoutWindow() {
  const screen = useOwnScreen();
  const { layouts } = useStageLayouts();
  const feed = useStageFeed();
  const fallback = ownScreenId() === "media" ? MEDIA_LAYOUT : WORSHIP_LAYOUT;
  const layout =
    layouts.find((each) => each.id === (screen?.layout ?? fallback)) ??
    layouts.find((each) => each.id === fallback) ??
    layouts[0];

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ backgroundColor: "var(--present-screen-color, #000)" }}
    >
      {layout ? <Fitted layout={layout} feed={feed} /> : null}
      <MultiviewButton />
    </div>
  );
}

/** A layout scaled to fit its box, centred. */
export function Fitted({
  layout,
  feed,
  sample = false,
}: {
  layout: StageLayout;
  feed: ReturnType<typeof useStageFeed>;
  sample?: boolean;
}) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const scale = box.width > 0 ? Math.min(box.width / layout.width, box.height / layout.height) : 0;
  return (
    <div ref={element} className="absolute inset-0 overflow-hidden">
      {scale > 0 ? (
        <div
          className="absolute left-0 top-0"
          style={{
            transformOrigin: "0 0",
            transform: `translate(${(box.width - layout.width * scale) / 2}px, ${(box.height - layout.height * scale) / 2}px) scale(${scale})`,
          }}
        >
          <StageLayoutView layout={layout} feed={feed} sample={sample} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Multiview, from the stage screen itself: whoever is at the stage display's
 * mouse opens every screen at once on it, and goes back from there.
 */
function MultiviewButton() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let hideId: number | undefined;
    const reveal = () => {
      setShown(true);
      window.clearTimeout(hideId);
      hideId = window.setTimeout(() => setShown(false), 2500);
    };
    window.addEventListener("pointermove", reveal);
    return () => {
      window.removeEventListener("pointermove", reveal);
      window.clearTimeout(hideId);
    };
  }, []);
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
  return (
    <button
      type="button"
      onClick={() => {
        void import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("open_window", { role: "multiview", options: null }))
          .catch((error: unknown) => console.error("[Stage] could not open Multiview", error));
      }}
      className={cn(
        "fixed right-5 top-5 z-50 flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-[15px] font-medium text-white ring-1 ring-white/20 backdrop-blur transition-opacity duration-300 hover:bg-black/85",
        shown ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <LayoutGrid className="h-4 w-4" aria-hidden />
      Open Multiview
    </button>
  );
}
