"use client";

import type { ScreenInfo } from "../../renderer/tauri/screens";
import { layoutForScreen, useStageLayouts } from "./layouts";
import { Fitted } from "./StageLayoutWindow";
import { useStageFeed } from "./useStageFeed";

/**
 * A stage screen as it looks: the layout Screen Configuration names for it,
 * drawn from what the stage is being sent, as its own window and Multiview
 * draw it.
 */
export function StageScreenPreview({ screen, className }: { screen: ScreenInfo; className?: string }) {
  const { layouts } = useStageLayouts();
  const feed = useStageFeed();
  const layout = layoutForScreen(layouts, screen);
  return (
    <div className={className} style={{ backgroundColor: screen.color ?? "#000" }}>
      {layout ? <Fitted layout={layout} feed={feed} /> : null}
    </div>
  );
}
