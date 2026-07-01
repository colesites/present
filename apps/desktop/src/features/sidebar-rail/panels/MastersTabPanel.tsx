"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Filter, LayoutGrid, LayoutList, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { cn } from "../../../renderer/shared/lib/utils";

interface MastersTabPanelProps {
  orgId: Id<"organizations"> | null;
  // Push a master to the live output. The presenter wires this to either an
  // explicit "set active slide" path or a service item insert; here we just
  // dispatch the master's payload upward.
  onPushSlide: (master: {
    name: string;
    color: string;
    body: string;
  }) => void;
}

type ConvexMaster = {
  _id: Id<"slideMasters">;
  name: string;
  color: string;
  body?: string;
  order: number;
};

const DEFAULT_COLORS = [
  "#dc2626",
  "#16a34a",
  "#7c1d6f",
  "#1d4ed8",
  "#7c3aed",
  "#4338ca",
  "#0891b2",
  "#0f172a",
];

export function MastersTabPanel({ orgId, onPushSlide }: MastersTabPanelProps) {
  const masters = useQuery(
    api.slideMasters.listByOrg,
    orgId ? { orgId } : "skip",
  ) as ConvexMaster[] | undefined;
  const createMaster = useMutation(api.slideMasters.create);
  const updateMaster = useMutation(api.slideMasters.update);
  const removeMaster = useMutation(api.slideMasters.remove);

  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"grid" | "list">("list");
  const [editingId, setEditingId] = useState<Id<"slideMasters"> | null>(null);

  const sorted = useMemo(() => {
    if (!masters) return [];
    const filtered = filter.trim()
      ? masters.filter((m) =>
          m.name.toLowerCase().includes(filter.toLowerCase()),
        )
      : masters;
    return [...filtered].sort((a, b) => a.order - b.order);
  }, [filter, masters]);

  const editing = useMemo(
    () => sorted.find((m) => m._id === editingId) ?? null,
    [editingId, sorted],
  );

  if (!orgId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[11px] text-muted-foreground">
        Join or select an organization to manage masters.
      </div>
    );
  }

  const handleCreate = async () => {
    const id = await createMaster({
      orgId,
      name: "New Master",
      color:
        DEFAULT_COLORS[
          ((masters?.length ?? 0) + Math.floor(Math.random() * 3)) %
            DEFAULT_COLORS.length
        ],
      body: "",
    });
    setEditingId(id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Collection header */}
      <header className="flex items-center justify-between px-3 py-2">
        <p className="text-[11px] font-medium text-foreground">
          Default Collection
        </p>
        <button
          type="button"
          onClick={handleCreate}
          className="rounded-sm p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          title="New master"
          aria-label="New master"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </header>

      {/* Tiles */}
      <div
        className={cn(
          "flex-1 overflow-y-auto px-2 pb-2",
          view === "grid"
            ? "grid grid-cols-2 gap-2"
            : "flex flex-col gap-1",
        )}
      >
        {sorted.length === 0 ? (
          <p className="col-span-2 px-2 py-6 text-center text-[11px] text-muted-foreground">
            Click + to create your first master.
          </p>
        ) : (
          sorted.map((master) =>
            view === "grid" ? (
              <MasterTile
                key={master._id}
                master={master}
                isEditing={editingId === master._id}
                onClick={() =>
                  onPushSlide({
                    name: master.name,
                    color: master.color,
                    body: master.body ?? "",
                  })
                }
                onEdit={() => setEditingId(master._id)}
              />
            ) : (
              <MasterRow
                key={master._id}
                master={master}
                isEditing={editingId === master._id}
                onClick={() =>
                  onPushSlide({
                    name: master.name,
                    color: master.color,
                    body: master.body ?? "",
                  })
                }
                onEdit={() => setEditingId(master._id)}
              />
            ),
          )
        )}
      </div>

      {/* Footer (filter + view toggle) */}
      <footer className="flex shrink-0 items-center gap-2 border-t border-border/70 px-2 py-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-sm border border-border/60 bg-background/40 px-2">
          <Filter className="h-3 w-3 text-muted-foreground" strokeWidth={1.6} />
          <input
            type="text"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter"
            className="h-7 flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/70 focus:outline-hidden"
          />
        </div>
        <button
          type="button"
          onClick={() => setView("grid")}
          className={cn(
            "rounded-sm p-1 transition",
            view === "grid"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
          )}
          title="Grid view"
        >
          <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => setView("list")}
          className={cn(
            "rounded-sm p-1 transition",
            view === "list"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
          )}
          title="List view"
        >
          <LayoutList className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </footer>

      {/* Edit drawer */}
      {editing && (
        <MasterEditDrawer
          key={editing._id}
          master={editing}
          onClose={() => setEditingId(null)}
          onUpdate={(patch) =>
            void updateMaster({ masterId: editing._id, ...patch })
          }
          onDelete={() =>
            void removeMaster({ masterId: editing._id }).then(() =>
              setEditingId(null),
            )
          }
        />
      )}
    </div>
  );
}

