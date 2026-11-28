"use client";

/** Words measured in a verse box's font, as the audience window's canvas measures them. */
const measured = new Map<string, number>();
let measuringContext: CanvasRenderingContext2D | null | undefined;
export function measureWords(text: string, fontSize: number, font: { family: string; weight: string }): number {
  if (measuringContext === undefined) {
    measuringContext =
      typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  // At a size of 100 and scaled: widths are near enough proportional, and
  // far fewer are measured.
  const key = `${font.weight}|${font.family}|${text}`;
  let width = measured.get(key);
  if (width === undefined) {
    if (measuringContext) {
      measuringContext.font = `${font.weight} 100px "${font.family}", sans-serif`;
      width = measuringContext.measureText(text).width;
    } else {
      width = text.length * 55;
    }
    if (measured.size > 20000) measured.clear();
    measured.set(key, width);
  }
  return (width * fontSize) / 100;
}
