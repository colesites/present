// @ts-check

/**
 * What a theme is, and what applying one does to a song's slides.
 *
 * A theme is a look: how the words are set (font, weight, size, case,
 * colour or gradient, spacing, shadow, outline), where their box sits on the
 * slide, an optional box behind them (a band along the bottom, a card in the
 * middle), and the slide's background: clear, so the media or camera shows
 * through, a colour, a gradient, a mix of colours, or an image or video from
 * the media library, which plays behind the slide while it is live.
 *
 * Applying it rewrites the text elements' styles, puts the box and the
 * background on each slide as shapes the renderers draw
 * (`CanvasSlideLayer`, `compositor/text.rs`, `compositor/fill.rs`), and moves
 * a slide's lone text box to the theme's place.
 *
 * Sizes are in pixels of a 1920 by 1080 slide and scale with the song's
 * canvas; positions are fractions of the slide.
 *
 * Kept apart from React so it can be tested, and so every surface that
 * applies themes does it the same way.
 */

/**
 * @typedef {"none" | "upper" | "lower" | "title" | "lineStart"} ThemeCase
 * @typedef {{ color: string, blur: number, x: number, y: number }} ThemeShadow
 * @typedef {{ color: string, width: number }} ThemeOutline
 * @typedef {{ x: number, y: number, width: number, height: number }} ThemeFrame
 * @typedef {{ color: string, x: number, y: number, size: number }} ThemeSpot
 * @typedef {{ kind: "color", color: string }
 *   | { kind: "gradient", from: string, to: string, angle: number }
 *   | { kind: "mix", base: string, spots: ThemeSpot[] }} ThemeFill
 * @typedef {{
 *   fontFamily: string,
 *   fontSize: number,
 *   fontWeight: string,
 *   italic: boolean,
 *   underline: boolean,
 *   case: ThemeCase,
 *   color: string,
 *   gradient: { from: string, to: string, angle: number } | null,
 *   opacity: number,
 *   letterSpacing: number,
 *   lineHeight: number,
 *   align: "left" | "center" | "right",
 *   verticalAlign: "top" | "middle" | "bottom",
 *   shadow: ThemeShadow | null,
 *   outline: ThemeOutline | null,
 * }} ThemeText
 * @typedef {{ frame: ThemeFrame, fill: ThemeFill, radius: number }} ThemeBox
 * @typedef {{ kind: "media", mediaId: string, name: string, mediaType: "image" | "video" }} ThemeMedia
 * @typedef {ThemeFill | ThemeMedia} ThemeBackground
 * @typedef {{
 *   version: 2,
 *   text: ThemeText,
 *   frame: ThemeFrame,
 *   box: ThemeBox | null,
 *   background: ThemeBackground | null,
 * }} ThemeLook
 * @typedef {"basic" | "pro" | "advanced"} ThemeTier
 * @typedef {{ id: string, name: string, tier: ThemeTier, look: ThemeLook, description?: string }} BuiltInTheme
 * @typedef {"full" | "lower-third" | "upper-third" | "card"} ThemeLayout
 */

/** The slide the sizes in a look are measured on. */
export const THEME_CANVAS = { width: 1920, height: 1080 };

/** Quick shadows, as the Shadow control offers them. */
export const SHADOW_PRESETS = /** @type {const} */ ({
  soft: { color: "rgba(0,0,0,0.55)", blur: 10, x: 0, y: 3 },
  strong: { color: "rgba(0,0,0,0.85)", blur: 18, x: 0, y: 6 },
  glow: { color: "rgba(140,120,255,0.85)", blur: 28, x: 0, y: 0 },
});

/** @param {number} value */
const round = (value) => Math.round(value * 100) / 100;

/** @param {number} value */
const round4 = (value) => Math.round(value * 10_000) / 10_000;

/** @param {ThemeShadow} shadow @param {number} [scale] */
export const shadowCss = (shadow, scale = 1) =>
  `${round(shadow.x * scale)}px ${round(shadow.y * scale)}px ${round(shadow.blur * scale)}px ${shadow.color}`;

/**
 * A CSS shadow (`0 3px 10px rgba(0,0,0,.5)`) as a theme's, if it is one.
 *
 * @param {string | null | undefined} value
 * @param {number} [scale]
 * @returns {ThemeShadow | null}
 */
