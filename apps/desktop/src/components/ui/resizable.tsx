import React, { createContext, useContext } from "react";
import { GripVerticalIcon } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "../../lib/utils";

const ResizableContext = createContext<{ direction: "horizontal" | "vertical" }>({
  direction: "horizontal",
});

function ResizablePanelGroup({
  className,
  direction = "horizontal",
  autoSaveId,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group> & {
  direction?: "horizontal" | "vertical";
  autoSaveId?: string;
}) {
  return (
    <ResizableContext.Provider value={{ direction }}>
      <ResizablePrimitive.Group
        className={cn(
          "flex h-full w-full",
          direction === "vertical" ? "flex-col" : "flex-row",
          className,
        )}
        orientation={direction}
        id={autoSaveId}
        {...props}
      />
    </ResizableContext.Provider>
  );
}

function ResizablePanel({
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel> & {
  order?: number;
}) {
  return <ResizablePrimitive.Panel {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean;
}) {
  const { direction } = useContext(ResizableContext);
  const isVertical = direction === "vertical";

  return (
    <ResizablePrimitive.Separator
      className={cn(
        "relative flex items-center justify-center bg-transparent transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
        isVertical ? "h-2 w-full cursor-row-resize" : "w-2 h-full cursor-col-resize",
        className,
      )}
      {...props}
    >
      <div className={cn("bg-border", isVertical ? "h-px w-full" : "w-px h-full")} />
      {withHandle && (
        <div className={cn(
          "absolute z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border shadow-sm",
          isVertical && "rotate-90"
        )}>
          <GripVerticalIcon className="h-2.5 w-2.5" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
