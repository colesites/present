/**
 * Multiview's wall of TVs: how many across and down, and how large, so a
 * page of them is as large as the window allows (`MultiviewWindow.tsx`).
 */

/** The TVs' shape. Each picture sits inside in its own. */
export const TV_ASPECT = 16 / 9;
export const WALL_GAP = 10;

export type WallGrid = { columns: number; rows: number; tileWidth: number; tileHeight: number };

/** `count` same-sized TVs in `width` × `height`, each as large as it can be. */
export function wallGrid(count: number, width: number, height: number, gap = WALL_GAP, aspect = TV_ASPECT): WallGrid {
  const total = Math.max(1, Math.floor(count));
  let best: WallGrid = { columns: 1, rows: 1, tileWidth: 0, tileHeight: 0 };
  for (let columns = 1; columns <= total; columns += 1) {
    const rows = Math.ceil(total / columns);
    const cellWidth = (width - gap * (columns - 1)) / columns;
    const cellHeight = (height - gap * (rows - 1)) / rows;
    const tileWidth = Math.floor(Math.min(cellWidth, cellHeight * aspect));
    if (tileWidth > best.tileWidth) {
      best = { columns, rows, tileWidth, tileHeight: Math.floor(tileWidth / aspect) };
    }
  }
  return best;
}
