"use client";

const displayBoundsSignature = (
  bounds: Display["bounds"] | Display["workArea"],
) => `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;

export function getDisplayListSignature(displays: Display[]): string {
  return displays
    .map((display) =>
      [
        display.id,
        display.label,
        displayBoundsSignature(display.bounds),
        displayBoundsSignature(display.workArea),
        display.scaleFactor,
        display.isPrimary ? "primary" : "secondary",
      ].join(":"),
    )
    .join("|");
}

export function areDisplayListsEqual(
  first: Display[],
  second: Display[],
): boolean {
  if (first.length !== second.length) {
    return false;
  }
  return getDisplayListSignature(first) === getDisplayListSignature(second);
}
