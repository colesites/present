import type { DashboardLibraryItem, DashboardServiceItem, ServiceEntry } from "../types";

/**
 * A service's running order, as the desktop app's sidebar shows it.
 *
 * A service keeps its items in one list and its top-level order in `layout`:
 * groups (by id) and ungrouped items (by a key made of the item's type, ref,
 * time added and group). Items inside a group keep the list's order. Anything
 * the layout doesn't mention is placed where the list has it, which is what
 * `normalizeServiceLayout` does in the app.
 */

export type IndexedEntry = ServiceEntry & { index: number };

export type ServiceRow =
  | { kind: "group"; id: string; name: string; items: IndexedEntry[] }
  | { kind: "item"; item: IndexedEntry };

export const layoutKeyOf = (item: Pick<ServiceEntry, "type" | "refId" | "addedAt" | "groupId">) =>
  [item.type, item.refId, item.addedAt, item.groupId ?? "standalone"].join(":");

export function serviceRows(service: Pick<DashboardServiceItem, "items" | "groups" | "layout">): ServiceRow[] {
  const items = service.items.map((item, index) => ({ ...item, index })).filter((item) => item.type !== "group");
  const groups = [...(service.groups ?? [])].sort((a, b) => a.order - b.order);
  const groupIds = new Set(groups.map((group) => group.id));
  const isGrouped = (item: IndexedEntry) => Boolean(item.groupId && groupIds.has(item.groupId));
  const loose = new Map(items.filter((item) => !isGrouped(item)).map((item) => [layoutKeyOf(item), item]));

  const rows: ServiceRow[] = [];
  const seenGroups = new Set<string>();
  const seenItems = new Set<string>();
  const addGroup = (id: string) => {
    if (seenGroups.has(id)) return;
    seenGroups.add(id);
    const group = groups.find((each) => each.id === id);
    rows.push({
      kind: "group",
      id,
      name: group?.name ?? "Group",
      items: items.filter((item) => item.groupId === id),
    });
  };
  const addItem = (key: string) => {
    const item = loose.get(key);
    if (!item || seenItems.has(key)) return;
    seenItems.add(key);
    rows.push({ kind: "item", item });
  };

  for (const entry of service.layout ?? []) {
    if (entry.type === "group" && groupIds.has(entry.id)) addGroup(entry.id);
    if (entry.type === "item") addItem(entry.key);
  }
  for (const item of items) {
    if (isGrouped(item)) addGroup(item.groupId as string);
    else addItem(layoutKeyOf(item));
  }
  for (const group of groups) addGroup(group.id);
  return rows;
}

/** Every item, in running order, groups flattened. */
export const orderedEntries = (service: Pick<DashboardServiceItem, "items" | "groups" | "layout">) =>
  serviceRows(service).flatMap((row) => (row.kind === "group" ? row.items : [row.item]));

const KINDS: Record<string, string> = {
  library: "Song",
  scripture: "Scripture",
  media: "Media",
  presentation: "Presentation",
};

/** What an item is called, and what kind of thing it is. */
export const describeEntry = (item: ServiceEntry, libraryById: Map<string, DashboardLibraryItem>) => {
  const kind = KINDS[item.type] ?? "Item";
  if (item.type === "library") {
    const found = libraryById.get(item.refId);
    return { title: found?.title ?? item.label ?? "A song no longer in the library", kind, missing: !found };
  }
  if (item.type === "presentation") {
    return { title: item.presentation?.title ?? item.label ?? "Presentation", kind, missing: false };
  }
  return { title: item.label?.trim() || kind, kind, missing: false };
};