export function parseShadowCss(value, scale = 1) {
  const text = String(value ?? "").trim();
  if (!text || text === "none") return null;
  const match = text.match(/^(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+([\d.]+)(?:px)?\s+(.+)$/i);
  if (!match) return null;
  const at = (/** @type {string} */ part) => round(Number(part) / (scale || 1));
  return { x: at(match[1]), y: at(match[2]), blur: at(match[3]), color: match[4].trim() };
}

/** Element styles' `capitalization`, for each case. */
const CAPITALIZATION = /** @type {const} */ ({
  none: "none",
  upper: "uppercase",
  lower: "lowercase",
  title: "titleCase",
  lineStart: "lineStart",
});

/** @param {unknown} value @returns {ThemeCase} */
const caseOfCapitalization = (value) => {
  if (value === "uppercase" || value === "allCaps") return "upper";
  if (value === "lowercase") return "lower";
  if (value === "titleCase" || value === "capitalize") return "title";
  if (value === "lineStart") return "lineStart";
  return "none";
};

/**
 * The element style a look gives text, sized for `scale` (the song's canvas
 * against 1920 by 1080). Every field a theme owns is set, so a plain theme
 * over a styled slide takes the old outline, gradient and shadow away.
 *
 * @param {ThemeText} text
 * @param {number} [scale]
 */
export function styleForText(text, scale = 1) {
  return {
    fontFamily: text.fontFamily,
    fontSize: Math.max(1, Math.round(text.fontSize * scale)),
    fontWeight: text.fontWeight,
    fontStyle: text.italic ? "italic" : "normal",
    fontUnderline: text.underline,
    textDecoration: text.underline ? "underline" : "none",
    capitalization: CAPITALIZATION[text.case] ?? "none",
    color: text.color,
    textFillMode: text.gradient ? "gradient" : "solid",
    gradientFromColor: text.gradient?.from,
    gradientToColor: text.gradient?.to,
    gradientAngle: text.gradient?.angle,
    opacity: text.opacity,
    letterSpacing: round(text.letterSpacing * scale),
    lineHeight: text.lineHeight,
    textAlign: text.align,
    verticalAlign: text.verticalAlign,
    shadow: text.shadow ? shadowCss(text.shadow, scale) : "none",
    strokeColor: text.outline?.color,
    strokeWidth: text.outline ? round(text.outline.width * scale) : 0,
  };
}

/**
 * Where the words and the box behind them go, for each of the layouts the
 * designer offers as a starting point.
 *
 * @param {ThemeLayout} layout
 * @returns {{ frame: ThemeFrame, box: ThemeFrame }}
 */
export function layoutFrames(layout) {
  if (layout === "lower-third") {
    return { frame: { x: 0.06, y: 0.67, width: 0.88, height: 0.27 }, box: { x: 0, y: 0.63, width: 1, height: 0.37 } };
  }
  if (layout === "upper-third") {
    return { frame: { x: 0.06, y: 0.06, width: 0.88, height: 0.27 }, box: { x: 0, y: 0, width: 1, height: 0.37 } };
  }
  if (layout === "card") {
    return { frame: { x: 0.16, y: 0.26, width: 0.68, height: 0.48 }, box: { x: 0.12, y: 0.2, width: 0.76, height: 0.6 } };
  }
  return { frame: { x: 0.06, y: 0.08, width: 0.88, height: 0.84 }, box: { x: 0.03, y: 0.05, width: 0.94, height: 0.9 } };
}

/**
 * Which layout a frame is, if it is one of them exactly.
 *
 * @param {ThemeFrame} frame
 * @returns {ThemeLayout | null}
 */
export function layoutOf(frame) {
  for (const layout of /** @type {ThemeLayout[]} */ (["full", "lower-third", "upper-third", "card"])) {
    const preset = layoutFrames(layout).frame;
    if (
      Math.abs(preset.x - frame.x) < 0.005 &&
      Math.abs(preset.y - frame.y) < 0.005 &&
      Math.abs(preset.width - frame.width) < 0.005 &&
      Math.abs(preset.height - frame.height) < 0.005
    ) {
      return layout;
    }
  }
  return null;
}

/** @param {ThemeFrame} frame @param {{ width: number, height: number }} canvas */
const pixels = (frame, canvas) => ({
  x: round(frame.x * canvas.width),
  y: round(frame.y * canvas.height),
  width: round(frame.width * canvas.width),
  height: round(frame.height * canvas.height),
});

/** @param {{ x: number, y: number, width: number, height: number }} element @param {{ width: number, height: number }} canvas */
const fractions = (element, canvas) => ({
  x: round4(element.x / canvas.width),
  y: round4(element.y / canvas.height),
  width: round4(element.width / canvas.width),
  height: round4(element.height / canvas.height),
});

/**
 * The id a theme's box is given on a slide, so the next theme can find it.
 *
 * The same on every slide. A transition keeps what did not change between
 * two slides where it is and moves only the rest, matching elements by id
 * (`compositor/transition/change_detection.rs`), so a box or background that
 * is the same on both slides has to have the same id, or it fades and blurs
 * with the words. Older slides have the slide's id in front of it.
 */
export const bandIdFor = (/** @type {string | undefined} */ _slideId) => "__theme-band";
/** The id a theme's background is given on a slide; the same on every slide, as the box's is. */
export const backgroundIdFor = (/** @type {string | undefined} */ _slideId) => "__theme-bg";
const isThemeBand = (/** @type {any} */ element) =>
  typeof element?.id === "string" && element.id.endsWith("__theme-band");
const isThemeBackground = (/** @type {any} */ element) =>
  typeof element?.id === "string" && element.id.endsWith("__theme-bg");
/** Whether an element is one a theme put on the slide (its box or background). */
export const isThemeShape = (/** @type {any} */ element) => isThemeBand(element) || isThemeBackground(element);

/** A run's own font, size, colour and weight win over its element's, so a theme clears them. */
const THEMED_RUN_FIELDS = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "color", "letterSpacing"];

