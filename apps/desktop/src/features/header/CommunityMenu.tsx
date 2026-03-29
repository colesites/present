"use client";

import { LayoutGrid, ChevronDown, Check, Globe, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../renderer/shared/components/ui/dropdown-menu";
import { cn } from "../../renderer/shared/lib/utils";
import type { ContentSource } from "../../shared/types";

interface CommunityMenuProps {
  source: ContentSource;
  onSourceChange: (source: ContentSource) => void;
  className?: string;
}

export function CommunityMenu({
  source,
  onSourceChange,
  className,
}: CommunityMenuProps) {
  const isCommunity = source === "community";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium transition hover:border-primary/50 hover:bg-accent",
            className
          )}
        >
          <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{isCommunity ? "Community" : "My Creations"}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem
          onClick={() => onSourceChange("community")}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5" />
            <span>Community</span>
          </div>
          {isCommunity && <Check className="h-3.5 w-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onSourceChange("my-creations")}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <User className="h-3.5 w-3.5" />
            <span>My Creations</span>
          </div>
          {!isCommunity && <Check className="h-3.5 w-3.5" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