function MasterTile({
  master,
  isEditing,
  onClick,
  onEdit,
}: {
  master: ConvexMaster;
  isEditing: boolean;
  onClick: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col items-center gap-1.5 rounded-sm p-2 transition",
        isEditing ? "bg-foreground/10" : "hover:bg-foreground/5",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={onEdit}
        className="relative h-16 w-full overflow-hidden rounded-sm border border-border/40 transition group-hover:border-foreground/40"
        style={{ background: master.color }}
        aria-label={`Show master ${master.name}`}
      >
        <span className="absolute inset-0 flex items-center justify-center font-bold text-white drop-shadow-lg">
          M
        </span>
      </button>
      <p className="line-clamp-1 w-full text-center text-[11px] font-medium text-foreground">
        {master.name}
      </p>
    </div>
  );
}

function MasterRow({
  master,
  isEditing,
  onClick,
  onEdit,
}: {
  master: ConvexMaster;
  isEditing: boolean;
  onClick: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-sm px-1.5 py-1.5 transition",
        isEditing ? "bg-foreground/10" : "hover:bg-foreground/5",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={onEdit}
        className="relative h-8 w-8 shrink-0 overflow-hidden rounded-sm border border-border/40"
        style={{ background: master.color }}
        aria-label={`Show master ${master.name}`}
      >
        <span className="absolute inset-0 flex items-center justify-center font-bold text-white drop-shadow-md">
          M
        </span>
      </button>
      <span className="flex-1 truncate text-[12px] text-foreground">
        {master.name}
      </span>
      <button
        type="button"
        onClick={onEdit}
        className="rounded-sm p-1 text-muted-foreground opacity-0 transition hover:bg-foreground/5 hover:text-foreground group-hover:opacity-100"
        title="Edit"
        aria-label="Edit master"
      >
        <Pencil className="h-3 w-3" strokeWidth={1.6} />
      </button>
    </div>
  );
}

function MasterEditDrawer({
  master,
  onClose,
  onUpdate,
  onDelete,
}: {
  master: ConvexMaster;
  onClose: () => void;
  onUpdate: (patch: { name?: string; color?: string; body?: string }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(master.name);
  const [color, setColor] = useState(master.color);
  const [body, setBody] = useState(master.body ?? "");

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 max-h-[70%] overflow-y-auto border-t border-border/70 bg-card p-3 shadow-2xl">
      <header className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Edit master
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          Done
        </button>
      </header>
      <div className="space-y-2">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => onUpdate({ name })}
          className="w-full rounded-sm border border-border/70 bg-background/40 px-2 py-1.5 text-[12px] text-foreground focus:border-primary/60 focus:outline-hidden"
        />
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onBlur={() => onUpdate({ body })}
          placeholder="Optional body text shown on the slide"
          className="min-h-[60px] w-full resize-y rounded-sm border border-border/70 bg-background/40 px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary/60 focus:outline-hidden"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Color:
          </span>
          {DEFAULT_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => {
                setColor(swatch);
                onUpdate({ color: swatch });
              }}
              aria-pressed={color === swatch}
              className={cn(
                "h-5 w-5 rounded-sm border transition",
                color === swatch
                  ? "border-foreground"
                  : "border-border/60 hover:border-foreground/40",
              )}
              style={{ background: swatch }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(event) => {
              setColor(event.target.value);
              onUpdate({ color: event.target.value });
            }}
            className="h-5 w-7 cursor-pointer rounded-sm border border-border/60 bg-transparent"
            title="Custom color"
          />
        </div>
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1.5 rounded-sm border border-border/70 bg-background/40 px-2 py-1 text-[10px] text-muted-foreground hover:border-red-500/60 hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.6} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
