"use client";

import { ResizablePanel } from "../../renderer/shared/components";
import { ServicesSidebar } from "../../features/services";
import type { ComponentProps } from "react";

type Props = {
  servicesSidebarProps: ComponentProps<typeof ServicesSidebar>;
  order?: number;
} & ComponentProps<typeof ResizablePanel>;

export function PresentServicesSidebar({
  servicesSidebarProps,
}: Props) {
  return (
    <div className="h-full border-r border-border bg-card">
      <ServicesSidebar {...servicesSidebarProps} />
    </div>
  );
}
