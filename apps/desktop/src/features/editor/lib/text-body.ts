/**
 * Editing an imported text box (a PowerPoint deck's `textBody`).
 *
 * The screens draw `textBody` when an element has one, so the editor has to
 * change it, not `content`. Three pieces:
 *
 * - `textBodyToEditableHtml`: the box as HTML for a contentEditable. Each
 *   paragraph and run keeps its own formatting in a `data-` attribute, so
 *   what the browser does not touch comes back exactly as it was.
 * - `editableToTextBody`: that HTML, after editing, back into paragraphs and
 *   runs. Bold, italic, underline and strikethrough the browser added to a
 *   selection are read from its tags and inline styles.
 * - `syncTextBodyWithStyle`: a change in the inspector (font, size, colour,
 *   alignment, ...) applied to every run and paragraph of the box.
 *
 * No imports but types, so the tests can load this file on its own.
 */
import type {
  SlideElement,
  SlideElementStyle,
  SlideTextBody,
  SlideTextParagraph,
  SlideTextRun,
} from "../../../shared/types";

export type TextRunFormat = Omit<SlideTextRun, "text">;
export type TextParagraphFormat = Omit<SlideTextParagraph, "runs">;

/** Canvas pixels to screen pixels inside the editable: set on an ancestor. */
export const SLIDE_PX_VAR = "--slide-px";