/**
 * Rich text keeps its bold, italics and line breaks, but loses the fonts,
 * colours and sizes typed into it, which would otherwise win over the theme.
 *
 * @param {string} html
 */
export const unstyleRichText = (html) =>
  html
    .replace(/<\/?font\b[^>]*>/gi, "")
    .replace(/\s(?:style|color|face|size)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/<span>([\s\S]*?)<\/span>/gi, "$1");

/** A scripture slide's reference line is set smaller than its verse. */
const FOOTER_SCALE = 0.45;

/** @param {any} element @param {ReturnType<typeof styleForText>} style */
function restyleText(element, style) {
  const own =
    element.contentRole === "scriptureFooter"
      ? { ...style, fontSize: Math.max(12, Math.round(style.fontSize * FOOTER_SCALE)) }
      : style;
  const next = { ...element, style: { ...(element.style ?? {}), ...own } };
  if (typeof next.richTextHtml === "string") next.richTextHtml = unstyleRichText(next.richTextHtml);
  if (next.textBody?.paragraphs) {
    next.textBody = {
      ...next.textBody,
      verticalAlign: own.verticalAlign,
      paragraphs: next.textBody.paragraphs.map((/** @type {any} */ paragraph) => {
        const rest = { ...paragraph };
        // A paragraph's own line height wins over the theme's.
        delete rest.lineHeight;
        return {
          ...rest,
          alignment: own.textAlign,
          runs: (paragraph.runs ?? []).map((/** @type {any} */ run) => {
            const clean = { ...run };
            for (const field of THEMED_RUN_FIELDS) delete clean[field];
            return clean;
          }),
        };
      }),
    };
  }
  return next;
}

/** The colour a renderer that paints only colours shows for a fill. */
export const plainColorOf = (/** @type {ThemeFill} */ fill) =>
  fill.kind === "color" ? fill.color : fill.kind === "gradient" ? fill.from : fill.base;

const VIDEO_NAME = /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|wmv)$/i;

/**
 * Whether a media library item is the one a slide's `backgroundId` names.
 *
 * The id first. A library item's id is its folder's id and its file name
 * (`useMediaFolders`), and folders have different ids on different
 * computers, so failing that, the same file name in any folder: a theme
 * saved on one computer finds the file on another with the same name.
 *
 * @param {string} backgroundId
 * @param {{ id: string, name: string }} item
 */
export const isBackgroundMedia = (backgroundId, item) =>
  item.id === backgroundId || backgroundId.endsWith(`-${item.name}`);

/**
 * The media library item a slide's background names, if this computer has it.
 *
 * @template {{ id: string, name: string }} T
 * @param {string | null | undefined} backgroundId
 * @param {T[]} items
 * @returns {T | null}
 */
export function findBackgroundMedia(backgroundId, items) {
  if (!backgroundId) return null;
  return (
    items.find((item) => item.id === backgroundId) ??
    items.find((item) => isBackgroundMedia(backgroundId, item)) ??
    null
  );
}

/**
 * One slide with `look` applied.
 *
 * A slide with a single text box gets the look's frame for it, and the box
 * behind it; a designed slide with several boxes keeps them where they are,
 * with no box behind, and only their style changes. The background goes on
 * every slide, blank ones too.
 *
 * @param {any} slide
 * @param {ThemeLook} look
 * @param {{ width: number, height: number }} [canvas]
 */
