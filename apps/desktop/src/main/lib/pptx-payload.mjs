// @ts-check

import path from "node:path";

/**
 * What the PPTX importer hands the renderer, built from `parse_pptx.py`'s
 * payload: every shape scaled onto a 1920×1080 slide, groups flattened, text
 * bodies restructured, tables reduced to their text.
 *
 * Moved verbatim out of `pptx-python.service.ts`, which imports it, so
 * `tests/pptx-payload.test.mjs` can pin it and the committed fixtures'
 * expected output can be produced from the real parser before
 * `src-tauri/src/services/pptx` replaces both.
 */

export const TARGET_SLIDE_WIDTH = 1920;
export const TARGET_SLIDE_HEIGHT = 1080;

/** @param {string | undefined} value */
function toVerticalAlign(value) {
  if (value === "top") {
    return "top";
  }
  if (value === "bottom") {
    return "bottom";
  }
  return "middle";
}

/**
 * @param {string | undefined} format
 * @param {string | undefined} data
 */
function toDataUrl(format, data) {
  if (!data) {
    return "";
  }
  const normalizedFormat = (format ?? "png").toLowerCase();
  const mimeType = normalizedFormat === "jpg" ? "jpeg" : normalizedFormat;
  return `data:image/${mimeType};base64,${data}`;
}

/** @param {any} textBody */
function textBodyToPlainText(textBody) {
  return textBody.paragraphs
    .map((/** @type {any} */ paragraph) =>
      paragraph.runs.map((/** @type {any} */ run) => run.text ?? "").join(""),
    )
    .join("\n")
    .trim();
}

/** @param {any} textBody */
function toStructuredTextBody(textBody) {
  return {
    insetLeft: textBody.inset_left_px,
    insetRight: textBody.inset_right_px,
    insetTop: textBody.inset_top_px,
    insetBottom: textBody.inset_bottom_px,
    verticalAlign: toVerticalAlign(textBody.vertical_align),
    wrap: textBody.wrap,
    autoFit: textBody.autofit,
    paragraphs: (textBody.paragraphs ?? []).map((/** @type {any} */ paragraph) => ({
      alignment: paragraph.alignment,
      lineHeight: paragraph.line_spacing,
      spaceBefore: paragraph.space_before_px,
      spaceAfter: paragraph.space_after_px,
      runs: (paragraph.runs ?? []).map((/** @type {any} */ run) => ({
        text: run.text ?? "",
        fontFamily: run.font_name || undefined,
        fontSize: run.font_size_px || undefined,
        fontWeight: run.bold ? "700" : "400",
        fontStyle: run.italic ? "italic" : "normal",
        color: run.color || "#000000",
        underline: run.underline,
        letterSpacing: run.character_spacing_px || 0,
      })),
    })),
  };
}

/**
 * @param {any} textBody
 * @param {number} scaleX
 * @param {number} scaleY
 */
function scaleTextBody(textBody, scaleX, scaleY) {
  if (!textBody) {
    return undefined;
  }

  return {
    ...textBody,
    insetLeft: textBody.insetLeft === undefined ? undefined : textBody.insetLeft * scaleX,
    insetRight: textBody.insetRight === undefined ? undefined : textBody.insetRight * scaleX,
    insetTop: textBody.insetTop === undefined ? undefined : textBody.insetTop * scaleY,
    insetBottom: textBody.insetBottom === undefined ? undefined : textBody.insetBottom * scaleY,
    paragraphs: (textBody.paragraphs ?? []).map((/** @type {any} */ paragraph) => ({
      ...paragraph,
      lineHeight:
        paragraph.lineHeight === undefined
          ? undefined
          : paragraph.lineHeight > 4
            ? paragraph.lineHeight * Math.min(scaleX, scaleY)
            : paragraph.lineHeight,
      spaceBefore: paragraph.spaceBefore === undefined ? undefined : paragraph.spaceBefore * scaleY,
      spaceAfter: paragraph.spaceAfter === undefined ? undefined : paragraph.spaceAfter * scaleY,
      runs: (paragraph.runs ?? []).map((/** @type {any} */ run) => ({
        ...run,
        fontSize: run.fontSize === undefined ? undefined : run.fontSize * Math.min(scaleX, scaleY),
        letterSpacing: run.letterSpacing === undefined ? undefined : run.letterSpacing * scaleX,
      })),
    })),
  };
}

/**
 * @param {any} element
 * @param {number} scaleX
 * @param {number} scaleY
 */
function scaleElement(element, scaleX, scaleY) {
  const style = element.style;
  const scaledStyle = style
    ? {
        ...style,
        fontSize: style.fontSize === undefined ? undefined : style.fontSize * Math.min(scaleX, scaleY),
        borderWidth:
          style.borderWidth === undefined ? undefined : style.borderWidth * Math.min(scaleX, scaleY),
        paddingLeft: style.paddingLeft === undefined ? undefined : style.paddingLeft * scaleX,
        paddingRight: style.paddingRight === undefined ? undefined : style.paddingRight * scaleX,
        paddingTop: style.paddingTop === undefined ? undefined : style.paddingTop * scaleY,
        paddingBottom: style.paddingBottom === undefined ? undefined : style.paddingBottom * scaleY,
      }
    : undefined;

  return {
    ...element,
    x: element.x * scaleX,
    y: element.y * scaleY,
    width: element.width * scaleX,
    height: element.height * scaleY,
    textBody: scaleTextBody(element.textBody, scaleX, scaleY),
    style: scaledStyle,
  };
}

/**
 * @param {any} shape
 * @param {number} slideIndex
 * @param {number} scaleX
 * @param {number} scaleY
 * @returns {any[]}
 */
