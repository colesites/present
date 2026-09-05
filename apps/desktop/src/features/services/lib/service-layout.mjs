/**
 * Pure helpers for rearranging a service's top-level layout — the ordered list
 * of group and standalone-item rows shown in the services sidebar.
 *
 * A service owns its layout outright, so reordering here never touches the
 * template the service was created from.
 */

/**
 * Moves a group row within a layout. `toLayoutIndex` uses drop-line semantics:
 * the group lands before the row currently sitting at that index.
 *
 * Returns null when the group is not in the layout or the move is a no-op, so
 * callers can skip writing an identical service back.
 */
export function moveLayoutGroup(layout, groupId, toLayoutIndex) {
  if (!Array.isArray(layout) || !Number.isFinite(toLayoutIndex)) {
    return null;
  }

  const fromIndex = layout.findIndex(
    (entry) => entry?.type === "group" && entry.id === groupId,
  );
  if (fromIndex < 0) {
    return null;
  }

  const bounded = Math.max(0, Math.min(layout.length, toLayoutIndex));
  if (bounded === fromIndex || bounded === fromIndex + 1) {
    return null;
  }

  const next = layout.filter((_, index) => index !== fromIndex);
  next.splice(bounded > fromIndex ? bounded - 1 : bounded, 0, layout[fromIndex]);
  return next;
}

/**
 * Re-numbers `groups` so each `order` matches the group sequence in `layout`.
 * Groups absent from the layout keep their relative position at the end.
 */
export function applyLayoutGroupOrder(layout, groups) {
  const orderById = new Map();
  for (const entry of layout) {
    if (entry?.type === "group" && !orderById.has(entry.id)) {
      orderById.set(entry.id, orderById.size);
    }
  }

  return groups
    .map((group, index) => ({
      ...group,
      order: orderById.get(group.id) ?? orderById.size + index,
    }))
    .sort((left, right) => left.order - right.order);
}

/**
 * Translates a drop-line index measured against the layout *before* the dragged
 * row was lifted out into an insert index for the layout with that row removed.
 * `fromIndex` is -1 when the dragged row had no layout entry of its own (a
 * grouped item), in which case nothing shifts.
 */
export function resolveLayoutInsertIndex(layoutLength, fromIndex, toLayoutIndex) {
  const bounded = Math.max(0, Math.min(layoutLength, toLayoutIndex));
  return fromIndex >= 0 && bounded > fromIndex ? bounded - 1 : bounded;
}