export function applyLookToSlide(slide, look, canvas = THEME_CANVAS) {
  const scale = Math.min(canvas.width / THEME_CANVAS.width, canvas.height / THEME_CANVAS.height);
  const style = styleForText(look.text, scale);
  const kept = Array.isArray(slide.elements)
    ? slide.elements.filter((/** @type {any} */ element) => !isThemeShape(element))
    : [];
  // An old slide with words but no boxes gets the box the app would give it.
  const elements =
    kept.length === 0 && !Array.isArray(slide.elements) && typeof slide.text === "string" && slide.text.trim()
      ? [{ id: `${slide.id ?? "slide"}_text_0`, type: "text", x: 0, y: 0, width: canvas.width, height: canvas.height, content: slide.text }]
      : kept;
  const textBoxes = elements.filter((/** @type {any} */ element) => element?.type === "text" && !element.isPlaceholder);
  const reframe = textBoxes.length === 1;

  const restyled = elements.map((/** @type {any} */ element) => {
    if (element?.type !== "text") return element;
    const next = restyleText(element, style);
    return reframe && element === textBoxes[0] ? { ...next, ...pixels(look.frame, canvas) } : next;
  });

  const media = look.background?.kind === "media" ? look.background : null;
  const fill = look.background && look.background.kind !== "media" ? look.background : null;

  const behind = [];
  if (fill && fill.kind !== "color") {
    behind.push({
      id: backgroundIdFor(slide.id),
      type: "shape",
      content: "",
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
      isLocked: true,
      style: { fill, backgroundColor: plainColorOf(fill), borderRadius: 0 },
    });
  }
  if (look.box && reframe) {
    behind.push({
      id: bandIdFor(slide.id),
      type: "shape",
      content: "",
      ...pixels(look.box.frame, canvas),
      style: {
        fill: look.box.fill,
        backgroundColor: plainColorOf(look.box.fill),
        borderRadius: round(look.box.radius * scale),
      },
    });
  }
  const next = [...behind, ...restyled];

  /** @type {any} */
  const themed = {
    ...slide,
    ...(Array.isArray(slide.elements) || next.length > 0 ? { elements: next } : {}),
    // An image or video is the media layer's, behind a clear slide: a colour
    // on the slide would cover it.
    ...(fill ? { backgroundColor: plainColorOf(fill), useBackgroundColor: true } : { useBackgroundColor: false }),
  };
  if (media) themed.backgroundId = media.mediaId;
  else delete themed.backgroundId;
  return themed;
}

/**
 * A song's slides with `look` applied: all of them, or only the one at
 * `onlySlideIndex`.
 *
 * @param {any[]} slides
 * @param {ThemeLook} look
 * @param {{ width: number, height: number }} [canvas]
 * @param {{ onlySlideIndex?: number | null }} [options]
 */
export function applyLookToSlides(slides, look, canvas = THEME_CANVAS, options = {}) {
  const only = options.onlySlideIndex;
  return slides.map((slide, index) =>
    typeof only === "number" && only >= 0 && index !== only ? slide : applyLookToSlide(slide, look, canvas),
  );
}

/**
 * A look read back from a slide, for "Save this slide's look": its main text
 * box's style and place, the box behind it and the background.
 *
 * @param {any} slide
 * @param {{ width: number, height: number }} [canvas]
 * @param {Array<{ id: string, name: string, type: string }>} [mediaItems] the media library, to name an image or video background
 * @returns {ThemeLook}
 */
export function lookFromSlide(slide, canvas = THEME_CANVAS, mediaItems = []) {
  const elements = Array.isArray(slide?.elements) ? slide.elements : [];
  const box = elements.find((/** @type {any} */ element) => element?.type === "text" && !element.isPlaceholder) ?? null;
  const style = box?.style ?? {};
  const scale = Math.min(canvas.width / THEME_CANVAS.width, canvas.height / THEME_CANVAS.height) || 1;
  const band = elements.find(isThemeBand);
  const background = elements.find(isThemeBackground);
  return normalizeLook({
    version: 2,
    text: {
      fontFamily: style.fontFamily || "Arial",
      fontSize: Math.round((style.fontSize || 72) / scale),
      fontWeight: String(style.fontWeight || (style.fontBold ? "700" : "600")),
      italic: style.fontStyle === "italic",
      underline: style.fontUnderline === true || String(style.textDecoration ?? "").includes("underline"),
      case: caseOfCapitalization(style.capitalization),
      color: style.color || "#ffffff",
      gradient:
        style.textFillMode === "gradient" && style.gradientFromColor && style.gradientToColor
          ? { from: style.gradientFromColor, to: style.gradientToColor, angle: style.gradientAngle ?? 135 }
          : null,
      opacity: typeof style.opacity === "number" ? style.opacity : 1,
      letterSpacing: typeof style.letterSpacing === "number" ? style.letterSpacing / scale : 0,
      lineHeight: typeof style.lineHeight === "number" ? style.lineHeight : 1.2,
      align: style.textAlign,
      verticalAlign: style.verticalAlign,
      shadow: parseShadowCss(style.shadow, scale),
      outline: style.strokeWidth > 0 && style.strokeColor ? { color: style.strokeColor, width: style.strokeWidth / scale } : null,
    },
    frame: box ? fractions(box, canvas) : layoutFrames("full").frame,
    box:
      band && (band.style?.fill || band.style?.backgroundColor)
        ? {
            frame: fractions(band, canvas),
            fill: band.style.fill ?? { kind: "color", color: band.style.backgroundColor },
            radius: (band.style.borderRadius ?? 0) / scale,
          }
        : null,
    background:
      background?.style?.fill ??
      mediaBackgroundOf(slide?.backgroundId, mediaItems) ??
      (slide?.useBackgroundColor && slide?.backgroundColor ? { kind: "color", color: slide.backgroundColor } : null),
  });
}

