"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { Library, Search } from "lucide-react";
import { api } from "../../../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../../../packages/backend/convex/_generated/dataModel";
import type { DashboardLibraryItem, DashboardOrganization } from "../types";
import { formatRelative } from "./format";
import { EmptyState, Page, PageHeader, SkeletonRows, cx, fieldClass } from "./ui";

/** The first line someone would recognise a song by. */
const firstLine = (item: DashboardLibraryItem) =>
  item.slides
    .map((slide) => slide.text?.split("\n").find((line) => line.trim() && !/^\[.*\]$/.test(line.trim())))
    .find(Boolean)
    ?.trim() ?? "";

/**
 * The workspace's songs and presentations, to find something from any
 * device. Editing is in the desktop app, where the slides are.
 */
export function LibrarySection({
  currentOrg,
  libraryItems,
}: {
  currentOrg: DashboardOrganization | null;
  libraryItems: DashboardLibraryItem[] | undefined;
}) {
  const { isAuthenticated } = useConvexAuth();
  const categories = useQuery(
    api.categories.listByOrg,
    isAuthenticated && currentOrg ? { orgId: currentOrg.id as Id<"organizations"> } : "skip",
  );
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const visible = useMemo(() => {
    if (!libraryItems) return null;
    const needle = query.trim().toLowerCase();
    return libraryItems.filter(
      (item) =>
        (!categoryId || item.categoryId === categoryId) &&
        (!needle ||
          item.title.toLowerCase().includes(needle) ||
          item.slides.some((slide) => slide.text?.toLowerCase().includes(needle))),
    );
  }, [categoryId, libraryItems, query]);

  const usedCategories = (categories ?? []).filter((category) =>
    libraryItems?.some((item) => item.categoryId === category._id),
  );

  return (
    <Page>
      <PageHeader
        eyebrow="Content"
        title="Library"
        description="Search your songs and presentations by title or lyric. Open the desktop app to edit them."
      />

      <div className="relative mt-8">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa3b2]" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search titles and lyrics"
          className={cx(fieldClass, "pl-10")}
          aria-label="Search the library"
        />
      </div>

      {usedCategories.length > 0 ? (
        <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {[{ _id: null, name: "All" }, ...usedCategories].map((category) => (
            <button
              key={category._id ?? "all"}
              type="button"
              onClick={() => setCategoryId(category._id)}
              className={cx(
                "h-9 flex-none rounded-full px-4 text-sm font-medium transition",
                categoryId === category._id
                  ? "bg-[#232946] text-white"
                  : "border border-[#e4e6ee] text-[#5b6478] hover:border-primary/40 hover:text-primary",
              )}
            >
              {category.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-6">
        {!visible ? (
          <SkeletonRows rows={6} height="h-[72px]" />
        ) : visible.length === 0 ? (
          <EmptyState icon={Library} title={libraryItems?.length ? "Nothing matches" : "The library is empty"}>
            {libraryItems?.length
              ? "Try another word, or another category."
              : "Songs and presentations added in the desktop app appear here."}
          </EmptyState>
        ) : (
          <>
            <p className="mb-2 text-sm text-[#9aa3b2]">
              {visible.length} {visible.length === 1 ? "item" : "items"}
            </p>
            <ul className="divide-y divide-[#f0f1f5] rounded-card border border-[#ececf2]">
              {visible.map((item) => (
                <li key={item._id} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-primary/10 text-primary">
                    <Library className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.title}</p>
                    <p className="truncate text-sm text-[#9aa3b2]">
                      {firstLine(item) || `${item.slides.length} ${item.slides.length === 1 ? "slide" : "slides"}`}
                    </p>
                  </div>
                  <div className="hidden flex-none text-right sm:block">
                    <p className="text-sm text-[#7d8798]">{formatRelative(item.updatedAt ?? item._creationTime)}</p>
                    <p className="text-xs text-[#9aa3b2]">
                      {item.slides.length} {item.slides.length === 1 ? "slide" : "slides"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Page>
  );
}
