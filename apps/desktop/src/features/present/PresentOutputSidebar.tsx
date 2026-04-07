"use client";

import { ResizablePanel } from "../../renderer/shared/components";
import { OutputPreview } from "../../features/slides";
import { memo, type ComponentProps } from "react";

type Props = {
  outputPreviewProps: ComponentProps<typeof OutputPreview>;
  order?: number;
} & ComponentProps<typeof ResizablePanel>;

export const PresentOutputSidebar = memo(function PresentOutputSidebar({
  outputPreviewProps,
}: Props) {
  return (
    <div className="h-full border-l border-border bg-card">
      <OutputPreview {...outputPreviewProps} />
    </div>
  );
});