/**
 * A slide's `backgroundId` as a theme's media background.
 *
 * @param {unknown} backgroundId
 * @param {Array<{ id: string, name: string, type: string }>} items
 * @returns {ThemeMedia | null}
 */
function mediaBackgroundOf(backgroundId, items) {
  if (typeof backgroundId !== "string" || !backgroundId.trim()) return null;
  const item = findBackgroundMedia(backgroundId, items);
  const name = item?.name ?? backgroundId.slice(backgroundId.lastIndexOf("-") + 1);
  return {
    kind: "media",
    mediaId: backgroundId,
    name,
    mediaType: (item?.type ?? (VIDEO_NAME.test(name) ? "video" : "image")) === "video" ? "video" : "image",
  };
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i;
/** @param {unknown} value @param {string} fallback */
const COLOR = (value, fallback) =>
  typeof value === "string" && (HEX.test(value.trim()) || RGB.test(value.trim())) ? value.trim() : fallback;
/** @param {unknown} value @param {number} low @param {number} high @param {number} fallback */
const clamp = (value, low, high, fallback) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;

/** @param {any} value @param {ThemeFrame} fallback @returns {ThemeFrame} */
function normalizeFrame(value, fallback) {
  if (!value || typeof value !== "object") return fallback;
  const width = clamp(value.width, 0.05, 1, fallback.width);
  const height = clamp(value.height, 0.05, 1, fallback.height);
  return {
    x: round4(clamp(value.x, -0.2, 0.95, fallback.x)),
    y: round4(clamp(value.y, -0.2, 0.95, fallback.y)),
    width: round4(width),
    height: round4(height),
  };
}

/**
 * A fill made whole: its colours checked, numbers kept in range. `null`
 * when there is nothing usable.
 *
 * @param {any} value
 * @returns {ThemeFill | null}
 */
export function normalizeFill(value) {
  if (typeof value === "string") {
    const color = COLOR(value, "");
    return color ? { kind: "color", color } : null;
  }
  if (!value || typeof value !== "object") return null;
  if (value.kind === "gradient") {
    return {
      kind: "gradient",
      from: COLOR(value.from, "#1e1b4b"),
      to: COLOR(value.to, "#0f172a"),
      angle: Math.round(clamp(value.angle, 0, 360, 90)),
    };
  }
  if (value.kind === "mix") {
    const spots = Array.isArray(value.spots) ? value.spots.slice(0, 4) : [];
    return {
      kind: "mix",
      base: COLOR(value.base, "#15161f"),
      spots: spots.map((/** @type {any} */ spot) => ({
        color: COLOR(spot?.color, "#3b3f6b"),
        x: round4(clamp(spot?.x, -0.5, 1.5, 0.5)),
        y: round4(clamp(spot?.y, -0.5, 1.5, 0.5)),
        size: round4(clamp(spot?.size, 0.05, 2, 0.5)),
      })),
    };
  }
  if (value.kind === "color" || typeof value.color === "string") {
    const color = COLOR(value.color, "");
    return color ? { kind: "color", color } : null;
  }
  return null;
}

/** The shadows the first version of looks named. */
const OLD_SHADOWS = /** @type {Record<string, ThemeShadow | null>} */ ({ none: null, ...SHADOW_PRESETS });

/**
 * Any stored look made whole and safe: missing fields filled, numbers kept
 * in range, colours checked. Themes come from Convex and from other versions
 * of the app, so nothing about their shape is assumed. The first version
 * (fixed layouts, named shadows, a `band` colour) is read too.
 *
 * @param {any} value
 * @returns {ThemeLook}
 */
export function normalizeLook(value) {
  const text = value?.text ?? {};
  const oldLayout =
    value?.layout === "lower-third" || value?.layout === "upper-third" ? value.layout : value?.layout ? "full" : null;
  const presets = layoutFrames(oldLayout ?? "full");

  /** @type {ThemeShadow | null} */
  let shadow = null;
  if (typeof text.shadow === "string") shadow = OLD_SHADOWS[text.shadow] ?? OLD_SHADOWS.soft;
  else if (text.shadow && typeof text.shadow === "object") {
    shadow = {
      color: COLOR(text.shadow.color, "rgba(0,0,0,0.55)"),
      blur: round(clamp(text.shadow.blur, 0, 80, 10)),
      x: round(clamp(text.shadow.x, -60, 60, 0)),
      y: round(clamp(text.shadow.y, -60, 60, 3)),
    };
  } else if (text.shadow === undefined && value?.version !== 2) shadow = { ...SHADOW_PRESETS.soft };
  if (shadow) shadow = { ...shadow };

  const textCase = ["none", "upper", "lower", "title", "lineStart"].includes(text.case)
    ? text.case
    : text.uppercase === true
      ? "upper"
      : "none";

  /** @type {ThemeBox | null} */
  let box = null;
  if (value?.box && typeof value.box === "object") {
    const fill = normalizeFill(value.box.fill);
    if (fill) {
      box = {
        frame: normalizeFrame(value.box.frame, presets.box),
        fill,
        radius: round(clamp(value.box.radius, 0, 400, 0)),
      };
    }
  } else if (oldLayout && oldLayout !== "full" && value?.band && typeof value.band === "object") {
    box = {
      frame: presets.box,
      fill: normalizeFill(value.band.color) ?? { kind: "color", color: "rgba(0,0,0,0.55)" },
      radius: 0,
    };
  }

  const weight = String(text.fontWeight);
  return {
    version: 2,
    text: {
      fontFamily: typeof text.fontFamily === "string" && text.fontFamily.trim() ? text.fontFamily.trim().slice(0, 80) : "Arial",
      fontSize: Math.round(clamp(text.fontSize, 12, 300, 72)),
      fontWeight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"].includes(weight) ? weight : "700",
      italic: text.italic === true,
      underline: text.underline === true,
      case: textCase,
      color: COLOR(text.color, "#ffffff"),
      gradient:
        text.gradient && typeof text.gradient === "object"
          ? {
              from: COLOR(text.gradient.from, "#ffffff"),
              to: COLOR(text.gradient.to, "#9ca3af"),
              angle: Math.round(clamp(text.gradient.angle, 0, 360, 135)),
            }
          : null,
      opacity: round(clamp(text.opacity, 0.1, 1, 1)),
      letterSpacing: round(clamp(text.letterSpacing, -10, 60, 0)),
      lineHeight: round(clamp(text.lineHeight, 0.7, 3, 1.2)),
      align: text.align === "left" || text.align === "right" ? text.align : "center",
      verticalAlign: text.verticalAlign === "top" || text.verticalAlign === "bottom" ? text.verticalAlign : "middle",
      shadow,
      outline:
        text.outline && typeof text.outline === "object"
          ? { color: COLOR(text.outline.color, "#000000"), width: round(clamp(text.outline.width, 0.5, 30, 4)) }
          : null,
    },
    frame: normalizeFrame(value?.frame, presets.frame),
    box,
    background: value?.background == null || value.background === "" ? null : normalizeBackground(value.background),
  };
}

/**
 * A look's background made whole: a fill, or an image or video named by its
 * media library id and file name.
 *
 * @param {any} value
 * @returns {ThemeBackground | null}
 */
export function normalizeBackground(value) {
  if (value && typeof value === "object" && value.kind === "media") {
    const mediaId = typeof value.mediaId === "string" ? value.mediaId.trim().slice(0, 500) : "";
    if (!mediaId) return null;
    const name =
      typeof value.name === "string" && value.name.trim()
        ? value.name.trim().slice(0, 255)
        : mediaId.slice(mediaId.lastIndexOf("-") + 1);
    const mediaType =
      value.mediaType === "video" || value.mediaType === "image"
        ? value.mediaType
        : VIDEO_NAME.test(name)
          ? "video"
          : "image";
    return { kind: "media", mediaId, name, mediaType };
  }
  return normalizeFill(value);
}

/**
 * What using a look needs. Gradients, in the words or behind them, are
 * Power's; the rest of a saved theme is Pro's.
 *
 * @param {ThemeLook} look
 * @returns {ThemeTier}
 */
export function tierOfLook(look) {
  const fancy = (/** @type {ThemeBackground | null | undefined} */ fill) =>
    fill?.kind === "gradient" || fill?.kind === "mix";
  return look.text.gradient || fancy(look.background) || fancy(look.box?.fill) ? "advanced" : "pro";
}

/**
 * A theme saved by the old Themes modal, as a look: it stored an element
 * style and a background colour.
 *
 * @param {{ style?: any, backgroundColor?: string, look?: any }} row
 */
export function lookFromStoredTheme(row) {
  if (row?.look) return normalizeLook(row.look);
  const style = row?.style ?? {};
  return normalizeLook({
    version: 2,
    text: {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      italic: style.fontStyle === "italic",
      case: caseOfCapitalization(style.capitalization),
      color: style.color,
      gradient:
        style.textFillMode === "gradient" ? { from: style.gradientFromColor, to: style.gradientToColor, angle: style.gradientAngle } : null,
      align: style.textAlign,
      verticalAlign: style.verticalAlign,
      shadow: parseShadowCss(style.shadow),
      outline: style.strokeWidth > 0 ? { color: style.strokeColor, width: style.strokeWidth } : null,
    },
    background: row?.backgroundColor ?? null,
  });
}

/**
 * The six themes the old modal copied into every workspace the first time it
 * opened. They are built in now; an untouched copy is hidden from "Your
 * themes" rather than shown twice, and never deleted.
 */
const OLD_SEEDS = new Set(["Black", "Golden Ticket", "Influence", "United", "Vivid", "White"]);

/** @param {{ name?: string, look?: any, createdAt?: number, updatedAt?: number }} row */
export const isUntouchedOldSeed = (row) =>
  !row?.look && OLD_SEEDS.has(row?.name ?? "") && (row?.updatedAt ?? 0) - (row?.createdAt ?? 0) < 5_000;

/** @param {Partial<ThemeText>} text @returns {ThemeText} */
const t = (text) => ({
  fontFamily: "Arial",
  fontSize: 72,
  fontWeight: "700",
  italic: false,
  underline: false,
  case: "none",
  color: "#ffffff",
  gradient: null,
  opacity: 1,
  letterSpacing: 0,
  lineHeight: 1.2,
  align: "center",
  verticalAlign: "middle",
  shadow: { ...SHADOW_PRESETS.soft },
  outline: null,
  ...text,
});

/**
 * @param {ThemeText} text
 * @param {{ layout?: ThemeLayout, box?: { fill: ThemeFill, radius?: number } | null, background?: ThemeFill | null }} [rest]
 * @returns {ThemeLook}
 */
const look = (text, rest = {}) => {
  const frames = layoutFrames(rest.layout ?? "full");
  return {
    version: 2,
    text,
    frame: frames.frame,
    box: rest.box ? { frame: frames.box, fill: rest.box.fill, radius: rest.box.radius ?? 0 } : null,
    background: rest.background ?? null,
  };
};

/** @param {string} color @returns {ThemeFill} */
const solid = (color) => ({ kind: "color", color });

/**
 * The themes that come with Present. Basic ones are for everyone; Pro ones
 * need Pro or Power; advanced ones need Power. They use fonts every Mac and
 * Windows computer has.
 *
 * @type {BuiltInTheme[]}
 */
export const BUILT_IN_THEMES = [
  {
    id: "builtin:classic",
    name: "Classic",
    tier: "basic",
    description: "White words with a soft shadow, over anything.",
    look: look(t({})),
  },
  {
    id: "builtin:paper",
    name: "Paper",
    tier: "basic",
    description: "Dark words on warm white, for bright rooms.",
    look: look(t({ color: "#17181c", fontWeight: "600", shadow: null }), { background: solid("#f4f1ea") }),
  },
  {
    id: "builtin:midnight",
    name: "Midnight",
    tier: "basic",
    description: "Soft white on deep blue.",
    look: look(t({ color: "#e9ecff" }), { background: solid("#0b1021") }),
  },
  {
    id: "builtin:hymnal",
    name: "Hymnal",
    tier: "basic",
    description: "A serif in gold, for hymns and readings.",
    look: look(t({ fontFamily: "Georgia", fontWeight: "400", color: "#f3d27a", fontSize: 68 }), { background: solid("#16110a") }),
  },
  {
    id: "builtin:bold",
    name: "Bold",
    tier: "basic",
    description: "Heavy capitals, for choruses and big rooms.",
    look: look(t({ fontFamily: "Arial Black", fontWeight: "900", case: "upper", fontSize: 84 })),
  },
  {
    id: "builtin:lower-third",
    name: "Lower Third",
    tier: "pro",
    description: "Words in a band along the bottom, over video or a camera.",
    look: look(t({ fontSize: 58, shadow: null }), { layout: "lower-third", box: { fill: solid("rgba(0,0,0,0.62)") } }),
  },
  {
    id: "builtin:upper-third",
    name: "Upper Third",
    tier: "pro",
    description: "The same band across the top, clear of the stage.",
    look: look(t({ fontSize: 56, shadow: null }), { layout: "upper-third", box: { fill: solid("rgba(0,0,0,0.62)") } }),
  },
  {
    id: "builtin:card",
    name: "Card",
    tier: "pro",
    description: "Words on a rounded card in the middle of the slide.",
    look: look(t({ fontSize: 60, shadow: null, color: "#111827", fontWeight: "600" }), {
      layout: "card",
      box: { fill: solid("rgba(255,255,255,0.92)"), radius: 36 },
    }),
  },
  {
    id: "builtin:outline",
    name: "Outline",
    tier: "pro",
    description: "Outlined capitals that read over any video.",
    look: look(
      t({
        fontFamily: "Arial Black",
        fontWeight: "900",
        case: "upper",
        fontSize: 80,
        outline: { color: "#000000", width: 5 },
        shadow: { ...SHADOW_PRESETS.strong },
      }),
    ),
  },
  {
    id: "builtin:stream",
    name: "Stream",
    tier: "pro",
    description: "Lower third, left-aligned, for a livestream.",
    look: look(t({ fontSize: 54, align: "left", shadow: null }), {
      layout: "lower-third",
      box: { fill: solid("rgba(12,14,30,0.78)") },
    }),
  },
  {
    id: "builtin:scripture",
    name: "Scripture",
    tier: "pro",
    description: "Left-aligned reading text on slate.",
    look: look(t({ fontFamily: "Georgia", fontWeight: "400", fontSize: 60, align: "left", color: "#f8fafc", lineHeight: 1.35 }), {
      background: solid("#111827"),
    }),
  },
  {
    id: "builtin:neon",
    name: "Neon",
    tier: "pro",
    description: "Violet with a glow, for youth nights.",
    look: look(t({ color: "#b9adff", fontWeight: "800", shadow: { ...SHADOW_PRESETS.glow } }), { background: solid("#07060f") }),
  },
  {
    id: "builtin:impact",
    name: "Impact",
    tier: "pro",
    description: "Tall condensed capitals, low on the slide.",
    look: look(
      t({
        fontFamily: "Impact",
        fontWeight: "400",
        case: "upper",
        fontSize: 96,
        verticalAlign: "bottom",
        letterSpacing: 2,
        shadow: { ...SHADOW_PRESETS.strong },
      }),
    ),
  },
  {
    id: "builtin:dusk",
    name: "Dusk",
    tier: "advanced",
    description: "White words over a soft mix of violet and amber.",
    look: look(t({}), {
      background: {
        kind: "mix",
        base: "#15161f",
        spots: [
          { color: "#3b3f6b", x: 0.2, y: 0.15, size: 0.6 },
          { color: "#5a3a2e", x: 0.85, y: 0.9, size: 0.55 },
        ],
      },
    }),
  },
  {
    id: "builtin:ocean",
    name: "Ocean",
    tier: "advanced",
    description: "Deep blue into teal, top to bottom.",
    look: look(t({ fontWeight: "600" }), { background: { kind: "gradient", from: "#0b1a3a", to: "#0e5e6f", angle: 90 } }),
  },
  {
    id: "builtin:aurora",
    name: "Aurora",
    tier: "advanced",
    description: "Words in a violet-to-cyan gradient.",
    look: look(t({ fontWeight: "800", fontSize: 80, gradient: { from: "#a78bfa", to: "#22d3ee", angle: 135 }, shadow: null }), {
      background: solid("#05060f"),
    }),
  },
  {
    id: "builtin:sunrise",
    name: "Sunrise",
    tier: "advanced",
    description: "Gold into rose, for Easter mornings.",
    look: look(
      t({ fontFamily: "Georgia", fontWeight: "700", fontSize: 76, gradient: { from: "#fbbf24", to: "#f43f5e", angle: 120 }, shadow: null }),
      { background: solid("#140a06") },
    ),
  },
  {
    id: "builtin:chrome",
    name: "Chrome",
    tier: "advanced",
    description: "Silver capitals with an outline.",
    look: look(
      t({
        fontFamily: "Arial Black",
        fontWeight: "900",
        case: "upper",
        fontSize: 80,
        gradient: { from: "#ffffff", to: "#8b95a7", angle: 90 },
        outline: { color: "#0b0c10", width: 3 },
        shadow: { ...SHADOW_PRESETS.strong },
      }),
    ),
  },
];

/** Whether a plan's theme tier (`billing.ts`) includes themes of `tier`. */
export const tierIncludes = (/** @type {string} */ planTier, /** @type {ThemeTier} */ tier) => {
  /** @type {Record<string, number>} */
  const rank = { basic: 0, custom: 1, pro: 1, advanced: 2 };
  return (rank[planTier] ?? 0) >= (rank[tier] ?? 0);
};

/**
 * Slides rebuilt from a song's lyrics, given the theme recorded on the song
 * (`content.theme`) again. Rebuilding makes plain slides; without this,
 * typing in the lyrics would take the theme off.
 *
 * @template T
 * @param {T[]} slides
 * @param {{ look?: unknown } | null | undefined} theme
 * @param {{ width: number, height: number }} [canvas]
 * @returns {T[]}
 */
export function withSongTheme(slides, theme, canvas = THEME_CANVAS) {
  if (!theme?.look) return slides;
  return applyLookToSlides(slides, normalizeLook(theme.look), canvas);
}
