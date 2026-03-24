"use client";

import { ResizablePanel } from "../../components";
import { OutputPreview } from "../../features/slides";
import type { ComponentProps } from "react";

type Props = {
  outputPreviewProps: ComponentProps<typeof OutputPreview>;
  order?: number;
} & ComponentProps<typeof ResizablePanel>;

export function PresentOutputSidebar({
  outputPreviewProps,
}: Props) {
  return (
    <div className="h-full border-l border-border bg-card">
      <OutputPreview {...outputPreviewProps} />
    </div>
  );
}
