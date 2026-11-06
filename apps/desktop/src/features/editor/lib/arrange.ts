/**
 * Arranging a slide's objects in the editor: picking several, groups,
 * moving and resizing them together, aligning, spreading out, copying,
 * duplicating, and snapping to the slide and to other objects.
 *
 * Everything is in the slide's canvas pixels and works on the slide's
 * element list, returning a new one: the caller applies it as one change.
 *
 * No imports but types, so the tests can load this file on its own.
 */
import type { SlideElement } from "../../../shared/types";

export type Bounds = { left: number; top: number; right: number; bottom: number };

/** An object's frame on the slide, turned as it is drawn. */
export function elementBounds(element: SlideElement): Bounds {
  const theta = ((element.style?.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  const width = element.width * cos + element.height * sin;
  const height = element.width * sin + element.height * cos;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  return { left: cx - width / 2, top: cy - height / 2, right: cx + width / 2, bottom: cy + height / 2 };
}

export function unionBounds(bounds: Bounds[]): Bounds | null {
  if (bounds.length === 0) return null;
  return {
    left: Math.min(...bounds.map((b) => b.left)),
    top: Math.min(...bounds.map((b) => b.top)),
    right: Math.max(...bounds.map((b) => b.right)),
    bottom: Math.max(...bounds.map((b) => b.bottom)),
  };
}

export function boundsOf(elements: SlideElement[], ids: Iterable<string>): Bounds | null {
  const wanted = new Set(ids);
  return unionBounds(elements.filter((element) => wanted.has(element.id)).map(elementBounds));
}

/** The ids with the rest of each one's group: a group is picked whole. */
export function withGroups(elements: SlideElement[], ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  const groups = new Set(
    elements.filter((element) => wanted.has(element.id) && element.groupId).map((element) => element.groupId),
  );
  return elements
    .filter((element) => wanted.has(element.id) || (element.groupId && groups.has(element.groupId)))
    .map((element) => element.id);
}

/** The objects that move as one: each group, and each object on its own. */
function unitsOf(elements: SlideElement[], ids: Iterable<string>): string[][] {
  const wanted = new Set(withGroups(elements, ids));
  const units = new Map<string, string[]>();
  for (const element of elements) {
    if (!wanted.has(element.id)) continue;
    const key = element.groupId ? `group:${element.groupId}` : `one:${element.id}`;
    units.set(key, [...(units.get(key) ?? []), element.id]);
  }
  return [...units.values()];
}

const shifted = (elements: SlideElement[], ids: Set<string>, dx: number, dy: number) =>
  dx === 0 && dy === 0
    ? elements
    : elements.map((element) =>
        ids.has(element.id) && !element.isLocked ? { ...element, x: element.x + dx, y: element.y + dy } : element,
      );

/** The objects moved together. Locked ones stay. */
export function moveElements(elements: SlideElement[], ids: Iterable<string>, dx: number, dy: number): SlideElement[] {
  return shifted(elements, new Set(ids), dx, dy);
}

/**
 * The objects scaled together from one frame to another, as a group is
 * resized: each keeps its place in the group.
 */
export function scaleElements(
  elements: SlideElement[],
  ids: Iterable<string>,
  from: Bounds,
  to: Bounds,
): SlideElement[] {
  const wanted = new Set(ids);
  const sx = (to.right - to.left) / Math.max(1, from.right - from.left);
  const sy = (to.bottom - to.top) / Math.max(1, from.bottom - from.top);
  return elements.map((element) => {
    if (!wanted.has(element.id) || element.isLocked) return element;
    return {
      ...element,
      x: to.left + (element.x - from.left) * sx,
      y: to.top + (element.y - from.top) * sy,
      width: Math.max(1, element.width * sx),
      height: Math.max(1, element.height * sy),
    };
  });
}

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";

/**
 * Lined up along one edge or centre: with each other when several are
 * picked, or on the slide when one is (or one group). A group moves whole.
 */
export function alignElements(
  elements: SlideElement[],
  ids: Iterable<string>,
  alignment: Alignment,
  slide: { width: number; height: number },
): SlideElement[] {
  const units = unitsOf(elements, ids);
  if (units.length === 0) return elements;
  const unitBounds = units.map((unit) => boundsOf(elements, unit) as Bounds);
  const target =
    units.length === 1 ? { left: 0, top: 0, right: slide.width, bottom: slide.height } : (unionBounds(unitBounds) as Bounds);
  let next = elements;
  units.forEach((unit, index) => {
    const b = unitBounds[index];
    if (!b) return;
    let dx = 0;
    let dy = 0;
    if (alignment === "left") dx = target.left - b.left;
    if (alignment === "right") dx = target.right - b.right;
    if (alignment === "center") dx = (target.left + target.right) / 2 - (b.left + b.right) / 2;
    if (alignment === "top") dy = target.top - b.top;
    if (alignment === "bottom") dy = target.bottom - b.bottom;
    if (alignment === "middle") dy = (target.top + target.bottom) / 2 - (b.top + b.bottom) / 2;
    next = shifted(next, new Set(unit), dx, dy);
  });
  return next;
}

/** Three or more spread out with equal space between, the outer two staying. */
export function distributeElements(
  elements: SlideElement[],
  ids: Iterable<string>,
  axis: "horizontal" | "vertical",
): SlideElement[] {
  const units = unitsOf(elements, ids).map((unit) => ({ unit, bounds: boundsOf(elements, unit) as Bounds }));
  if (units.length < 3) return elements;
  const start = (b: Bounds) => (axis === "horizontal" ? b.left : b.top);
  const size = (b: Bounds) => (axis === "horizontal" ? b.right - b.left : b.bottom - b.top);
  units.sort((a, b) => start(a.bounds) - start(b.bounds));
  const first = units[0].bounds;
  const last = units[units.length - 1].bounds;
  const span = start(last) + size(last) - start(first);
  const filled = units.reduce((total, each) => total + size(each.bounds), 0);
  const gap = (span - filled) / (units.length - 1);
  let cursor = start(first);
  let next = elements;
  for (const each of units) {
    const delta = cursor - start(each.bounds);
    next = shifted(next, new Set(each.unit), axis === "horizontal" ? delta : 0, axis === "vertical" ? delta : 0);
    cursor += size(each.bounds) + gap;
  }
  return next;
}

/**
 * Grouped: one group of everything picked (groups inside it join it),
 * together in the layer order at the topmost one's place.
 */
export function groupElements(elements: SlideElement[], ids: Iterable<string>, groupId: string): SlideElement[] {
  const wanted = new Set(withGroups(elements, ids));
  if (wanted.size < 2) return elements;
  const members = elements.filter((element) => wanted.has(element.id)).map((element) => ({ ...element, groupId }));
  const lastIndex = Math.max(...elements.map((element, index) => (wanted.has(element.id) ? index : -1)));
  const before = elements.slice(0, lastIndex + 1).filter((element) => !wanted.has(element.id));
  const after = elements.slice(lastIndex + 1);
  return [...before, ...members, ...after];
}

/** Every group among the picked objects taken apart. */
export function ungroupElements(elements: SlideElement[], ids: Iterable<string>): SlideElement[] {
  const wanted = new Set(withGroups(elements, ids));
  return elements.map((element) => {
    if (!wanted.has(element.id) || !element.groupId) return element;
    const next = { ...element };
    delete next.groupId;
    return next;
  });
}

export function deleteElements(elements: SlideElement[], ids: Iterable<string>): SlideElement[] {
  const wanted = new Set(withGroups(elements, ids));
  return elements.filter((element) => !wanted.has(element.id) || element.isLocked);
}

/**
 * Copies of objects, with ids of their own, moved by `offset`; copied
 * groups stay groups of their own. `makeId` gives a fresh id.
 */
export function copiesOf(
  source: SlideElement[],
  offset: number,
  makeId: (element: SlideElement) => string,
): SlideElement[] {
  const groups = new Map<string, string>();
  return source.map((element) => {
    const copy: SlideElement = JSON.parse(JSON.stringify(element));
    copy.id = makeId(element);
    copy.x += offset;
    copy.y += offset;
    copy.isLocked = false;
    if (element.groupId) {
      if (!groups.has(element.groupId)) groups.set(element.groupId, `${copy.id}_group`);
      copy.groupId = groups.get(element.groupId);
    }
    return copy;
  });
}

/** The picked objects (with their groups) in layer order, to copy. */
export function pickedElements(elements: SlideElement[], ids: Iterable<string>): SlideElement[] {
  const wanted = new Set(withGroups(elements, ids));
  return elements.filter((element) => wanted.has(element.id));
}

export type Guide = { axis: "x" | "y"; at: number };

/**
 * A move snapped to the slide's edges and centre and to other objects'
 * edges and centres, when one is within `threshold`. The guides to show.
 */
export function snapMove(
  moving: Bounds,
  dx: number,
  dy: number,
  others: Bounds[],
  slide: { width: number; height: number },
  threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
  const xs = [0, slide.width / 2, slide.width, ...others.flatMap((b) => [b.left, (b.left + b.right) / 2, b.right])];
  const ys = [0, slide.height / 2, slide.height, ...others.flatMap((b) => [b.top, (b.top + b.bottom) / 2, b.bottom])];
  const best = (edges: number[], targets: number[]) => {
    let found: { delta: number; at: number } | null = null;
    for (const edge of edges) {
      for (const target of targets) {
        const delta = target - edge;
        if (Math.abs(delta) <= threshold && (!found || Math.abs(delta) < Math.abs(found.delta))) {
          found = { delta, at: target };
        }
      }
    }
    return found;
  };
  const left = moving.left + dx;
  const right = moving.right + dx;
  const top = moving.top + dy;
  const bottom = moving.bottom + dy;
  const snapX = best([left, (left + right) / 2, right], xs);
  const snapY = best([top, (top + bottom) / 2, bottom], ys);
  const guides: Guide[] = [];
  if (snapX) guides.push({ axis: "x", at: snapX.at });
  if (snapY) guides.push({ axis: "y", at: snapY.at });
  return { dx: dx + (snapX?.delta ?? 0), dy: dy + (snapY?.delta ?? 0), guides };
}

/** Whether a box drawn on the slide touches an object's frame. */
export function intersects(a: Bounds, b: Bounds): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
