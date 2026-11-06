/**
 * Pictures in the editor: replacing one, and cropping it.
 *
 * A crop (`style.crop`) is the fraction cut from each side of the picture;
 * what is left is stretched to the box (`croppedImageRect`, and
 * `compositor/images.rs`). So cropping here moves the box's edge with the
 * crop, as Keynote's mask does: the picture stays the size and place it was.
 *
 * Only type imports at the top, so the tests can load the pure parts.
 */
import type { SlideElement } from "../../../shared/types";

export type Crop = { left: number; top: number; right: number; bottom: number };
export type PictureSize = { width: number; height: number };

export const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };
/** The most that can be cut from a picture across, or down: some must show. */
const MAX_CUT = 0.95;

const clampCrop = (crop: Crop): Crop => {
  const side = (value: number) => Math.min(MAX_CUT, Math.max(0, Number.isFinite(value) ? value : 0));
  const next = { left: side(crop.left), top: side(crop.top), right: side(crop.right), bottom: side(crop.bottom) };
  if (next.left + next.right > MAX_CUT) next.right = Math.max(0, MAX_CUT - next.left);
  if (next.top + next.bottom > MAX_CUT) next.bottom = Math.max(0, MAX_CUT - next.top);
  return next;
};

/** The crop the picture is drawn with: its own, else none. */
export const cropOf = (element: SlideElement): Crop => element.style?.crop ?? NO_CROP;

/**
 * The picture with a crop, its box's edges moved with the cut so the
 * picture itself does not move or change size.
 */
export function withCrop(element: SlideElement, crop: Crop): SlideElement {
  const current = cropOf(element);
  const next = clampCrop(crop);
  const shownX = 1 - current.left - current.right;
  const shownY = 1 - current.top - current.bottom;
  // The whole picture's size on the slide.
  const fullWidth = element.width / Math.max(0.01, shownX);
  const fullHeight = element.height / Math.max(0.01, shownY);
  return {
    ...element,
    x: element.x + (next.left - current.left) * fullWidth,
    y: element.y + (next.top - current.top) * fullHeight,
    width: Math.max(10, fullWidth * (1 - next.left - next.right)),
    height: Math.max(10, fullHeight * (1 - next.top - next.bottom)),
    style: { ...(element.style ?? {}), crop: next },
  };
}

/**
 * Ready to crop: the same look as its fit, as a crop. A filled box is the
 * picture with its overflow cut; a fitted one shrinks to the picture.
 */
export function startCrop(element: SlideElement, picture: PictureSize): SlideElement {
  if (element.style?.crop) return element;
  const style = { ...(element.style ?? {}) };
  const fit = style.objectFit ?? "cover";
  delete style.objectFit;
  const pictureAspect = picture.width / Math.max(1, picture.height);
  const boxAspect = element.width / Math.max(1, element.height);
  if (fit === "fill" || !Number.isFinite(pictureAspect) || pictureAspect <= 0) {
    return { ...element, style: { ...style, crop: NO_CROP } };
  }
  if (fit === "contain") {
    const width = pictureAspect > boxAspect ? element.width : element.height * pictureAspect;
    const height = pictureAspect > boxAspect ? element.width / pictureAspect : element.height;
    return {
      ...element,
      x: element.x + (element.width - width) / 2,
      y: element.y + (element.height - height) / 2,
      width,
      height,
      style: { ...style, crop: NO_CROP },
    };
  }
  // Filled: the middle of the picture shows, its overflow cut evenly.
  if (pictureAspect > boxAspect) {
    const cut = (1 - boxAspect / pictureAspect) / 2;
    return { ...element, style: { ...style, crop: { left: cut, top: 0, right: cut, bottom: 0 } } };
  }
  const cut = (1 - pictureAspect / boxAspect) / 2;
  return { ...element, style: { ...style, crop: { left: 0, top: cut, right: 0, bottom: cut } } };
}

/** The whole picture again, in a box its shape, filling it. */
export function withoutCrop(element: SlideElement): SlideElement {
  const uncropped = withCrop(element, NO_CROP);
  const style = { ...(uncropped.style ?? {}) };
  delete style.crop;
  return { ...uncropped, style: { ...style, objectFit: "cover" } };
}

/**
 * Another picture in the box. An empty box takes the picture's shape about
 * its centre; a picture already there keeps its box, and the old crop goes.
 */
export function withPicture(element: SlideElement, url: string, picture: PictureSize | null): SlideElement {
  const style = { ...(element.style ?? {}) };
  delete style.crop;
  const next: SlideElement = { ...element, content: url, style: { ...style, objectFit: style.objectFit ?? "cover" } };
  if (element.content?.trim() || !picture || picture.width <= 0 || picture.height <= 0) return next;
  const aspect = picture.width / picture.height;
  const width = Math.min(element.width, element.height * aspect);
  const height = width / aspect;
  return {
    ...next,
    x: element.x + (element.width - width) / 2,
    y: element.y + (element.height - height) / 2,
    width,
    height,
  };
}

/** A picture's own size, once it loads; null if it will not. */
export function loadPictureSize(url: string): Promise<PictureSize | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * A picture the operator chooses from this computer, saved beside imported
 * decks' pictures so every screen can draw it. Null if they chose none.
 */
export function choosePicture(): Promise<{ url: string; size: PictureSize | null } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = async () => {
        const dataUrl = String(reader.result ?? "");
        const extension = (file.name.split(".").pop() ?? "png").toLowerCase();
        const saved = window.pptxAPI?.saveMedia
          ? await window.pptxAPI
              .saveMedia(dataUrl.slice(dataUrl.indexOf(",") + 1), extension)
              .catch(() => dataUrl)
          : dataUrl;
        resolve({ url: saved, size: await loadPictureSize(saved) });
      };
      reader.readAsDataURL(file);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
