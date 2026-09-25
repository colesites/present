// @ts-check

/**
 * What a theme is, and what applying one does to a song's slides.
 *
 * A theme is a look: the words' font, colour, case, alignment, outline and
 * shadow; the slide's background; and where the words sit (the whole slide,
 * or a band across the lower or upper third). A look with no background
 * leaves the slide clear, so the words sit over the media or camera behind
 * them. Applying it rewrites the text
 * elements' styles, the background, and for a single text box its frame, as
 * the renderers read them (`CanvasSlideLayer`, `compositor/text.rs`).
 *
 * Kept apart from the React tree so it can be tested, and so the desktop app
 * and anything else that applies themes do it the same way.
 */

/**
 * @typedef {"full" | "lower-third" | "upper-third"} ThemeLayout
 * @typedef {"none" | "soft" | "strong" | "glow"} ThemeShadow
 * @typedef {{
 *   fontFamily: string,
 *   fontSize: number,
 *   fontWeight: string,
 *   italic: boolean,
 *   uppercase: boolean,
 *   color: string,
 *   gradient: { from: string, to: string, angle: number } | null,
 *   align: "left" | "center" | "right",
 *   verticalAlign: "top" | "middle" | "bottom",
 *   shadow: ThemeShadow,
 *   outline: { color: string, width: number } | null,
 * }} ThemeText
 * @typedef {{
 *   text: ThemeText,
 *   background: string | null,
 *   layout: ThemeLayout,
 *   band: { color: string } | null,
 * }} ThemeLook
 * @typedef {"basic" | "pro" | "advanced"} ThemeTier
 * @typedef {{ id: string, name: string, tier: ThemeTier, look: ThemeLook, description?: string }} BuiltInTheme
 */

/** The canvas the sizes and frames below are measured on. */
export const THEME_CANVAS = { width: 1920, height: 1080 };

/** Shadows as CSS, in canvas pixels, which both renderers read. */
export const SHADOWS = /** @type {const} */ ({
  none: "none",
  soft: "0 3px 10px rgba(0,0,0,0.55)",
  strong: "0 6px 18px rgba(0,0,0,0.85)",
  glow: "0 0 28px rgba(140,120,255,0.85)",
});

/**
 * @param {string | undefined} value
 * @returns {ThemeShadow}
 */
export const shadowName = (value) => {
  const trimmed = (value ?? "").trim();
  for (const [name, css] of Object.entries(SHADOWS)) if (css === trimmed) return /** @type {ThemeShadow} */ (name);
  return !trimmed || trimmed === "none" ? "none" : "soft";
};

/**
 * The element style a look gives text. Every field a theme owns is set,
 * so applying a plain theme over a styled slide takes the old outline,
 * gradient and shadow away rather than keeping them.
 *
 * @param {ThemeText} text
 */
export function styleForText(text) {
  return {
    fontFamily: text.fontFamily,
    fontSize: text.fontSize,
    fontWeight: text.fontWeight,
    fontStyle: text.italic ? "italic" : "normal",
    capitalization: text.uppercase ? "uppercase" : "none",
    color: text.color,
    textFillMode: text.gradient ? "gradient" : "solid",
    gradientFromColor: text.gradient?.from,
    gradientToColor: text.gradient?.to,
    gradientAngle: text.gradient?.angle,
    textAlign: text.align,
    verticalAlign: text.verticalAlign,
    shadow: SHADOWS[text.shadow] ?? "none",
    strokeColor: text.outline?.color,
    strokeWidth: text.outline ? text.outline.width : 0,
  };
}

/**
 * Where the words go, on a canvas of `width` by `height`.
 *
 * @param {ThemeLayout} layout
 * @param {number} width
 * @param {number} height
 */
export function textFrame(layout, width, height) {
  const round = (/** @type {number} */ value) => Math.round(value * 100) / 100;
  if (layout === "lower-third") {
    return { x: round(width * 0.06), y: round(height * 0.67), width: round(width * 0.88), height: round(height * 0.27) };
  }
  if (layout === "upper-third") {
    return { x: round(width * 0.06), y: round(height * 0.06), width: round(width * 0.88), height: round(height * 0.27) };
  }
  return { x: round(width * 0.06), y: round(height * 0.08), width: round(width * 0.88), height: round(height * 0.84) };
}

/**
 * The band behind a third's words.
 *
 * @param {ThemeLayout} layout
 * @param {number} width
 * @param {number} height
 */
export function bandFrame(layout, width, height) {
  const band = Math.round(height * 0.37 * 100) / 100;
  return layout === "upper-third"
    ? { x: 0, y: 0, width, height: band }
    : { x: 0, y: Math.round((height - band) * 100) / 100, width, height: band };
}

