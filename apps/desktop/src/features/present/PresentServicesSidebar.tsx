"use client";

import { ResizablePanel } from "../../renderer/shared/components";
import { ServicesSidebar } from "../../features/services";
import { memo, type ComponentProps } from "react";

type Props = {
  servicesSidebarProps: ComponentProps<typeof ServicesSidebar>;
  order?: number;
} & ComponentProps<typeof ResizablePanel>;

export const PresentServicesSidebar = memo(function PresentServicesSidebar({
  servicesSidebarProps,
}: Props) {
  return (
    <div className="h-full min-h-0 overflow-hidden border-r border-border bg-card">
      <ServicesSidebar {...servicesSidebarProps} />
    </div>
  );
});
