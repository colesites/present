"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { Plus, Search } from "lucide-react";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../../../../packages/backend/convex/_generated/dataModel";
import { useDashboard } from "../DashboardShell";
import { formatRelative } from "../format";
import { firstLyric } from "../OverviewPage";
import { EmptyState, List, Page, PageHeader, SkeletonRows, buttonClass, cx, fieldClass } from "../ui";

/** The workspace's categories, for filtering and for a song's own. */
export const useCategories = () => {
  const { isAuthenticated } = useConvexAuth();
  const { currentOrg } = useDashboard();
  return useQuery(
    api.categories.listByOrg,
    isAuthenticated && currentOrg ? { orgId: currentOrg.id as Id<"organizations"> } : "skip",
  );
};

/** Songs and presentations, searchable by title or lyric, and a way in to write one. */
export function LibraryListPage() {
  const { libraryItems } = useDashboard();
  const categories = useCategories();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const categoryName = useMemo(
    () => new Map((categories ?? []).map((category) => [category._id as string, category.name])),
    [categories],
  );

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

  const used = (categories ?? []).filter((category) => libraryItems?.some((item) => item.categoryId === category._id));

  return (
    <Page wide>
      <PageHeader
        title="Library"
        description={
          libraryItems
            ? `${libraryItems.length} ${libraryItems.length === 1 ? "song" : "songs"} and presentations, the same as in the desktop app.`
            : "Songs and presentations, the same as in the desktop app."
        }
        actions={
          <Link href="/dashboard/library/new" className={buttonClass()}>
            <Plus className="h-4 w-4" /> New song
          </Link>
        }
      />

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {[{ _id: null as string | null, name: "All" }, ...used.map((category) => ({ _id: category._id as string, name: category.name }))].map((category) => (
            <button
              key={category._id ?? "all"}
              type="button"
              onClick={() => setCategoryId(category._id)}
              className={cx(
                "h-8 flex-none rounded-[8px] px-3 text-sm transition-colors",
                categoryId === category._id ? "bg-[#f1f2f6] font-medium text-[#1d2240]" : "text-[#6b7285] hover:text-[#1d2240]",
              )}
            >
              {category.name}
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa1b1]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles and lyrics"
            aria-label="Search the library"
            className={cx(fieldClass, "pl-9")}
          />
        </div>
      </div>

      <div className="mt-4">
        {!visible ? (
          <SkeletonRows rows={8} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={libraryItems?.length ? "Nothing matches" : "No songs yet"}
            action={
              libraryItems?.length ? null : (
                <Link href="/dashboard/library/new" className={buttonClass("outline", "sm")}>
                  Write the first one
                </Link>
              )
            }
          >
            {libraryItems?.length ? "Try another word, or another category." : "Songs you add here or in the desktop app appear in both."}
          </EmptyState>
        ) : (
          <List>
            {visible.map((item) => (
              <li key={item._id}>
                <Link
                  href={`/dashboard/library/${item._id}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 transition hover:bg-[#fafbfc] sm:grid-cols-[minmax(0,1fr)_8rem_7rem]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.title}</span>
                    <span className="block truncate text-sm text-[#9aa1b1]">
                      {firstLyric(item) || `${item.slides.length} ${item.slides.length === 1 ? "slide" : "slides"}`}
                    </span>
                  </span>
                  <span className="hidden truncate text-sm text-[#6b7285] sm:block">
                    {item.categoryId ? categoryName.get(item.categoryId) ?? "" : ""}
                  </span>
                  <span className="text-right text-sm text-[#9aa1b1]">{formatRelative(item.updatedAt ?? item._creationTime)}</span>
                </Link>
              </li>
            ))}
          </List>
        )}
      </div>
    </Page>
  );
}
