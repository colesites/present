"use client";

import {
  ResizablePanel,
} from "@/components";
import { ServicesSidebar } from "@/features/services";
import type { ComponentProps } from "react";

type Props = {
  servicesSidebarProps: ComponentProps<typeof ServicesSidebar>;
} & ComponentProps<typeof ResizablePanel>;

export function PresentServicesSidebar({
  servicesSidebarProps,
  ...panelProps
}: Props) {
  return (
    <ResizablePanel defaultSize={14} minSize={10} maxSize={25} {...panelProps}>
      <div className="h-full border-r border-border bg-card">
        <ServicesSidebar {...servicesSidebarProps} />
      </div>
    </ResizablePanel>
  );
}