/** The id a theme's band is given on a slide, so the next theme can find it. */
export const bandIdFor = (/** @type {string | undefined} */ slideId) => `${slideId ?? "slide"}__theme-band`;
const isThemeBand = (/** @type {any} */ element) => typeof element?.id === "string" && element.id.endsWith("__theme-band");

/** A run's own font, size, colour and weight win over its element's, so a theme clears them. */
const THEMED_RUN_FIELDS = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "color"];

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
      paragraphs: next.textBody.paragraphs.map((/** @type {any} */ paragraph) => ({
        ...paragraph,
        alignment: own.textAlign,
        runs: (paragraph.runs ?? []).map((/** @type {any} */ run) => {
          const clean = { ...run };
          for (const field of THEMED_RUN_FIELDS) delete clean[field];
          return clean;
        }),
      })),
    };
  }
  return next;
}

/**
 * One slide with `look` applied.
 *
 * A slide with a single text box gets the layout's frame for it, and a
 * third's band behind it: a shape under everything, replaced by the next
 * theme's or removed. A designed slide with several boxes keeps them where
 * they are, with no band, and only their style changes.
 *
 * @param {any} slide
 * @param {ThemeLook} look
 * @param {{ width: number, height: number }} canvas
 */
export function applyLookToSlide(slide, look, canvas = THEME_CANVAS) {
  const scale = Math.min(canvas.width / THEME_CANVAS.width, canvas.height / THEME_CANVAS.height);
  const text = {
    ...look.text,
    fontSize: Math.round(look.text.fontSize * scale),
    outline: look.text.outline ? { ...look.text.outline, width: look.text.outline.width * scale } : null,
  };
  const style = styleForText(text);
  const kept = Array.isArray(slide.elements) ? slide.elements.filter((/** @type {any} */ element) => !isThemeBand(element)) : [];
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
    return reframe && element === textBoxes[0] ? { ...next, ...textFrame(look.layout, canvas.width, canvas.height) } : next;
  });

  const withBand =
    look.band && look.layout !== "full" && reframe
      ? [
          {
            id: bandIdFor(slide.id),
            type: "shape",
            content: "",
            ...bandFrame(look.layout, canvas.width, canvas.height),
            style: { backgroundColor: look.band.color, borderRadius: 0 },
          },
          ...restyled,
        ]
      : restyled;

  return {
    ...slide,
    ...(Array.isArray(slide.elements) || withBand.length > 0 ? { elements: withBand } : {}),
    ...(look.background ? { backgroundColor: look.background, useBackgroundColor: true } : { useBackgroundColor: false }),
  };
}

/**
 * A song's slides with `look` applied: all of them, or only `onlySlideId`.
 *
 * @param {any[]} slides
 * @param {ThemeLook} look
 * @param {{ width: number, height: number }} [canvas]
 * @param {{ onlySlideId?: string | null }} [options]
 */
export function applyLookToSlides(slides, look, canvas = THEME_CANVAS, options = {}) {
  return slides.map((slide) =>
    options.onlySlideId && slide.id !== options.onlySlideId ? slide : applyLookToSlide(slide, look, canvas),
  );
}

/**
 * A look read back from a slide, for "Save as theme": its main text box's
 * style, its background, and which third (if any) its box sits in.
 *
 * @param {any} slide
 * @param {{ width: number, height: number }} [canvas]
 * @returns {ThemeLook}
 */
