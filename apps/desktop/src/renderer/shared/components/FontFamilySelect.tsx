"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import { Check, ChevronDown, Loader2, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { useFontCatalog } from "../hooks/useFontCatalog";
import { cn } from "../lib/utils";

interface FontFamilySelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export const FontFamilySelect = memo(function FontFamilySelect({
  value,
  onChange,
  className,
}: FontFamilySelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isInstalling, setIsInstalling] = useState(false);
  const { families, loading, error, installCustomFonts } = useFontCatalog();

  const normalizedValue = value.trim();
  const orderedFamilies = useMemo(() => {
    const mergedFamilies = new Set(families);
    if (normalizedValue) {
      mergedFamilies.add(normalizedValue);
    }
    return Array.from(mergedFamilies).sort((left, right) =>
      left.localeCompare(right),
    );
  }, [families, normalizedValue]);

  const filteredFamilies = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      return orderedFamilies;
    }

    return orderedFamilies.filter((family) =>
      family.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [orderedFamilies, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !rootRef.current?.contains(target)) {
        setOpen(false);
        setQuery("");
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const timerId = window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [open]);

  const handleSelectFamily = (family: string) => {
    onChange(family);
    setOpen(false);
    setQuery("");
  };

  const handleInstallCustomFonts = async () => {
    setIsInstalling(true);
    await installCustomFonts(document)
      .then(() => {
        startTransition(() => {
          setOpen(true);
        });
      })
      .catch((error) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to load custom fonts.",
        );
      });
    setIsInstalling(false);
  };

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm text-foreground outline-none transition hover:border-primary/40 focus:ring-1 focus:ring-primary/40",
          open && "border-primary/50",
        )}
      >
        <span
          className="min-w-0 truncate"
          style={{ fontFamily: normalizedValue || undefined }}
        >
          {normalizedValue || "Select Font"}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 flex max-h-[28rem] w-[22rem] max-w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
          <div className="border-b border-border/70 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search fonts"
                className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleInstallCustomFonts()}
              disabled={isInstalling}
              className="mt-2 inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted/35 px-3 text-xs font-medium text-foreground transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isInstalling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Load Custom Font
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {loading ? (
              <div className="flex h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading system fonts...
              </div>
            ) : filteredFamilies.length === 0 ? (
              <div className="px-3 py-6 text-sm text-muted-foreground">
                No fonts match “{query.trim()}”.
              </div>
            ) : (
              <div className="max-h-[18rem] overflow-y-auto p-2">
                {filteredFamilies.map((family) => {
                  const isSelected = family === normalizedValue;
                  return (
                    <button
                      key={family}
                      type="button"
                      onClick={() => handleSelectFamily(family)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-accent hover:text-accent-foreground",
                        isSelected && "bg-accent/70 text-accent-foreground",
                      )}
                    >
                      <span
                        className="min-w-0 flex-1 truncate"
                        style={{ fontFamily: family }}
                      >
                        {family}
                      </span>
                      {isSelected ? (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}

            {error ? (
              <div className="border-t border-border/70 px-3 py-2 text-[11px] text-destructive">
                {error}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});
