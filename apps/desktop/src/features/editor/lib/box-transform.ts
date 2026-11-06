/**
 * Moving a box's handles on the editor canvas, in the slide's canvas pixels.
 *
 * A box is drawn rotated about its centre and then flipped (CSS
 * `rotate() scaleX() scaleY()`), so a handle is dragged in the box's own
 * frame: the pointer's movement is turned back into that frame, the side
 * opposite the handle stays where it is, and the new centre is turned back
 * onto the slide.
 *
 * No imports, so the tests can load this file on its own.
 */

export type Box = { x: number; y: number; width: number; height: number };

export type ResizeOptions = {
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  /** Keep the box's proportions, from a corner handle. */
  keepAspect?: boolean;
  minSize?: number;
};

/** The box after a handle (`top-left`, `mid-right`, ...) moved by `dx`, `dy`. */
export function resizeBox(start: Box, handle: string, dx: number, dy: number, options: ResizeOptions = {}): Box {
  const theta = ((options.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const minSize = options.minSize ?? 10;

  // The pointer's movement in the box's own frame.
  let lx = dx * cos + dy * sin;
  let ly = -dx * sin + dy * cos;
  if (options.flipX) lx = -lx;
  if (options.flipY) ly = -ly;

  const sx = handle.includes("left") ? -1 : handle.includes("right") ? 1 : 0;
  const sy = handle.includes("top") ? -1 : handle.includes("bottom") ? 1 : 0;
  let width = start.width + sx * lx;
  let height = start.height + sy * ly;

  if (options.keepAspect && sx !== 0 && sy !== 0 && start.width > 0 && start.height > 0) {
    const scale = Math.max(width / start.width, height / start.height, minSize / Math.min(start.width, start.height));
    width = start.width * scale;
    height = start.height * scale;
  }
  width = Math.max(minSize, width);
  height = Math.max(minSize, height);

  // The far side stays put: the centre moves half the growth, toward the handle.
  let cx = (sx * (width - start.width)) / 2;
  let cy = (sy * (height - start.height)) / 2;
  if (options.flipX) cx = -cx;
  if (options.flipY) cy = -cy;
  const centreX = start.x + start.width / 2 + cx * cos - cy * sin;
  const centreY = start.y + start.height / 2 + cx * sin + cy * cos;

  return { x: centreX - width / 2, y: centreY - height / 2, width, height };
}

/**
 * The rotation that points the rotate handle (above the box, or below it
 * when the box is flipped upside down) at the pointer, in degrees from
 * -180 to 180. With `snap`, to the nearest 15 degrees; without it, still to
 * a right angle within 2 degrees of one.
 */
export function rotationToward(
  centre: { x: number; y: number },
  pointer: { x: number; y: number },
  options: { flipY?: boolean; snap?: boolean } = {},
): number {
  const pointing = (Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * 180) / Math.PI;
  let rotation = pointing + (options.flipY ? -90 : 90);
  if (options.snap) {
    rotation = Math.round(rotation / 15) * 15;
  } else {
    const right = Math.round(rotation / 90) * 90;
    if (Math.abs(rotation - right) < 2) rotation = right;
  }
  rotation = ((((rotation + 180) % 360) + 360) % 360) - 180;
  return Object.is(rotation, -0) ? 0 : Math.round(rotation * 10) / 10;
}
