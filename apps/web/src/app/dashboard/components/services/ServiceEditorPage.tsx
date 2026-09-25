"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronLeft, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import type { DashboardLibraryItem, ServiceLayoutEntry } from "../../types";
import { useDashboard } from "../DashboardShell";
import { firstLyric } from "../OverviewPage";
import { describeEntry, layoutKeyOf, serviceRows, type IndexedEntry, type ServiceRow } from "../service-order";
import { Button, Card, Dialog, EmptyState, Notice, Page, Skeleton, cx, fieldClass, friendlyError } from "../ui";
import { NewServiceDialog } from "./ServicesListPage";

/** The layout a service's rows spell out, so every row has its place written down. */
const layoutOf = (rows: ServiceRow[]): ServiceLayoutEntry[] =>
  rows.map((row) => (row.kind === "group" ? { type: "group", id: row.id } : { type: "item", key: layoutKeyOf(row.item) }));

const sameLayout = (a: ServiceLayoutEntry[] | undefined, b: ServiceLayoutEntry[]) =>
  JSON.stringify(a ?? []) === JSON.stringify(b);

const newGroupId = () =>
  `group_${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

/**
 * One service: its name and date, and its running order to rearrange, add
 * songs to and take things out of. Writes go through the same Convex
 * functions the desktop app syncs with, so the app picks them up.
 *
 * Songs come from the library. Scripture and media are added in the app,
 * where the Bibles and the media files are, and shown here as they are.
 */
export function ServiceEditorPage({ serviceId }: { serviceId: string }) {
  const router = useRouter();
  const { services, libraryItems, workspaceId, openDesktopApp } = useDashboard();
  const service = services?.find((each) => each._id === serviceId) ?? null;

  const update = useMutation(api.services.update);
  const addItem = useMutation(api.services.addItem);
  const removeItem = useMutation(api.services.removeItem);
  const reorderItems = useMutation(api.services.reorderItems);
  const removeService = useMutation(api.services.remove);

  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ groupId: string | null } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [busy, setBusy] = useState(false);

  const libraryById = useMemo(() => new Map((libraryItems ?? []).map((item) => [item._id, item])), [libraryItems]);
  const rows = useMemo(() => (service ? serviceRows(service) : []), [service]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  if (!services) {
    return (
      <Page>
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-4 h-8 w-72" />
        <Skeleton className="mt-8 h-64 w-full rounded-card" />
      </Page>
    );
  }
  if (!service || !workspaceId) {
    return (
      <Page>
        <EmptyState
          title="This service isn't here"
          action={
            <Link href="/dashboard/services" className="text-sm font-medium text-primary hover:underline">
              Back to services
            </Link>
          }
        >
          It may have been deleted, or it belongs to another organization.
        </EmptyState>
      </Page>
    );
  }

  const run = async (change: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await change();
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setBusy(false);
    }
  };

  const base = { workspaceId, serviceId: service._id };

  // A service can have a partial layout, or none; the app fills the gaps from
  // the item list. Writing the whole thing first keeps new items where they
  // are put instead of wherever the gaps would put them.
  const settleLayout = async () => {
    const layout = layoutOf(rows);
    if (!sameLayout(service.layout, layout)) await update({ ...base, layout });
  };

  const moveRow = (position: number, by: -1 | 1) =>
    run(async () => {
      const target = position + by;
      if (target < 0 || target >= rows.length) return;
      const next = [...rows];
      [next[position], next[target]] = [next[target], next[position]];
      await update({ ...base, layout: layoutOf(next) });
    });

  const moveWithinGroup = (items: IndexedEntry[], position: number, by: -1 | 1) =>
    run(async () => {
      const neighbour = items[position + by];
      if (!neighbour) return;
      await reorderItems({ ...base, fromIndex: items[position].index, toIndex: neighbour.index });
    });

  const remove = (entry: IndexedEntry) => run(() => removeItem({ ...base, itemIndex: entry.index }));

  const addSong = (song: DashboardLibraryItem, groupId: string | null) =>
    run(async () => {
      await settleLayout();
      await addItem({ ...base, type: "library", refId: song._id, label: song.title, groupId });
    });

  const addSection = () =>
    run(async () => {
      const groups = service.groups ?? [];
      const id = newGroupId();
      const name = `Section ${groups.length + 1}`;
      await update({
        ...base,
        groups: [...groups, { id, name, order: groups.length }],
        layout: [...layoutOf(rows), { type: "group", id }],
      });
    });

  const renameSection = (id: string, name: string) =>
    run(() =>
      update({
        ...base,
        groups: (service.groups ?? []).map((group) => (group.id === id ? { ...group, name: name.trim() || group.name } : group)),
      }),
    );

  const removeSection = (id: string) =>
    run(() =>
      update({
        ...base,
        groups: (service.groups ?? []).filter((group) => group.id !== id),
        layout: layoutOf(rows.filter((row) => !(row.kind === "group" && row.id === id))),
      }),
    );

  const setArchived = (archived: boolean) => run(() => update({ ...base, archivedAt: archived ? Date.now() : null }));

  const deleteService = async () => {
    setBusy(true);
    try {
      await removeService(base);
      router.replace("/dashboard/services");
    } catch (failure) {
      setError(friendlyError(failure));
      setBusy(false);
    }
  };

  // Where each row's numbering starts: items count through the sections.
  const numbered: Array<{ row: ServiceRow; start: number }> = [];
  let number = 0;
  for (const row of rows) {
    numbered.push({ row, start: number });
    number += row.kind === "group" ? row.items.length : 1;
  }

  return (
    <Page>
      <Link href="/dashboard/services" className="inline-flex items-center gap-1 text-sm text-[#6b7285] hover:text-[#1d2240]">
        <ChevronLeft className="h-4 w-4" /> Services
      </Link>

      <div className="mt-3 flex flex-col gap-4 border-b border-[#eceef3] pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <InlineText
            key={service._id + service.name}
            value={service.name}
            onSave={(name) => run(() => update({ ...base, name }))}
            className="text-[1.6rem] font-semibold tracking-[-0.03em] sm:text-[1.85rem]"
            label="Service name"
          />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[#6b7285]">
            <input
              type="date"
              value={service.date ?? ""}
              onChange={(event) => void run(() => update({ ...base, date: event.target.value }))}
              aria-label="Service date"
              className="h-8 rounded-[8px] border border-[#dfe2ea] bg-white px-2 text-sm text-[#1d2240] outline-none focus:border-primary/60"
            />
            <span>
              {number} {number === 1 ? "item" : "items"}
            </span>
            {service.archivedAt ? <span className="rounded-[6px] bg-[#f1f2f6] px-2 py-0.5 text-xs text-[#6b7285]">Archived</span> : null}
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Button variant="outline" onClick={openDesktopApp}>
            Open in app <ArrowUpRight className="h-4 w-4" />
          </Button>
          <div className="relative">
            <Button
              variant="ghost"
              aria-label="More"
              aria-expanded={menuOpen}
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((open) => !open);
              }}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
            {menuOpen ? (
              <div className="absolute right-0 top-11 z-20 w-48 rounded-[10px] border border-[#e7e9ef] bg-white p-1 shadow-[0_12px_32px_rgba(20,24,50,0.12)]">
                <MenuButton onClick={() => setDuplicating(true)}>Duplicate</MenuButton>
                <MenuButton onClick={() => void setArchived(!service.archivedAt)}>{service.archivedAt ? "Restore" : "Archive"}</MenuButton>
                <MenuButton danger onClick={() => setConfirmDelete(true)}>
                  Delete
                </MenuButton>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <Notice kind="error">{error}</Notice>
        </div>
      ) : null}

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Running order</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void addSection()} disabled={busy}>
              Add section
            </Button>
            <Button size="sm" onClick={() => setPicker({ groupId: null })}>
              <Plus className="h-4 w-4" /> Add song
            </Button>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="Nothing in this service yet"
            action={
              <Button size="sm" variant="outline" onClick={() => setPicker({ groupId: null })}>
                Add a song
              </Button>
            }
          >
            Add songs from your library. Scripture and media are added in the desktop app.
          </EmptyState>
        ) : (
          <Card padded={false} className={cx(busy && "opacity-80")}>
            <ol className="divide-y divide-[#eff0f4]">
              {numbered.map(({ row, start }, position) =>
                row.kind === "group" ? (
                  <li key={`g:${row.id}`} className="bg-[#fafbfc]">
                    <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
                      <InlineText
                        key={row.id + row.name}
                        value={row.name}
                        onSave={(name) => renameSection(row.id, name)}
                        className="text-sm font-semibold"
                        label="Section name"
                      />
                      <span className="text-xs text-[#9aa1b1]">{row.items.length}</span>
                      <span className="ml-auto flex items-center">
                        <IconButton label="Add a song to this section" onClick={() => setPicker({ groupId: row.id })}>
                          <Plus className="h-4 w-4" />
                        </IconButton>
                        <MoveButtons disabled={busy} canUp={position > 0} canDown={position < rows.length - 1} onMove={(by) => void moveRow(position, by)} />
                        {row.items.length === 0 ? (
                          <IconButton label="Remove this section" onClick={() => void removeSection(row.id)}>
                            <X className="h-4 w-4" />
                          </IconButton>
                        ) : null}
                      </span>
                    </div>
                    {row.items.length > 0 ? (
                      <ol className="divide-y divide-[#eff0f4] border-t border-[#eff0f4] bg-white">
                        {row.items.map((entry, inner) => (
                          <EntryRow
                            key={entry.index}
                            entry={entry}
                            number={start + inner + 1}
                            libraryById={libraryById}
                            indent
                            disabled={busy}
                            canUp={inner > 0}
                            canDown={inner < row.items.length - 1}
                            onMove={(by) => void moveWithinGroup(row.items, inner, by)}
                            onRemove={() => void remove(entry)}
                          />
                        ))}
                      </ol>
                    ) : null}
                  </li>
                ) : (
                  <EntryRow
                    key={`i:${row.item.index}`}
                    entry={row.item}
                    number={start + 1}
                    libraryById={libraryById}
                    disabled={busy}
                    canUp={position > 0}
                    canDown={position < rows.length - 1}
                    onMove={(by) => void moveRow(position, by)}
                    onRemove={() => void remove(row.item)}
                  />
                ),
              )}
            </ol>
          </Card>
        )}
      </section>

      <SongPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        library={libraryItems ?? []}
        inService={new Set(service.items.filter((item) => item.type === "library").map((item) => item.refId))}
        sectionName={picker?.groupId ? (service.groups ?? []).find((group) => group.id === picker.groupId)?.name ?? null : null}
        onAdd={(song) => addSong(song, picker?.groupId ?? null)}
      />

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${service.name}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void deleteService()} busy={busy}>
              Delete service
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-[#6b7285]">
          It goes from everyone&apos;s app. The songs in it stay in the library. To keep it out of the way instead, archive it.
        </p>
      </Dialog>

      <NewServiceDialog open={duplicating} onClose={() => setDuplicating(false)} services={services} copyFrom={service._id} />
    </Page>
  );
}

function EntryRow({
  entry,
  number,
  libraryById,
  indent = false,
  disabled,
  canUp,
  canDown,
  onMove,
  onRemove,
}: {
  entry: IndexedEntry;
  number: number;
  libraryById: Map<string, DashboardLibraryItem>;
  indent?: boolean;
  disabled: boolean;
  canUp: boolean;
  canDown: boolean;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const described = describeEntry(entry, libraryById);
  const song = entry.type === "library" ? libraryById.get(entry.refId) : undefined;
  return (
    <li className={cx("group flex items-center gap-3 px-3 py-2.5 sm:px-4", indent && "sm:pl-8")}>
      <span className="w-6 flex-none text-right text-sm tabular-nums text-[#9aa1b1]">{number}</span>
      <div className="min-w-0 flex-1">
        {song ? (
          <Link href={`/dashboard/library/${song._id}`} className="block truncate text-[0.95rem] font-medium hover:text-primary">
            {described.title}
          </Link>
        ) : (
          <p className={cx("truncate text-[0.95rem]", described.missing ? "text-[#9aa1b1]" : "font-medium")}>{described.title}</p>
        )}
        {song && firstLyric(song) ? <p className="truncate text-[0.8rem] text-[#9aa1b1]">{firstLyric(song)}</p> : null}
      </div>
      <span className="hidden flex-none text-[0.8rem] text-[#9aa1b1] sm:block">{described.kind}</span>
      <span className="flex flex-none items-center opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        <MoveButtons disabled={disabled} canUp={canUp} canDown={canDown} onMove={onMove} />
        <IconButton label={`Remove ${described.title}`} onClick={onRemove} disabled={disabled}>
          <X className="h-4 w-4" />
        </IconButton>
      </span>
    </li>
  );
}

function MoveButtons({
  disabled,
  canUp,
  canDown,
  onMove,
}: {
  disabled: boolean;
  canUp: boolean;
  canDown: boolean;
  onMove: (by: -1 | 1) => void;
}) {
  return (
    <>
      <IconButton label="Move up" onClick={() => onMove(-1)} disabled={disabled || !canUp}>
        <ArrowUp className="h-4 w-4" />
      </IconButton>
      <IconButton label="Move down" onClick={() => onMove(1)} disabled={disabled || !canDown}>
        <ArrowDown className="h-4 w-4" />
      </IconButton>
    </>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[#9aa1b1] transition hover:bg-[#f1f2f6] hover:text-[#1d2240] disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function MenuButton({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "w-full rounded-[7px] px-3 py-2 text-left text-sm transition",
        danger ? "text-red-600 hover:bg-red-50" : "hover:bg-[#f5f6f9]",
      )}
    >
      {children}
    </button>
  );
}

/** Text that reads as text and turns into a field when clicked. */
function InlineText({
  value,
  onSave,
  className,
  label,
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
  };

  return editing ? (
    <input
      ref={inputRef}
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className={cx("w-full min-w-0 rounded-[8px] border border-primary/40 bg-white px-1.5 outline-none ring-[3px] ring-primary/10", className)}
    />
  ) : (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={`Rename`}
      className={cx("-mx-1.5 min-w-0 truncate rounded-[8px] px-1.5 text-left transition hover:bg-[#f1f2f6]", className)}
    >
      {value}
    </button>
  );
}

function SongPicker({
  open,
  onClose,
  library,
  inService,
  sectionName,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  library: DashboardLibraryItem[];
  inService: Set<string>;
  sectionName: string | null;
  onAdd: (song: DashboardLibraryItem) => Promise<void>;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={sectionName ? `Add to ${sectionName}` : "Add a song"}
      footer={
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
      }
    >
      {open ? <SongSearch library={library} inService={inService} onAdd={onAdd} /> : null}
    </Dialog>
  );
}

function SongSearch({
  library,
  inService,
  onAdd,
}: {
  library: DashboardLibraryItem[];
  inService: Set<string>;
  onAdd: (song: DashboardLibraryItem) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<Set<string>>(() => new Set());

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return library
      .filter(
        (item) =>
          !needle ||
          item.title.toLowerCase().includes(needle) ||
          item.slides.some((slide) => slide.text?.toLowerCase().includes(needle)),
      )
      .slice(0, 60);
  }, [library, query]);

  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa1b1]" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search titles and lyrics"
          aria-label="Search the library"
          className={cx(fieldClass, "pl-9")}
          autoFocus
        />
      </div>
      <ul className="-mx-2 mt-3 max-h-[50vh] overflow-y-auto">
        {results.length === 0 ? (
          <li className="px-2 py-6 text-center text-sm text-[#6b7285]">
            {library.length === 0 ? "The library is empty. Add songs in Library first." : "No songs match."}
          </li>
        ) : (
          results.map((song) => {
            const isAdded = added.has(song._id);
            return (
              <li key={song._id}>
                <button
                  type="button"
                  onClick={async () => {
                    await onAdd(song);
                    setAdded((current) => new Set(current).add(song._id));
                  }}
                  className="flex w-full items-center gap-3 rounded-[8px] px-2 py-2 text-left transition hover:bg-[#f5f6f9]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{song.title}</span>
                    <span className="block truncate text-[0.8rem] text-[#9aa1b1]">
                      {inService.has(song._id) && !isAdded ? "Already in this service" : firstLyric(song) || `${song.slides.length} slides`}
                    </span>
                  </span>
                  {isAdded ? <Check className="h-4 w-4 flex-none text-emerald-600" /> : <Plus className="h-4 w-4 flex-none text-[#9aa1b1]" />}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </>
  );
}