function flattenShape(shape, slideIndex, scaleX, scaleY) {
  const shapeId = `${slideIndex}_${shape.id ?? shape.name ?? Math.random().toString(36).slice(2)}`;
  const base = {
    id: `pptx_${shapeId}`,
    type: "shape",
    x: shape.x ?? 0,
    y: shape.y ?? 0,
    width: shape.width ?? 0,
    height: shape.height ?? 0,
    content: "",
    style: {
      rotation: shape.rotation ?? 0,
    },
  };

  if (shape.type === "group") {
    const children = shape.children ?? [];
    return children.flatMap((/** @type {any} */ child) => flattenShape(child, slideIndex, scaleX, scaleY));
  }

  if (shape.type === "image") {
    return [
      scaleElement(
        {
          ...base,
          type: "image",
          content: toDataUrl(shape.format, shape.data),
          style: {
            ...base.style,
            objectFit: "fill",
          },
        },
        scaleX,
        scaleY,
      ),
    ];
  }

  if (shape.type === "text" && shape.text_body) {
    const plainText = textBodyToPlainText(shape.text_body);
    const firstParagraph = shape.text_body.paragraphs[0];
    const firstRun = firstParagraph?.runs[0];
    return [
      scaleElement(
        {
          ...base,
          type: "text",
          content: plainText,
          textBody: toStructuredTextBody(shape.text_body),
          style: {
            ...base.style,
            fontFamily: firstRun?.font_name || "Calibri",
            fontSize: firstRun?.font_size_px || 18,
            fontWeight: firstRun?.bold ? "700" : "400",
            fontStyle: firstRun?.italic ? "italic" : "normal",
            textDecoration: firstRun?.underline ? "underline" : "none",
            color: firstRun?.color || "#000000",
            textAlign: firstParagraph?.alignment || "left",
            verticalAlign: toVerticalAlign(shape.text_body.vertical_align),
            paddingLeft: shape.text_body.inset_left_px || 0,
            paddingRight: shape.text_body.inset_right_px || 0,
            paddingTop: shape.text_body.inset_top_px || 0,
            paddingBottom: shape.text_body.inset_bottom_px || 0,
          },
        },
        scaleX,
        scaleY,
      ),
    ];
  }

  if (shape.type === "table" && shape.rows) {
    const tableLines = shape.rows
      .map((/** @type {any} */ row) => {
        const rowText = row.cells
          .map((/** @type {any} */ cell) => {
            const text = textBodyToPlainText(cell.text_body);
            return text.trim();
          })
          .filter((/** @type {string} */ text) => text.length > 0)
          .join(" | ");
        return rowText;
      })
      .filter((/** @type {string} */ line) => line.length > 0)
      .join("\n");

    return [
      scaleElement(
        {
          ...base,
          type: "text",
          content: tableLines,
          textBody: {
            verticalAlign: "top",
            paragraphs: tableLines.split("\n").map((line) => ({
              alignment: "left",
              runs: [
                {
                  text: line,
                  fontFamily: "Calibri",
                  fontSize: 16,
                  fontWeight: "400",
                  fontStyle: "normal",
                  color: "#000000",
                },
              ],
            })),
          },
          style: {
            ...base.style,
            textAlign: "left",
            verticalAlign: "top",
            color: "#000000",
          },
        },
        scaleX,
        scaleY,
      ),
    ];
  }

  if (shape.type === "shape" || shape.type === "line") {
    return [
      scaleElement(
        {
          ...base,
          type: "shape",
          style: {
            ...base.style,
            backgroundColor: shape.fill_color ?? "transparent",
            borderColor: shape.line_color ?? "transparent",
            borderWidth: shape.line_width_px ?? 0,
          },
        },
        scaleX,
        scaleY,
      ),
    ];
  }

  return [];
}

/**
 * @param {any} payload `parse_pptx.py --mode pptx` output
 * @param {string} filePath
 * @returns {import("../../shared/types/pptx").ParsedPptxPresentation}
 */
export function convertPayloadToPresentation(payload, filePath) {
  const sourceWidth = payload.slide_width_px || TARGET_SLIDE_WIDTH;
  const sourceHeight = payload.slide_height_px || TARGET_SLIDE_HEIGHT;
  const scaleX = TARGET_SLIDE_WIDTH / sourceWidth;
  const scaleY = TARGET_SLIDE_HEIGHT / sourceHeight;

  const slides = payload.slides.map((/** @type {any} */ slide, /** @type {number} */ slideIndex) => {
    /** @type {any[]} */
    const slideElements = [];

    if (slide.background?.type === "image" && slide.background.data) {
      slideElements.push(
        scaleElement(
          {
            id: `pptx_bg_${slideIndex + 1}`,
            type: "image",
            x: 0,
            y: 0,
            width: sourceWidth,
            height: sourceHeight,
            content: toDataUrl(slide.background.format, slide.background.data),
            style: {
              objectFit: "fill",
            },
          },
          scaleX,
          scaleY,
        ),
      );
    }

    for (const shape of slide.shapes ?? []) {
      slideElements.push(...flattenShape(shape, slideIndex + 1, scaleX, scaleY));
    }

    const textContent = slideElements
      .filter((element) => element.type === "text")
      .map((element) => element.content)
      .join("\n")
      .trim();

    return {
      id: `pptx:${slideIndex + 1}`,
      title: `Slide ${slideIndex + 1}`,
      backgroundColor: slide.background?.type === "solid" ? slide.background.color ?? null : null,
      elements: slideElements,
      textContent,
    };
  });

  return {
    title: path.basename(filePath, path.extname(filePath)) || "Imported presentation",
    slideWidthPx: TARGET_SLIDE_WIDTH,
    slideHeightPx: TARGET_SLIDE_HEIGHT,
    slides,
  };
}