export function lookFromSlide(slide, canvas = THEME_CANVAS) {
  const elements = Array.isArray(slide?.elements) ? slide.elements : [];
  const box = elements.find((/** @type {any} */ element) => element?.type === "text" && !element.isPlaceholder) ?? null;
  const style = box?.style ?? {};
  const scale = Math.min(canvas.width / THEME_CANVAS.width, canvas.height / THEME_CANVAS.height) || 1;
  const band = elements.find(isThemeBand);
  /** @type {ThemeLayout} */
  let layout = "full";
  if (box && typeof box.height === "number" && box.height < canvas.height * 0.5) {
    const centre = (box.y ?? 0) + box.height / 2;
    layout = centre > canvas.height * 0.6 ? "lower-third" : centre < canvas.height * 0.4 ? "upper-third" : "full";
  }
  const align = style.textAlign === "left" || style.textAlign === "right" ? style.textAlign : "center";
  return normalizeLook({
    text: {
      fontFamily: style.fontFamily || "Arial",
      fontSize: Math.round((style.fontSize || 72) / scale),
      fontWeight: String(style.fontWeight || (style.fontBold ? "700" : "600")),
      italic: style.fontStyle === "italic",
      uppercase: style.capitalization === "uppercase" || style.capitalization === "allCaps",
      color: style.color || "#ffffff",
      gradient:
        style.textFillMode === "gradient" && style.gradientFromColor && style.gradientToColor
          ? { from: style.gradientFromColor, to: style.gradientToColor, angle: style.gradientAngle ?? 135 }
          : null,
      align,
      verticalAlign: style.verticalAlign === "top" || style.verticalAlign === "bottom" ? style.verticalAlign : "middle",
      shadow: shadowName(style.shadow),
      outline: style.strokeWidth > 0 && style.strokeColor ? { color: style.strokeColor, width: style.strokeWidth / scale } : null,
    },
    background: slide?.useBackgroundColor && slide?.backgroundColor ? slide.backgroundColor : null,
    layout,
    band: band?.style?.backgroundColor ? { color: band.style.backgroundColor } : null,
  });
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR = (/** @type {unknown} */ value, /** @type {string} */ fallback) =>
  typeof value === "string" && (HEX.test(value.trim()) || /^rgba?\(/i.test(value.trim())) ? value.trim() : fallback;
const clamp = (
  /** @type {unknown} */ value,
  /** @type {number} */ low,
  /** @type {number} */ high,
  /** @type {number} */ fallback,
) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;

/**
 * Any stored look made whole and safe: missing fields filled, numbers kept
 * in range, colours checked. Themes come from Convex and from other versions
 * of the app, so nothing about their shape is assumed.
 *
 * @param {any} value
 * @returns {ThemeLook}
 */
export function normalizeLook(value) {
  const text = value?.text ?? {};
  const layout = value?.layout === "lower-third" || value?.layout === "upper-third" ? value.layout : "full";
  return {
    text: {
      fontFamily: typeof text.fontFamily === "string" && text.fontFamily.trim() ? text.fontFamily.trim().slice(0, 80) : "Arial",
      fontSize: Math.round(clamp(text.fontSize, 12, 240, 72)),
      fontWeight: ["300", "400", "500", "600", "700", "800", "900"].includes(String(text.fontWeight)) ? String(text.fontWeight) : "700",
      italic: text.italic === true,
      uppercase: text.uppercase === true,
      color: COLOR(text.color, "#ffffff"),
      gradient:
        text.gradient && typeof text.gradient === "object"
          ? {
              from: COLOR(text.gradient.from, "#ffffff"),
              to: COLOR(text.gradient.to, "#9ca3af"),
              angle: Math.round(clamp(text.gradient.angle, 0, 360, 135)),
            }
          : null,
      align: text.align === "left" || text.align === "right" ? text.align : "center",
      verticalAlign: text.verticalAlign === "top" || text.verticalAlign === "bottom" ? text.verticalAlign : "middle",
      shadow: ["none", "soft", "strong", "glow"].includes(text.shadow) ? text.shadow : "soft",
      outline:
        text.outline && typeof text.outline === "object"
          ? { color: COLOR(text.outline.color, "#000000"), width: clamp(text.outline.width, 1, 24, 4) }
          : null,
    },
    background: value?.background == null || value.background === "" ? null : COLOR(value.background, "#000000"),
    layout,
    band: layout !== "full" && value?.band && typeof value.band === "object" ? { color: COLOR(value.band.color, "rgba(0,0,0,0.55)") } : null,
  };
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
    text: {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      italic: style.fontStyle === "italic",
      uppercase: style.capitalization === "uppercase" || style.capitalization === "allCaps",
      color: style.color,
      gradient:
        style.textFillMode === "gradient" ? { from: style.gradientFromColor, to: style.gradientToColor, angle: style.gradientAngle } : null,
      align: style.textAlign,
      verticalAlign: style.verticalAlign,
      shadow: shadowName(style.shadow),
      outline: style.strokeWidth > 0 ? { color: style.strokeColor, width: style.strokeWidth } : null,
    },
    background: row?.backgroundColor ?? null,
    layout: "full",
    band: null,
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
  uppercase: false,
  color: "#ffffff",
  gradient: null,
  align: "center",
  verticalAlign: "middle",
  shadow: "soft",
  outline: null,
  ...text,
});

/**
 * The themes that come with Present. Basic ones are for everyone, signed in
 * or not; Pro ones need Pro or Power; advanced ones need Power. They use
 * fonts every Mac and Windows computer has.
 *
 * @type {BuiltInTheme[]}
 */
export const BUILT_IN_THEMES = [
  {
    id: "builtin:classic",
    name: "Classic",
    tier: "basic",
    description: "White words with a soft shadow, over anything.",
    look: { text: t({}), background: null, layout: "full", band: null },
  },
  {
    id: "builtin:paper",
    name: "Paper",
    tier: "basic",
    description: "Dark words on warm white, for bright rooms.",
    look: { text: t({ color: "#17181c", fontWeight: "600", shadow: "none" }), background: "#f4f1ea", layout: "full", band: null },
  },
  {
    id: "builtin:midnight",
    name: "Midnight",
    tier: "basic",
    description: "Soft white on deep blue.",
    look: { text: t({ color: "#e9ecff" }), background: "#0b1021", layout: "full", band: null },
  },
  {
    id: "builtin:hymnal",
    name: "Hymnal",
    tier: "basic",
    description: "A serif in gold, for hymns and readings.",
    look: { text: t({ fontFamily: "Georgia", fontWeight: "400", color: "#f3d27a", fontSize: 68 }), background: "#16110a", layout: "full", band: null },
  },
  {
    id: "builtin:bold",
    name: "Bold",
    tier: "basic",
    description: "Heavy capitals, for choruses and big rooms.",
    look: { text: t({ fontFamily: "Arial Black", fontWeight: "900", uppercase: true, fontSize: 84 }), background: null, layout: "full", band: null },
  },
  {
    id: "builtin:lower-third",
    name: "Lower Third",
    tier: "pro",
    description: "Words in a band along the bottom, over video or a camera.",
    look: {
      text: t({ fontSize: 58, shadow: "none" }),
      background: null,
      layout: "lower-third",
      band: { color: "rgba(0,0,0,0.62)" },
    },
  },
  {
    id: "builtin:upper-third",
    name: "Upper Third",
    tier: "pro",
    description: "The same band across the top, clear of the stage.",
    look: {
      text: t({ fontSize: 56, shadow: "none" }),
      background: null,
      layout: "upper-third",
      band: { color: "rgba(0,0,0,0.62)" },
    },
  },
  {
    id: "builtin:outline",
    name: "Outline",
    tier: "pro",
    description: "Outlined capitals that read over any video.",
    look: {
      text: t({ fontFamily: "Arial Black", fontWeight: "900", uppercase: true, fontSize: 80, outline: { color: "#000000", width: 5 }, shadow: "strong" }),
      background: null,
      layout: "full",
      band: null,
    },
  },
  {
    id: "builtin:stream",
    name: "Stream",
    tier: "pro",
    description: "Lower third, left-aligned, for a livestream.",
    look: {
      text: t({ fontSize: 54, align: "left", shadow: "none" }),
      background: null,
      layout: "lower-third",
      band: { color: "rgba(12,14,30,0.78)" },
    },
  },
  {
    id: "builtin:scripture",
    name: "Scripture",
    tier: "pro",
    description: "Left-aligned reading text on slate.",
    look: {
      text: t({ fontFamily: "Georgia", fontWeight: "400", fontSize: 60, align: "left", color: "#f8fafc" }),
      background: "#111827",
      layout: "full",
      band: null,
    },
  },
  {
    id: "builtin:neon",
    name: "Neon",
    tier: "pro",
    description: "Violet with a glow, for youth nights.",
    look: { text: t({ color: "#b9adff", fontWeight: "800", shadow: "glow" }), background: "#07060f", layout: "full", band: null },
  },
  {
    id: "builtin:impact",
    name: "Impact",
    tier: "pro",
    description: "Tall condensed capitals, low on the slide.",
    look: {
      text: t({ fontFamily: "Impact", fontWeight: "400", uppercase: true, fontSize: 96, verticalAlign: "bottom", shadow: "strong" }),
      background: null,
      layout: "full",
      band: null,
    },
  },
  {
    id: "builtin:aurora",
    name: "Aurora",
    tier: "advanced",
    description: "Words in a violet-to-cyan gradient.",
    look: {
      text: t({ fontWeight: "800", fontSize: 80, gradient: { from: "#a78bfa", to: "#22d3ee", angle: 135 }, shadow: "none" }),
      background: "#05060f",
      layout: "full",
      band: null,
    },
  },
  {
    id: "builtin:sunrise",
    name: "Sunrise",
    tier: "advanced",
    description: "Gold into rose, for Easter mornings.",
    look: {
      text: t({ fontFamily: "Georgia", fontWeight: "700", fontSize: 76, gradient: { from: "#fbbf24", to: "#f43f5e", angle: 120 }, shadow: "none" }),
      background: "#140a06",
      layout: "full",
      band: null,
    },
  },
  {
    id: "builtin:chrome",
    name: "Chrome",
    tier: "advanced",
    description: "Silver capitals with an outline.",
    look: {
      text: t({
        fontFamily: "Arial Black",
        fontWeight: "900",
        uppercase: true,
        fontSize: 80,
        gradient: { from: "#ffffff", to: "#8b95a7", angle: 90 },
        outline: { color: "#0b0c10", width: 3 },
        shadow: "strong",
      }),
      background: null,
      layout: "full",
      band: null,
    },
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
