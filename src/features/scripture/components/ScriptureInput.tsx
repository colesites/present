"use client";

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { 
  getSuggestions, 
  getSmartTransform, 
  type Suggestion 
} from "../lib/autocomplete";
import { parseReference, isValidCharacter } from "../lib/parser";
import { cn } from "@/lib/utils";
import { AlertCircle, Search, X } from "lucide-react";

import { db, type BibleBookRecord, type BibleVersion } from "../lib/db";

interface ScriptureInputProps {
  onRefChange: (ref: ReturnType<typeof parseReference>) => void;
  availableBooks: BibleBookRecord[];
  availableVersions: BibleVersion[];
  className?: string;
  placeholder?: string;
  onEnter?: (value?: string) => void;
}

export const ScriptureInput = forwardRef<HTMLInputElement, ScriptureInputProps>(
  function ScriptureInput(
    {
      onRefChange,
      availableBooks,
      availableVersions,
      className,
      placeholder = "Search Bible... (John 3:16)",
      onEnter,
    },
    ref,
  ) {
    const [value, setValue] = useState("");
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [showDropdown, setShowDropdown] = useState(false);

    // Use the forwarded ref if provided, or fallback to internal ref
    const internalInputRef = useRef<HTMLInputElement>(null);
    // We need to combine them if we want to use it internally too, or just expect parent to handle focus
    // Simplest is to just use standard imperative handle or just assign to the input if simple.
    // Actually, standard pattern:
    const dropdownRef = useRef<HTMLDivElement>(null);

    const parsed = useMemo(
      () => parseReference(value, availableBooks),
      [value, availableBooks],
    );

    // Use a ref to track the last emitted value to prevent infinite loops
    // caused by availableBooks array reference changes
    const lastParsedJson = useRef("");

    useEffect(() => {
      // Basic circular reference handling not needed for POJOs from Dexie
      const json = JSON.stringify(parsed);
      if (json !== lastParsedJson.current) {
        lastParsedJson.current = json;
        onRefChange(parsed);
      }
    }, [parsed, onRefChange]);

    const updateSuggestions = async (val: string) => {
      const suggs = await getSuggestions(
        val,
        availableBooks,
        availableVersions,
      );
      setSuggestions(suggs);
      setSelectedIndex(0);
      setShowDropdown(suggs.length > 0);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          if (showDropdown) {
            e.preventDefault();
            setSelectedIndex((prev) => (prev + 1) % suggestions.length);
          }
          break;
        case "ArrowUp":
          if (showDropdown) {
            e.preventDefault();
            setSelectedIndex(
              (prev) => (prev - 1 + suggestions.length) % suggestions.length,
            );
          }
          break;
        case "Enter":
          e.preventDefault();
          if (showDropdown && suggestions[selectedIndex]) {
            const selectedText = suggestions[selectedIndex].text;
            // Always submit on Enter, applying suggestion if needed
            if (selectedText.toLowerCase() !== value.trim().toLowerCase()) {
              applySuggestion(suggestions[selectedIndex]);
            }
            onEnter?.(selectedText);
            internalInputRef.current?.blur();
            setShowDropdown(false);
          } else {
            // Submit current value if no dropdown or no selection
            onEnter?.(value);
            internalInputRef.current?.blur();
          }
          break;
        case "Tab":
          if (showDropdown && suggestions[selectedIndex]) {
            e.preventDefault();
            applySuggestion(suggestions[selectedIndex]);
          }
          break;
        case "Escape":
          setShowDropdown(false);
          break;
      }
    };

    const applySuggestion = (s: Suggestion) => {
      setValue(s.text);
      setShowDropdown(false);
      updateSuggestions(s.text);
      // Focus logic needs to handle the ref. Assuming parent manages focus or user is typing.
      // If we need to force focus back:
      if (internalInputRef.current) {
        internalInputRef.current.focus();
      }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawNewVal = e.target.value;
      const oldVal = value;

      // Allow deletion without strict checks (always safe to delete)
      if (rawNewVal.length < oldVal.length) {
        setValue(rawNewVal);
        updateSuggestions(rawNewVal);
        return;
      }

      // 1. Smart Transform (e.g. "1jn" -> "1 John")
      // We apply this first so we validate the *intended* output
      const transformedVal = getSmartTransform(rawNewVal);

      // 2. Strict Validation
      // We need to parse the input into logical parts to validate them
      // Regex to capture: [Book] [Chapter]:[Verse] [Version]
      // But since we are typing, we might have partials.
      // Strategy: Split by space, but handle "1 John" correctly.

      const parts = transformedVal.trimStart().split(/\s+/);
      const isIntroNum = /^[1-3]$/.test(parts[0]);

      // A. Validate Book Part
      let bookPart = parts[0];
      let remainingParts = parts.slice(1);

      if (isIntroNum && parts.length > 1) {
        bookPart = `${parts[0]} ${parts[1]}`;
        remainingParts = parts.slice(2);
      } else if (isIntroNum && parts.length === 1) {
        // Just "1", valid start
        bookPart = parts[0];
        remainingParts = [];
      }

      // Check if bookPart is a valid prefix of ANY book
      const cleanBookSearch = bookPart.toLowerCase();
      // Optimization: Cache this if slow, but simple filter is fast enough for <100 books
      const matchingBooks = availableBooks.filter(
        (b) =>
          b.name.toLowerCase().startsWith(cleanBookSearch) ||
          b.id.toLowerCase().startsWith(cleanBookSearch) ||
          b.abbreviation?.toLowerCase().startsWith(cleanBookSearch),
      );

      // Special case: "1" matches "1 John", "1 Peter", etc.
      // If no matches, input is invalid.
      if (matchingBooks.length === 0) return; // BLOCK INPUT

      // B. Validate Numbers (Chapter/Verse)
      // If we have remaining parts, it implies we are past the book name.
      // If `remainingParts` exists, user typed a space after book.
      // We must ensure the book part matches a book EXACTLY or is a valid alias.
      // Actually, if user types "Mat ", match is "Matthew".
      // If user typed "Mat 6", `bookPart` is "Mat". `remainingParts` is ["6"].
      // Is "Mat" a valid book? No, it's an abbreviation.
      // If strict mode, does user HAVE to finish "Matthew"? Or does "Mat 6" work?
      // User said "input should not be able to type anything that is not a book".
      // "Mat" is not a book. "Matthew" is.
      // But standard fuzzy search allows "Mat".
      // Let's assume strictness applies to INVALID chars. "Mat" is valid prefix.
      // BUT if they type space "Mat ", they are signalling end of book.
      // Does "Mat" resolve to a book? Yes, via regex/parser.
      // My parser resolves "Mat" to "Matthew".
      // So checks:

      if (
        remainingParts.length > 0 ||
        (transformedVal.endsWith(" ") && !isIntroNum && parts.length === 1)
      ) {
        // User signaled end of book.
        // Does `bookPart` resolve to a single book?
        // Note: `matchingBooks` might be ["Matthew", "Mark"] if I typed "Ma ".
        // Wait, "Ma " -> "Ma" matches both.
        // But usually autocomplete would catch this.
        // If I type "Ma 6". parser might fail or default to first?
        // Let's just validate that `bookPart` leads to valid books.
        // Use the parser's logic for book resolution to be consistent.
        // Or just rely on matchingBooks > 0.

        // Chapter Validation
        // If we have a chapter part...
        const refPart = remainingParts[0]; // "6" or "6:2"
        if (refPart) {
          const [chapterStr, verseStr] = refPart.split(":");

          // Check Chapter
          if (chapterStr && /^\d+$/.test(chapterStr)) {
            const ch = parseInt(chapterStr, 10);
            // We need the resolved book to check max chapters.
            // We take the best match from `matchingBooks`.
            // Ideally we find Exact Match or Best Match.
            // Simplification: Check against the MAX chapters of ANY matching book.
            // e.g. "Ma 28". Matthew has 28. Mark has 16. Valid.
            // "Ma 50". Matthew 28. Valid? No.
            const maxChaptersPossible = Math.max(
              ...matchingBooks.map((b) => b.chapters),
            );
            if (ch > maxChaptersPossible) return; // BLOCK
            if (ch === 0 && chapterStr.length === 1) return; // No chapter 0
          } else if (chapterStr && !/^\d*$/.test(chapterStr)) {
            return; // Block non-digits in chapter
          }

          // Check Verse
          if (verseStr !== undefined) {
            // Allow digits and dash for ranges
            if (!/^[\d-]*$/.test(verseStr)) return;
          }
        }
      }

      // C. Validate Version
      // If we have more parts or trailing space after ref
      if (
        remainingParts.length >= 2 ||
        (remainingParts.length >= 1 && transformedVal.endsWith(" "))
      ) {
        // Version is the last part
        const versionPart = remainingParts[remainingParts.length - 1];
        if (versionPart) {
          const cleanVer = versionPart.toLowerCase();
          const hasVerMatch = availableVersions.some((v) =>
            v.code.toLowerCase().startsWith(cleanVer),
          );
          if (!hasVerMatch) return; // BLOCK
        }
      }

      // D. Last Character Check (General safety)
      // Allow letters, numbers, space, colon, dash.
      if (!/^[A-Za-z0-9\s:.-]*$/.test(transformedVal)) return;

      // Logic from Step 637 preserved (Inline Autocomplete)
      if (transformedVal.length > oldVal.length) {
        const isBookTypingDone =
          (isIntroNum && parts.length > 2) || (!isIntroNum && parts.length > 1);
        if (!isBookTypingDone) {
          if (matchingBooks.length > 0) {
            const uniqueNames = new Set(matchingBooks.map((b) => b.name));
            if (uniqueNames.size === 1) {
              const matchedBookName = matchingBooks[0].name;
              const completedValue =
                matchedBookName + (transformedVal.endsWith(" ") ? " " : " ");
              if (completedValue.length > transformedVal.length) {
                setValue(completedValue);
                updateSuggestions(completedValue);
                return;
              }
            }
          }
        }
      }

      setValue(transformedVal);
      updateSuggestions(transformedVal);
    };

    // Expose methods to the parent
    useImperativeHandle(
      ref,
      () =>
        ({
          ...internalInputRef.current,
          focus: () => internalInputRef.current?.focus(),
          setValue: (val: string) => {
            setValue(val);
            updateSuggestions(val);
          },
        }) as any,
    );

    return (
      <div className={cn("relative", className)}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
          <Input
            ref={internalInputRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => updateSuggestions(value)}
            placeholder={placeholder}
            className={cn(
              "pl-9 pr-8 h-8 text-xs bg-background/50 border-muted-foreground/20 focus-visible:ring-1 focus-visible:ring-primary/40",
              parsed.errors.length > 0 &&
                value.includes(" ") &&
                "border-destructive/50 focus-visible:ring-destructive/30",
            )}
          />
          {value && (
            <button
              onClick={() => {
                setValue("");
                updateSuggestions("");
                internalInputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {/* Dropdown removed as per user request */}
        </div>
      </div>
    );
  },
);