const scaled = (value: number) => `calc(var(${SLIDE_PX_VAR}, 1px) * ${value})`;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const escapeCssString = (value: string) => value.replace(/["\\]/g, "\\$&");

const jsonAttribute = (value: object) => escapeHtml(JSON.stringify(value));

/** A family as CSS; the editor passes the stand-ins the slide is drawn with. */
export type FontFamilyCss = (family: string) => string;
const quotedFamily: FontFamilyCss = (family) => `"${escapeCssString(family)}"`;

function runCss(format: TextRunFormat, familyCss: FontFamilyCss): string {
  const css: string[] = [];
  if (format.fontFamily) css.push(`font-family: ${familyCss(format.fontFamily)}`);
  if (typeof format.fontSize === "number") css.push(`font-size: ${scaled(format.fontSize)}`);
  if (format.fontWeight) css.push(`font-weight: ${format.fontWeight}`);
  css.push(`font-style: ${format.fontStyle === "italic" ? "italic" : "normal"}`);
  if (format.color) css.push(`color: ${format.color}`);
  const decoration = [format.underline ? "underline" : "", format.strike ? "line-through" : ""]
    .filter(Boolean)
    .join(" ");
  // Always written, so a decoration the browser removes reads back as none.
  css.push(`text-decoration: ${decoration || "none"}`);
  if (typeof format.letterSpacing === "number" && format.letterSpacing !== 0) {
    css.push(`letter-spacing: ${scaled(format.letterSpacing)}`);
  }
  if (format.highlight) css.push(`background-color: ${format.highlight}`);
  return escapeHtml(css.join("; "));
}

function paragraphCss(format: TextParagraphFormat): string {
  const css: string[] = [];
  if (format.alignment) css.push(`text-align: ${format.alignment}`);
  if (format.marginLeft) css.push(`margin-left: ${scaled(format.marginLeft)}`);
  if (format.indent) css.push(`text-indent: ${scaled(format.indent)}`);
  if (format.spaceBefore) css.push(`margin-top: ${scaled(format.spaceBefore)}`);
  if (format.spaceAfter) css.push(`margin-bottom: ${scaled(format.spaceAfter)}`);
  if (typeof format.lineHeight === "number" && format.lineHeight > 0) {
    css.push(
      `line-height: ${format.lineHeight > 4 ? scaled(format.lineHeight) : String(format.lineHeight)}`,
    );
  } else {
    css.push("line-height: 1.2");
  }
  if (format.bullet) {
    // The bullet hangs in a negative indent, as the slide draws it.
    const hang = format.indent && format.indent < 0 ? scaled(-format.indent) : "0.6em";
    css.push(`--bullet-width: ${hang}`);
  }
  return escapeHtml(css.join("; "));
}

const splitRun = ({ text, ...format }: SlideTextRun) => ({ text, format });
const splitParagraph = ({ runs, ...format }: SlideTextParagraph) => ({ runs, format });

/** The box as HTML for a contentEditable; `editableToTextBody` reads it back. */
export function textBodyToEditableHtml(
  body: SlideTextBody,
  familyCss: FontFamilyCss = quotedFamily,
): string {
  return (body.paragraphs ?? [])
    .map((paragraph) => {
      const { runs, format } = splitParagraph(paragraph);
      const first = runs[0] ? splitRun(runs[0]).format : null;
      const attributes = [
        `data-paragraph="${jsonAttribute(format)}"`,
        first ? `data-default-run="${jsonAttribute(first)}"` : "",
        format.bullet ? `data-bullet="${escapeHtml(format.bullet.text)}"` : "",
        `style="${paragraphCss(format)}"`,
      ]
        .filter(Boolean)
        .join(" ");
      const inner = runs
        .filter((run) => run.text.length > 0)
        .map((run) => {
          const { text, format: runFormat } = splitRun(run);
          const html = text.split("\n").map(escapeHtml).join("<br>");
          return `<span data-run="${jsonAttribute(runFormat)}" style="${runCss(runFormat, familyCss)}">${html}</span>`;
        })
        .join("");
      // An empty line, or one ending in a line break, needs a last <br> to
      // have a height; the reader drops a block's last <br>.
      const endsWithBreak = runs[runs.length - 1]?.text.endsWith("\n") ?? false;
      return `<div ${attributes}>${inner}${!inner || endsWithBreak ? "<br>" : ""}</div>`;
    })
    .join("");
}

/** The least of a DOM node the reader needs, so tests can build their own. */
export type EditableNode = {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<EditableNode>;
  getAttribute?: (name: string) => string | null;
  style?: { fontWeight?: string; fontStyle?: string; textDecoration?: string; textDecorationLine?: string };
};

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const BLOCKS = new Set(["DIV", "P", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"]);

function readJson<T>(node: EditableNode, name: string): T | null {
  const raw = node.getAttribute?.(name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeWeight(value: string): string | undefined {
  if (!value) return undefined;
  if (value === "bold" || value === "bolder") return "700";
  if (value === "normal" || value === "lighter") return "400";
  return /^\d+$/.test(value) ? value : undefined;
}

/** Emphasis the browser added around runs: tags, or a span's own style. */
type Emphasis = { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean };

/** A run's own span after editing: its saved format, with any style the browser changed on it. */
function ownFormat(node: EditableNode, own: TextRunFormat): TextRunFormat {
  const format = { ...own };
  const style = node.style;
  if (!style) return format;
  const weight = normalizeWeight(style.fontWeight ?? "");
  if (weight && weight !== format.fontWeight) format.fontWeight = weight;
  if (style.fontStyle) {
    const italic = style.fontStyle === "italic" || style.fontStyle === "oblique";
    if (italic !== (format.fontStyle === "italic")) format.fontStyle = italic ? "italic" : "normal";
  }
  // Its span always says its decoration, so one that is missing was removed.
  const decoration = `${style.textDecorationLine ?? ""} ${style.textDecoration ?? ""}`;
  const underline = decoration.includes("underline");
  const strike = decoration.includes("line-through");
  if (underline !== Boolean(format.underline)) format.underline = underline;
  if (strike !== Boolean(format.strike)) format.strike = strike;
  return format;
}

/** The emphasis inside an element the browser made. */
function emphasisInside(node: EditableNode, outside: Emphasis): Emphasis {
  const emphasis = { ...outside };
  const name = node.nodeName.toUpperCase();
  if (name === "B" || name === "STRONG") emphasis.bold = true;
  if (name === "I" || name === "EM") emphasis.italic = true;
  if (name === "U") emphasis.underline = true;
  if (name === "S" || name === "STRIKE" || name === "DEL") emphasis.strike = true;
  const style = node.style;
  if (style) {
    const weight = normalizeWeight(style.fontWeight ?? "");
    if (weight) emphasis.bold = Number.parseInt(weight, 10) >= 600;
    if (style.fontStyle === "italic" || style.fontStyle === "oblique") emphasis.italic = true;
    else if (style.fontStyle === "normal") emphasis.italic = false;
    const decoration = `${style.textDecorationLine ?? ""} ${style.textDecoration ?? ""}`;
    if (decoration.includes("underline")) emphasis.underline = true;
    if (decoration.includes("line-through")) emphasis.strike = true;
  }
  return emphasis;
}

function withEmphasis(format: TextRunFormat, emphasis: Emphasis): TextRunFormat {
  const next = { ...format };
  const bold = Number.parseInt(next.fontWeight ?? "400", 10) >= 600;
  if (emphasis.bold === true && !bold) next.fontWeight = "700";
  if (emphasis.bold === false && bold) next.fontWeight = "400";
  if (emphasis.italic !== undefined && emphasis.italic !== (next.fontStyle === "italic")) {
    next.fontStyle = emphasis.italic ? "italic" : "normal";
  }
  if (emphasis.underline && !next.underline) next.underline = true;
  if (emphasis.strike && !next.strike) next.strike = true;
  return next;
}

const sameFormat = (a: TextRunFormat, b: TextRunFormat) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof TextRunFormat>;
  for (const key of keys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  }
  return true;
};

function mergeRuns(runs: SlideTextRun[]): SlideTextRun[] {
  const merged: SlideTextRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && sameFormat(splitRun(last).format, splitRun(run).format)) {
      merged[merged.length - 1] = { ...last, text: last.text + run.text };
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

/** The edited HTML back into the box, keeping everything the edit left alone. */
export function editableToTextBody(root: EditableNode, previous: SlideTextBody): SlideTextBody {
  const firstParagraph = previous.paragraphs?.[0];
  let lastParagraph: TextParagraphFormat = firstParagraph ? splitParagraph(firstParagraph).format : {};
  let lastRun: TextRunFormat = firstParagraph?.runs[0] ? splitRun(firstParagraph.runs[0]).format : {};

  const paragraphs: SlideTextParagraph[] = [];
  let current: { format: TextParagraphFormat; defaultRun: TextRunFormat | null; runs: SlideTextRun[] } | null = null;

  const open = (format: TextParagraphFormat, defaultRun: TextRunFormat | null) => {
    current = { format, defaultRun, runs: [] };
  };
  const close = () => {
    if (!current) return;
    const runs = mergeRuns(current.runs.filter((run) => run.text.length > 0));
    paragraphs.push({
      ...current.format,
      runs: runs.length > 0 ? runs : current.defaultRun ? [{ ...current.defaultRun, text: "" }] : [],
    });
    lastParagraph = current.format;
    current = null;
  };
  const addText = (text: string, format: TextRunFormat) => {
    const paragraph = current ?? { format: lastParagraph, defaultRun: lastRun, runs: [] };
    current = paragraph;
    paragraph.runs.push({ ...format, text });
    lastRun = format;
  };

  const walkInline = (
    node: EditableNode,
    outside: TextRunFormat,
    emphasis: Emphasis,
    atBlockEnd: boolean,
  ) => {
    if (node.nodeType === TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\u00a0/g, " ").replace(/\u200b/g, "");
      if (text) addText(text, withEmphasis(outside, emphasis));
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const name = node.nodeName.toUpperCase();
    if (name === "BR") {
      // A block's last <br> only gives an empty line its height.
      if (!atBlockEnd) addText("\n", withEmphasis(outside, emphasis));
      else if (!current) open(lastParagraph, lastRun);
      return;
    }
    if (BLOCKS.has(name)) {
      walkBlock(node);
      return;
    }
    const own = readJson<TextRunFormat>(node, "data-run");
    const format = own ? ownFormat(node, own) : outside;
    const inside = own ? emphasis : emphasisInside(node, emphasis);
    const children = Array.from(node.childNodes);
    children.forEach((child, index) =>
      walkInline(child, format, inside, atBlockEnd && index === children.length - 1),
    );
  };

  const walkBlock = (node: EditableNode) => {
    close();
    const format = readJson<TextParagraphFormat>(node, "data-paragraph") ?? lastParagraph;
    const defaultRun = readJson<TextRunFormat>(node, "data-default-run");
    open(format, defaultRun);
    const inside = defaultRun ?? lastRun;
    const children = Array.from(node.childNodes);
    children.forEach((child, index) => {
      if (!current) open(format, defaultRun);
      walkInline(child, inside, {}, index === children.length - 1);
    });
    close();
  };

  const children = Array.from(root.childNodes);
  children.forEach((child, index) => walkInline(child, lastRun, {}, index === children.length - 1));
  close();

  return {
    ...previous,
    paragraphs:
      paragraphs.length > 0
        ? paragraphs
        : [{ ...lastParagraph, runs: firstParagraph?.runs[0] ? [{ ...lastRun, text: "" }] : [] }],
  };
}

/** The words of a box as plain text: a line for each paragraph. */
export function textBodyPlainText(body: SlideTextBody): string {
  return (body.paragraphs ?? [])
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
    .join("\n");
}

const hasUnderline = (style: SlideElementStyle) =>
  style.fontUnderline === true || (style.textDecoration ?? "").includes("underline");
const hasStrike = (style: SlideElementStyle) => (style.textDecoration ?? "").includes("line-through");

/**
 * An inspector change to an imported box's style, made to its words too.
 *
 * The box's style holds its first run's look, which is what the inspector
 * shows; the runs hold their own, and win when the slide is drawn. So
 * whatever changed in the style is set on every run (or paragraph). A new
 * size scales every run by the same amount, so a title stays larger than
 * the words under it.
 */
export function syncTextBodyWithStyle(previous: SlideElement, next: SlideElement): SlideElement {
  const body = next.textBody;
  if (!body || body !== previous.textBody) return next;
  const before = previous.style ?? {};
  const after = next.style ?? {};
  if (before === after) return next;

  const runPatch: TextRunFormat = {};
  let sizeRatio: number | null = null;
  let sizeAbsolute: number | null = null;

  if (after.fontFamily && after.fontFamily !== before.fontFamily) runPatch.fontFamily = after.fontFamily;
  if (typeof after.fontSize === "number" && after.fontSize !== before.fontSize) {
    if (typeof before.fontSize === "number" && before.fontSize > 0) sizeRatio = after.fontSize / before.fontSize;
    else sizeAbsolute = after.fontSize;
  }
  if (after.fontWeight && after.fontWeight !== before.fontWeight) {
    runPatch.fontWeight = after.fontWeight;
  } else if (after.fontBold !== undefined && after.fontBold !== before.fontBold) {
    runPatch.fontWeight = after.fontBold ? "700" : "400";
  }
  if ((after.fontStyle ?? "normal") !== (before.fontStyle ?? "normal")) {
    runPatch.fontStyle = after.fontStyle ?? "normal";
  }
  if (after.color && after.color !== before.color && after.textFillMode !== "gradient") {
    runPatch.color = after.color;
  }
  if (hasUnderline(after) !== hasUnderline(before)) runPatch.underline = hasUnderline(after);
  if (hasStrike(after) !== hasStrike(before)) runPatch.strike = hasStrike(after);
  if ((after.letterSpacing ?? 0) !== (before.letterSpacing ?? 0)) {
    runPatch.letterSpacing = after.letterSpacing ?? 0;
  }

  const paragraphPatch: TextParagraphFormat = {};
  if (after.textAlign && after.textAlign !== before.textAlign) paragraphPatch.alignment = after.textAlign;
  if (typeof after.lineHeight === "number" && after.lineHeight !== before.lineHeight) {
    paragraphPatch.lineHeight = after.lineHeight;
  }

  const bodyPatch: Partial<SlideTextBody> = {};
  if (after.verticalAlign && after.verticalAlign !== body.verticalAlign) bodyPatch.verticalAlign = after.verticalAlign;
  for (const [padding, inset] of [
    ["paddingLeft", "insetLeft"],
    ["paddingRight", "insetRight"],
    ["paddingTop", "insetTop"],
    ["paddingBottom", "insetBottom"],
  ] as const) {
    const value = after[padding];
    if (typeof value === "number" && value !== before[padding]) bodyPatch[inset] = value;
  }

  const touchesRuns = Object.keys(runPatch).length > 0 || sizeRatio !== null || sizeAbsolute !== null;
  const touchesParagraphs = Object.keys(paragraphPatch).length > 0;
  if (!touchesRuns && !touchesParagraphs && Object.keys(bodyPatch).length === 0) return next;

  const resize = (size: number | undefined) => {
    if (sizeAbsolute !== null) return sizeAbsolute;
    if (sizeRatio !== null && typeof size === "number") return Math.max(1, Math.round(size * sizeRatio * 100) / 100);
    return size;
  };

  return {
    ...next,
    textBody: {
      ...body,
      ...bodyPatch,
      paragraphs: (body.paragraphs ?? []).map((paragraph) => ({
        ...paragraph,
        ...paragraphPatch,
        bullet:
          paragraph.bullet && (sizeRatio !== null || sizeAbsolute !== null) && paragraph.bullet.fontSize !== undefined
            ? { ...paragraph.bullet, fontSize: resize(paragraph.bullet.fontSize) }
            : paragraph.bullet,
        runs: touchesRuns
          ? paragraph.runs.map((run) => {
              const size = resize(run.fontSize);
              return { ...run, ...runPatch, ...(size !== undefined ? { fontSize: size } : {}) };
            })
          : paragraph.runs,
      })),
    },
  };
}

/** The first run's look, as the box's style shows it to the inspector. */
export function styleFromFirstRun(body: SlideTextBody, style: SlideElementStyle | undefined): SlideElementStyle {
  const first = body.paragraphs?.find((paragraph) => paragraph.runs.some((run) => run.text))?.runs[0];
  const next: SlideElementStyle = { ...(style ?? {}) };
  if (!first) return next;
  if (first.fontFamily) next.fontFamily = first.fontFamily;
  if (typeof first.fontSize === "number") next.fontSize = first.fontSize;
  if (first.fontWeight) {
    next.fontWeight = first.fontWeight;
    next.fontBold = Number.parseInt(first.fontWeight, 10) >= 600;
  }
  next.fontStyle = first.fontStyle === "italic" ? "italic" : "normal";
  if (first.color && next.textFillMode !== "gradient") next.color = first.color;
  next.fontUnderline = Boolean(first.underline);
  next.textDecoration =
    [first.underline ? "underline" : "", first.strike ? "line-through" : ""].filter(Boolean).join(" ") || "none";
  return next;
}

/** An imported box after its words were edited in place. */
export function withEditedTextBody(element: SlideElement, root: EditableNode): SlideElement {
  if (!element.textBody) return element;
  const textBody = editableToTextBody(root, element.textBody);
  return {
    ...element,
    textBody,
    content: textBodyPlainText(textBody),
    style: styleFromFirstRun(textBody, element.style),
    isPlaceholder: false,
  };
}
