import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { SlideElement } from "../../shared/types";
import type { ParsedPptxPresentation, ParsedPptxSlide } from "../../shared/types/pptx";

const EMUS_PER_INCH = 914400;
const PX_PER_INCH = 96;
const THEME_COLOR_ALIAS_MAP: Record<string, string> = {
  bg1: "lt1",
  bg2: "lt2",
  tx1: "dk1",
  tx2: "dk2",
  text1: "dk1",
  text2: "dk2",
};
const THEME_REVERSE_ALIAS_MAP: Record<string, string[]> = {
  lt1: ["bg1"],
  lt2: ["bg2"],
  dk1: ["tx1", "text1"],
  dk2: ["tx2", "text2"],
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: false,
});

type XmlRecord = Record<string, unknown>;
type RelationshipMap = Map<string, string>;
type ThemePalette = Record<string, string>;
type PlaceholderMap = Map<string, XmlRecord>;
type GroupTransform = {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  childOffsetX: number;
  childOffsetY: number;
};

type ShapeContext = {
  zip: JSZip;
  relationships: RelationshipMap;
  themePalette: ThemePalette;
  slideWidthPx: number;
  slideHeightPx: number;
};

function asRecord(value: unknown): XmlRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlRecord)
    : null;
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [value];
}

function findNodeValue(record: XmlRecord | null, suffix: string) {
  if (!record) {
    return undefined;
  }
  return Object.entries(record).find(
    ([key]) => key === suffix || key.endsWith(`:${suffix}`),
  )?.[1];
}

function getChild(record: XmlRecord | null, suffix: string) {
  return findNodeValue(record, suffix);
}

function getAttr(record: XmlRecord | null, attrName: string) {
  if (!record) {
    return undefined;
  }
  return Object.entries(record).find(([key]) => {
    if (!key.startsWith("@_")) {
      return false;
    }
    const normalized = key.slice(2);
    return normalized === attrName || normalized.endsWith(`:${attrName}`);
  })?.[1];
}

function getStringAttr(record: XmlRecord | null, attrName: string) {
  const value = getAttr(record, attrName);
  return typeof value === "string" ? value : undefined;
}

function getNumberAttr(record: XmlRecord | null, attrName: string) {
  const value = getAttr(record, attrName);
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function getStringValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return `${value}`;
  }
  if (value && typeof value === "object" && "#text" in value) {
    const textNode = (value as Record<string, unknown>)["#text"];
    return typeof textNode === "string" ? textNode : (typeof textNode === "number" ? `${textNode}` : "");
  }
  return "";
}

function emuToPx(value: number | string | undefined) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : NaN;
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return (numeric / EMUS_PER_INCH) * PX_PER_INCH;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeColor(value: string | undefined) {
  if (!value) {
    return null;
  }
  const sanitized = value.replace(/^#/, "").trim();
  if (!/^[0-9a-f]{6}$/i.test(sanitized)) {
    return null;
  }
  return `#${sanitized.toUpperCase()}`;
}

function applyTintToColor(hex: string, tintValue: number) {
  if (!Number.isFinite(tintValue)) {
    return hex;
  }
  const clampedTint = Math.min(Math.max(tintValue, 0), 100000) / 100000;
  const channels = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const tinted = channels.map((channel) =>
    Math.round(channel + (255 - channel) * clampedTint),
  );
  return `#${tinted.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function applyShadeToColor(hex: string, shadeValue: number) {
  if (!Number.isFinite(shadeValue)) {
    return hex;
  }
  const clampedShade = Math.min(Math.max(shadeValue, 0), 100000) / 100000;
  const channels = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const shaded = channels.map((channel) => Math.round(channel * clampedShade));
  return `#${shaded.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function resolveThemePaletteColor(themePalette: ThemePalette, key: string | undefined) {
  const normalizedKey = key?.trim().toLowerCase() ?? "";
  if (!normalizedKey) {
    return null;
  }

  const directColor = normalizeColor(themePalette[normalizedKey]);
  if (directColor) {
    return directColor;
  }

  const aliasKey = THEME_COLOR_ALIAS_MAP[normalizedKey];
  if (!aliasKey) {
    return null;
  }

  return normalizeColor(themePalette[aliasKey]);
}

function resolveColorNode(node: XmlRecord | null, themePalette: ThemePalette) {
  if (!node) {
    return null;
  }

  const solidFill = asRecord(getChild(node, "solidFill")) ?? node;
  const srgbClr = asRecord(getChild(solidFill, "srgbClr"));
  const schemeClr = asRecord(getChild(solidFill, "schemeClr"));
  const sysClr = asRecord(getChild(solidFill, "sysClr"));

  let resolvedHex =
    normalizeColor(getStringAttr(srgbClr, "val")) ??
    normalizeColor(getStringAttr(sysClr, "lastClr")) ??
    resolveThemePaletteColor(
      themePalette,
      getStringAttr(schemeClr, "val") ?? getStringAttr(solidFill, "val"),
    );

  if (!resolvedHex) {
    return null;
  }

  const tint = getNumberAttr(schemeClr, "tint");
  const shade = getNumberAttr(schemeClr, "shade");

  if (tint !== undefined) {
    resolvedHex = applyTintToColor(resolvedHex.replace("#", ""), tint);
  }
  if (shade !== undefined) {
    resolvedHex = applyShadeToColor(resolvedHex.replace("#", ""), shade);
  }

  return resolvedHex.startsWith("#") ? resolvedHex : `#${resolvedHex}`;
}

function inferMimeTypeFromFilePath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  return "image/png";
}

function getRelationshipBaseDir(relationshipPath: string) {
  const normalizedPath = path.posix.normalize(relationshipPath);
  const relationshipDir = path.posix.dirname(normalizedPath);

  if (path.posix.basename(relationshipDir) === "_rels") {
    return path.posix.dirname(relationshipDir);
  }

  return relationshipDir;
}

function resolveZipTargetPath(relationshipPath: string, target: string) {
  const normalizedTarget = target.trim();
  if (!normalizedTarget) {
    return null;
  }

  // External targets (http(s), mailto, etc.) are not entries inside the PPTX zip.
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalizedTarget) || normalizedTarget.startsWith("//")) {
    return null;
  }

  const zipRelativeTarget = normalizedTarget.startsWith("/")
    ? normalizedTarget.slice(1)
    : normalizedTarget;

  return path.posix.normalize(
    path.posix.join(getRelationshipBaseDir(relationshipPath), zipRelativeTarget),
  );
}

async function readXmlEntry(zip: JSZip, entryPath: string) {
  const file = zip.file(entryPath);
  if (!file) {
    return null;
  }

  const content = await file.async("text");
  return asRecord(xmlParser.parse(content));
}

async function readRelationships(zip: JSZip, entryPath: string) {
  const relationshipDocument = await readXmlEntry(zip, entryPath);
  const relationshipsRoot =
    asRecord(getChild(relationshipDocument, "Relationships")) ?? relationshipDocument;
  const relationshipEntries = toArray(
    getChild(relationshipsRoot, "Relationship"),
  ).map((entry) => asRecord(entry)).filter(Boolean) as XmlRecord[];
  const relationships = new Map<string, string>();

  for (const entry of relationshipEntries) {
    const id = getStringAttr(entry, "Id");
    const target = getStringAttr(entry, "Target");
    const targetMode = getStringAttr(entry, "TargetMode");
    if (!id || !target) {
      continue;
    }

    if (targetMode?.toLowerCase() === "external") {
      continue;
    }

    const resolvedTarget = resolveZipTargetPath(entryPath, target);
    if (!resolvedTarget) {
      continue;
    }

    relationships.set(id, resolvedTarget);
  }

  return relationships;
}

async function readBinaryDataUrl(zip: JSZip, entryPath: string) {
  const file = zip.file(entryPath);
  if (!file) {
    return null;
  }

  const base64 = await file.async("base64");
  return `data:${inferMimeTypeFromFilePath(entryPath)};base64,${base64}`;
}

function buildThemePalette(themeDocument: XmlRecord | null) {
  const palette: ThemePalette = {};
  const themeRoot = asRecord(getChild(themeDocument, "theme")) ?? themeDocument;
  const themeElements = asRecord(getChild(themeRoot, "themeElements"));
  const clrScheme = asRecord(getChild(themeElements, "clrScheme"));

  if (!clrScheme) {
    return palette;
  }

  for (const [key, value] of Object.entries(clrScheme)) {
    if (key.startsWith("@_")) {
      continue;
    }

    const normalizedKey = key.includes(":") ? key.split(":").pop() ?? key : key;
    const normalizedPaletteKey = normalizedKey.toLowerCase();
    const resolved = resolveColorNode(asRecord(value), palette);
    if (resolved) {
      palette[normalizedPaletteKey] = resolved;

      for (const alias of THEME_REVERSE_ALIAS_MAP[normalizedPaletteKey] ?? []) {
        if (!palette[alias]) {
          palette[alias] = resolved;
        }
      }
    }
  }

  return palette;
}

function getPlaceholderKey(node: XmlRecord | null) {
  const nvSpPr = asRecord(getChild(node, "nvSpPr")) ?? asRecord(getChild(node, "nvPicPr"));
  const nvPr = asRecord(getChild(nvSpPr, "nvPr"));
  const ph = asRecord(getChild(nvPr, "ph"));

  if (!ph) {
    return null;
  }

  const type = getStringAttr(ph, "type") ?? "body";
  const index = getStringAttr(ph, "idx") ?? "0";
  return `${type}:${index}`;
}

function buildPlaceholderMap(spTree: XmlRecord | null) {
  const placeholderMap: PlaceholderMap = new Map();

  for (const shape of toArray(getChild(spTree, "sp"))) {
    const record = asRecord(shape);
    if (!record) {
      continue;
    }
    const key = getPlaceholderKey(record);
    if (key) {
      placeholderMap.set(key, record);
    }
  }

  return placeholderMap;
}

function resolveShapeBounds(
  shapeNode: XmlRecord | null,
  inheritedNode?: XmlRecord | null,
  groupTransform?: GroupTransform,
) {
  const spPr = asRecord(getChild(shapeNode, "spPr")) ?? asRecord(getChild(inheritedNode, "spPr"));
  const xfrm = asRecord(getChild(spPr, "xfrm"));
  const off = asRecord(getChild(xfrm, "off"));
  const ext = asRecord(getChild(xfrm, "ext"));

  let x = emuToPx(getNumberAttr(off, "x"));
  let y = emuToPx(getNumberAttr(off, "y"));
  let width = emuToPx(getNumberAttr(ext, "cx"));
  let height = emuToPx(getNumberAttr(ext, "cy"));

  if (groupTransform) {
    x = groupTransform.offsetX + (x - groupTransform.childOffsetX) * groupTransform.scaleX;
    y = groupTransform.offsetY + (y - groupTransform.childOffsetY) * groupTransform.scaleY;
    width *= groupTransform.scaleX;
    height *= groupTransform.scaleY;
  }

  return {
    x,
    y,
    width,
    height,
    rotation: ((getNumberAttr(xfrm, "rot") ?? 0) / 60000) || 0,
    flipX: getStringAttr(xfrm, "flipH") === "1",
    flipY: getStringAttr(xfrm, "flipV") === "1",
  };
}

function buildGroupTransform(groupNode: XmlRecord | null, inheritedGroup?: GroupTransform) {
  const grpSpPr = asRecord(getChild(groupNode, "grpSpPr"));
  const xfrm = asRecord(getChild(grpSpPr, "xfrm"));
  const off = asRecord(getChild(xfrm, "off"));
  const ext = asRecord(getChild(xfrm, "ext"));
  const chOff = asRecord(getChild(xfrm, "chOff"));
  const chExt = asRecord(getChild(xfrm, "chExt"));

  const current: GroupTransform = {
    offsetX: emuToPx(getNumberAttr(off, "x")),
    offsetY: emuToPx(getNumberAttr(off, "y")),
    scaleX: (() => {
      const childWidth = emuToPx(getNumberAttr(chExt, "cx"));
      const groupWidth = emuToPx(getNumberAttr(ext, "cx"));
      return childWidth > 0 ? groupWidth / childWidth : 1;
    })(),
    scaleY: (() => {
      const childHeight = emuToPx(getNumberAttr(chExt, "cy"));
      const groupHeight = emuToPx(getNumberAttr(ext, "cy"));
      return childHeight > 0 ? groupHeight / childHeight : 1;
    })(),
    childOffsetX: emuToPx(getNumberAttr(chOff, "x")),
    childOffsetY: emuToPx(getNumberAttr(chOff, "y")),
  };

  if (!inheritedGroup) {
    return current;
  }

  return {
    offsetX:
      inheritedGroup.offsetX +
      (current.offsetX - inheritedGroup.childOffsetX) * inheritedGroup.scaleX,
    offsetY:
      inheritedGroup.offsetY +
      (current.offsetY - inheritedGroup.childOffsetY) * inheritedGroup.scaleY,
    scaleX: inheritedGroup.scaleX * current.scaleX,
    scaleY: inheritedGroup.scaleY * current.scaleY,
    childOffsetX: inheritedGroup.childOffsetX + current.childOffsetX,
    childOffsetY: inheritedGroup.childOffsetY + current.childOffsetY,
  };
}

function extractParagraphRuns(paragraphNode: XmlRecord | null) {
  return [
    ...toArray(getChild(paragraphNode, "r")).map((entry) => asRecord(entry)),
    ...toArray(getChild(paragraphNode, "fld")).map((entry) => asRecord(entry)),
  ].filter(Boolean) as XmlRecord[];
}

function getRunText(runNode: XmlRecord | null) {
  const textNode = getChild(runNode, "t");
  return getStringValue(textNode);
}

function buildTextRunHtml(runNode: XmlRecord | null, themePalette: ThemePalette) {
  const runProperties = asRecord(getChild(runNode, "rPr"));
  const text = getRunText(runNode);
  const fontFamily =
    getStringAttr(asRecord(getChild(runProperties, "latin")), "typeface") ??
    getStringAttr(asRecord(getChild(runProperties, "ea")), "typeface") ??
    getStringAttr(asRecord(getChild(runProperties, "cs")), "typeface");
  const fontSize = getNumberAttr(runProperties, "sz");
  const color = resolveColorNode(runProperties, themePalette);
  const underline = getStringAttr(runProperties, "u");
  const styleTokens = [
    fontFamily ? `font-family:${JSON.stringify(fontFamily)}` : "",
    fontSize ? `font-size:${Math.max((fontSize / 100) * (96 / 72), 8)}px` : "",
    getStringAttr(runProperties, "b") === "1" ? "font-weight:700" : "",
    getStringAttr(runProperties, "i") === "1" ? "font-style:italic" : "",
    color ? `color:${color}` : "",
    underline && underline !== "none" ? "text-decoration:underline" : "",
  ].filter(Boolean);

  const escaped = escapeHtml(text);
  if (styleTokens.length === 0) {
    return escaped;
  }

  return `<span style="${styleTokens.join(";")}">${escaped}</span>`;
}

function extractTextContent(shapeNode: XmlRecord | null, inheritedNode: XmlRecord | null, themePalette: ThemePalette) {
  const txBody = asRecord(getChild(shapeNode, "txBody")) ?? asRecord(getChild(inheritedNode, "txBody"));
  if (!txBody) {
    return null;
  }

  const paragraphs = toArray(getChild(txBody, "p"))
    .map((entry) => asRecord(entry))
    .filter(Boolean) as XmlRecord[];

  const textLines: string[] = [];
  const htmlLines: string[] = [];

  for (const paragraph of paragraphs) {
    const runs = extractParagraphRuns(paragraph);
    if (runs.length === 0) {
      const paragraphText = getStringValue(getChild(paragraph, "t"));
      textLines.push(paragraphText);
      htmlLines.push(escapeHtml(paragraphText));
      continue;
    }

    const lineText = runs.map((run) => getRunText(run)).join("");
    const lineHtml = runs.map((run) => buildTextRunHtml(run, themePalette)).join("");
    textLines.push(lineText);
    htmlLines.push(lineHtml);
  }

  const bodyPr =
    asRecord(getChild(txBody, "bodyPr")) ??
    asRecord(getChild(asRecord(getChild(inheritedNode, "txBody")), "bodyPr"));
  const firstParagraph = paragraphs[0] ?? null;
  const paragraphProps = asRecord(getChild(firstParagraph, "pPr"));
  const firstRun = extractParagraphRuns(firstParagraph)[0] ?? null;
  const firstRunProps = asRecord(getChild(firstRun, "rPr"));
  const fontFamily =
    getStringAttr(asRecord(getChild(firstRunProps, "latin")), "typeface") ??
    getStringAttr(asRecord(getChild(firstRunProps, "ea")), "typeface") ??
    getStringAttr(asRecord(getChild(firstRunProps, "cs")), "typeface") ??
    "sans-serif";

  return {
    text: textLines.join("\n"),
    richTextHtml: htmlLines.join("<br/>"),
    fontFamily,
    fontSize: (() => {
      const rawSize = getNumberAttr(firstRunProps, "sz");
      return rawSize ? Math.max((rawSize / 100) * (96 / 72), 8) : 32;
    })(),
    fontWeight: getStringAttr(firstRunProps, "b") === "1" ? "700" : "400",
    fontStyle: getStringAttr(firstRunProps, "i") === "1" ? "italic" : "normal",
    color:
      resolveColorNode(firstRunProps, themePalette) ??
      resolveThemePaletteColor(themePalette, "tx1") ??
      "#000000",
    textAlign: (() => {
      const alignment = getStringAttr(paragraphProps, "algn");
      if (alignment === "l") return "left";
      if (alignment === "r") return "right";
      if (alignment === "just") return "justify";
      return "center";
    })() as "left" | "center" | "right" | "justify",
    verticalAlign: (() => {
      const anchor = getStringAttr(bodyPr, "anchor");
      if (anchor === "t") return "top";
      if (anchor === "b") return "bottom";
      return "middle";
    })() as "top" | "middle" | "bottom",
    paddingLeft: emuToPx(getNumberAttr(bodyPr, "lIns")),
    paddingRight: emuToPx(getNumberAttr(bodyPr, "rIns")),
    paddingTop: emuToPx(getNumberAttr(bodyPr, "tIns")),
    paddingBottom: emuToPx(getNumberAttr(bodyPr, "bIns")),
  };
}

function extractShapeFill(shapeNode: XmlRecord | null, inheritedNode: XmlRecord | null, themePalette: ThemePalette) {
  const spPr = asRecord(getChild(shapeNode, "spPr")) ?? asRecord(getChild(inheritedNode, "spPr"));
  return {
    fillColor: resolveColorNode(asRecord(getChild(spPr, "solidFill")), themePalette),
    borderColor: resolveColorNode(asRecord(getChild(spPr, "ln")), themePalette),
    borderWidth: emuToPx(getNumberAttr(asRecord(getChild(spPr, "ln")), "w")),
  };
}

async function extractPictureElement(
  pictureNode: XmlRecord,
  context: ShapeContext,
  groupTransform?: GroupTransform,
): Promise<SlideElement> {
  const bounds = resolveShapeBounds(pictureNode, null, groupTransform);
  const blipFill = asRecord(getChild(pictureNode, "blipFill"));
  const blip = asRecord(getChild(blipFill, "blip"));
  const relationshipId = getStringAttr(blip, "r:embed");
  const mediaPath = relationshipId ? context.relationships.get(relationshipId) : null;
  const imageDataUrl = mediaPath ? await readBinaryDataUrl(context.zip, mediaPath) : null;

  return {
    id: getStringAttr(asRecord(getChild(asRecord(getChild(pictureNode, "nvPicPr")), "cNvPr")), "id") ??
      `pptx_image_${crypto.randomUUID()}`,
    type: "image",
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    content:
      imageDataUrl ??
      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgwIiBoZWlnaHQ9IjcyMCIgdmlld0JveD0iMCAwIDEyODAgNzIwIj48cmVjdCB3aWR0aD0iMTI4MCIgaGVpZ2h0PSI3MjAiIGZpbGw9IiM1YjVmNjYiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZmlsbD0iI2Y5ZmFmYiIgZm9udC1zaXplPSI0MiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+SW1hZ2UgVW5hdmFpbGFibGU8L3RleHQ+PC9zdmc+",
    style: {
      rotation: bounds.rotation,
      flipX: bounds.flipX,
      flipY: bounds.flipY,
      objectFit: "fill",
    },
  };
}

async function extractShapeElements(
  shapeNode: XmlRecord,
  context: ShapeContext,
  inheritedNode?: XmlRecord | null,
  groupTransform?: GroupTransform,
): Promise<SlideElement[]> {
  const textContent = extractTextContent(
    shapeNode,
    inheritedNode ?? null,
    context.themePalette,
  );
  const bounds = resolveShapeBounds(shapeNode, inheritedNode ?? null, groupTransform);
  const fill = extractShapeFill(shapeNode, inheritedNode ?? null, context.themePalette);
  const elementId =
    getStringAttr(
      asRecord(getChild(asRecord(getChild(shapeNode, "nvSpPr")), "cNvPr")),
      "id",
    ) ?? `pptx_shape_${crypto.randomUUID()}`;

  if (textContent && textContent.text.trim().length > 0) {
    return [
      {
        id: `${elementId}_text`,
        type: "text",
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        content: textContent.text,
        richTextHtml: textContent.richTextHtml,
        style: {
          fontFamily: textContent.fontFamily,
          fontSize: textContent.fontSize,
          fontWeight: textContent.fontWeight,
          fontStyle: textContent.fontStyle,
          color: textContent.color,
          textAlign: textContent.textAlign,
          verticalAlign: textContent.verticalAlign,
          paddingLeft: textContent.paddingLeft,
          paddingRight: textContent.paddingRight,
          paddingTop: textContent.paddingTop,
          paddingBottom: textContent.paddingBottom,
          rotation: bounds.rotation,
          flipX: bounds.flipX,
          flipY: bounds.flipY,
        },
      },
    ];
  }

  if (!fill.fillColor && !fill.borderColor) {
    return [];
  }

  return [
    {
      id: `${elementId}_shape`,
      type: "shape",
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      content: "",
      style: {
        backgroundColor: fill.fillColor ?? "transparent",
        borderColor: fill.borderColor ?? "transparent",
        borderWidth: fill.borderWidth,
        rotation: bounds.rotation,
        flipX: bounds.flipX,
        flipY: bounds.flipY,
      },
    },
  ];
}

async function extractNodeElements(
  node: XmlRecord,
  context: ShapeContext,
  layoutPlaceholders: PlaceholderMap,
  masterPlaceholders: PlaceholderMap,
  groupTransform?: GroupTransform,
): Promise<SlideElement[]> {
  const results: SlideElement[] = [];

  for (const shape of toArray(getChild(node, "sp"))) {
    const record = asRecord(shape);
    if (!record) {
      continue;
    }

    try {
      const placeholderKey = getPlaceholderKey(record);
      const inheritedNode =
        (placeholderKey ? layoutPlaceholders.get(placeholderKey) : null) ??
        (placeholderKey ? masterPlaceholders.get(placeholderKey) : null) ??
        null;
      results.push(
        ...(await extractShapeElements(record, context, inheritedNode, groupTransform)),
      );
    } catch {
      continue;
    }
  }

  for (const picture of toArray(getChild(node, "pic"))) {
    const record = asRecord(picture);
    if (!record) {
      continue;
    }

    try {
      results.push(await extractPictureElement(record, context, groupTransform));
    } catch {
      continue;
    }
  }

  for (const group of toArray(getChild(node, "grpSp"))) {
    const record = asRecord(group);
    if (!record) {
      continue;
    }

    try {
      results.push(
        ...(await extractNodeElements(
          record,
          context,
          layoutPlaceholders,
          masterPlaceholders,
          buildGroupTransform(record, groupTransform),
        )),
      );
    } catch {
      continue;
    }
  }

  return results;
}

async function resolveBackground(
  zip: JSZip,
  node: XmlRecord | null,
  relationships: RelationshipMap,
  themePalette: ThemePalette,
  slideWidthPx: number,
  slideHeightPx: number,
): Promise<{ backgroundColor: string | null; backgroundElement: SlideElement | null }> {
  const cSld = asRecord(getChild(node, "cSld")) ?? node;
  const bg = asRecord(getChild(cSld, "bg"));
  const bgPr = asRecord(getChild(bg, "bgPr"));
  const bgRef = asRecord(getChild(bg, "bgRef"));

  const backgroundColor =
    resolveColorNode(bgPr, themePalette) ?? resolveColorNode(bgRef, themePalette);
  const blipFill = asRecord(getChild(bgPr, "blipFill"));
  const blip = asRecord(getChild(blipFill, "blip"));
  const relationshipId = getStringAttr(blip, "r:embed");
  const mediaPath = relationshipId ? relationships.get(relationshipId) : null;
  const dataUrl = mediaPath ? await readBinaryDataUrl(zip, mediaPath) : null;

  return {
    backgroundColor,
    backgroundElement: dataUrl
      ? {
          id: `pptx_background_${crypto.randomUUID()}`,
          type: "image",
          x: 0,
          y: 0,
          width: slideWidthPx,
          height: slideHeightPx,
          content: dataUrl,
          style: {
            objectFit: "cover",
          },
        }
      : null,
  };
}

function pickPreferredBackground(
  ...candidates: Array<{ backgroundColor: string | null; backgroundElement: SlideElement | null }>
) {
  return (
    candidates.find(
      (candidate) => Boolean(candidate.backgroundColor || candidate.backgroundElement),
    ) ?? {
      backgroundColor: null,
      backgroundElement: null,
    }
  );
}

function scaleElements(
  elements: SlideElement[],
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  const scaleX = sourceWidth > 0 ? targetWidth / sourceWidth : 1;
  const scaleY = sourceHeight > 0 ? targetHeight / sourceHeight : 1;

  const scaleOptional = (value: number | undefined, multiplier: number) =>
    value === undefined ? value : value * multiplier;

  return elements.map((element) => ({
    ...element,
    x: Math.round(element.x * scaleX),
    y: Math.round(element.y * scaleY),
    width: Math.round(element.width * scaleX),
    height: Math.round(element.height * scaleY),
    style: element.style
      ? {
          ...element.style,
          fontSize:
            element.style.fontSize === undefined
              ? undefined
              : Math.round(element.style.fontSize * Math.min(scaleX, scaleY)),
          borderWidth: scaleOptional(
            element.style.borderWidth,
            Math.min(scaleX, scaleY),
          ),
          paddingLeft: scaleOptional(element.style.paddingLeft, scaleX),
          paddingRight: scaleOptional(element.style.paddingRight, scaleX),
          paddingTop: scaleOptional(element.style.paddingTop, scaleY),
          paddingBottom: scaleOptional(element.style.paddingBottom, scaleY),
        }
      : element.style,
  }));
}

export async function parsePptxFile(filePath: string): Promise<ParsedPptxPresentation> {
  const fileBuffer = await fs.promises.readFile(filePath);
  const zip = await JSZip.loadAsync(fileBuffer);
  const presentationDocument = await readXmlEntry(zip, "ppt/presentation.xml");
  const presentationRoot =
    asRecord(getChild(presentationDocument, "presentation")) ?? presentationDocument;
  const slideSizeNode = asRecord(getChild(presentationRoot, "sldSz"));
  const slideWidthPx = Math.max(1, emuToPx(getNumberAttr(slideSizeNode, "cx")));
  const slideHeightPx = Math.max(1, emuToPx(getNumberAttr(slideSizeNode, "cy")));

  const presentationRelationships = await readRelationships(
    zip,
    "ppt/_rels/presentation.xml.rels",
  );
  const slideIds = toArray(getChild(asRecord(getChild(presentationRoot, "sldIdLst")), "sldId"))
    .map((entry) => asRecord(entry))
    .filter(Boolean) as XmlRecord[];
  const slidePaths = slideIds
    .map((slide) => {
      const relationshipId = getStringAttr(slide, "r:id");
      return relationshipId ? presentationRelationships.get(relationshipId) ?? null : null;
    })
    .filter((value): value is string => Boolean(value));

  const parsedSlides: ParsedPptxSlide[] = [];

  for (const [index, slidePath] of slidePaths.entries()) {
    const slideDocument = await readXmlEntry(zip, slidePath);
    const slideRoot = asRecord(getChild(slideDocument, "sld")) ?? slideDocument;
    const slideRelationships = await readRelationships(
      zip,
      `ppt/slides/_rels/${path.posix.basename(slidePath)}.rels`,
    );
    const slideLayoutPath =
      slideRelationships.get("rId1") ??
      Array.from(slideRelationships.values()).find((entry) =>
        entry.includes("/slideLayouts/"),
      ) ??
      null;
    const slideLayoutDocument = slideLayoutPath
      ? await readXmlEntry(zip, slideLayoutPath)
      : null;
    const slideLayoutRoot =
      asRecord(getChild(slideLayoutDocument, "sldLayout")) ?? slideLayoutDocument;
    const slideLayoutRelationships = slideLayoutPath
      ? await readRelationships(
          zip,
          `${path.posix.dirname(slideLayoutPath)}/_rels/${path.posix.basename(slideLayoutPath)}.rels`,
        )
      : new Map<string, string>();
    const slideMasterPath =
      Array.from(slideLayoutRelationships.values()).find((entry) =>
        entry.includes("/slideMasters/"),
      ) ?? null;
    const slideMasterDocument = slideMasterPath
      ? await readXmlEntry(zip, slideMasterPath)
      : null;
    const slideMasterRoot =
      asRecord(getChild(slideMasterDocument, "sldMaster")) ?? slideMasterDocument;
    const slideMasterRelationships = slideMasterPath
      ? await readRelationships(
          zip,
          `${path.posix.dirname(slideMasterPath)}/_rels/${path.posix.basename(slideMasterPath)}.rels`,
        )
      : new Map<string, string>();
    const themePath =
      Array.from(slideMasterRelationships.values()).find((entry) =>
        entry.includes("/theme/"),
      ) ?? null;
    const themeDocument = themePath ? await readXmlEntry(zip, themePath) : null;
    const themePalette = buildThemePalette(themeDocument);

    const layoutPlaceholders = buildPlaceholderMap(
      asRecord(getChild(asRecord(getChild(slideLayoutRoot, "cSld")), "spTree")),
    );
    const masterPlaceholders = buildPlaceholderMap(
      asRecord(getChild(asRecord(getChild(slideMasterRoot, "cSld")), "spTree")),
    );

    const context: ShapeContext = {
      zip,
      relationships: slideRelationships,
      themePalette,
      slideWidthPx,
      slideHeightPx,
    };

    const slideBackground = pickPreferredBackground(
      await resolveBackground(
        zip,
        slideRoot,
        slideRelationships,
        themePalette,
        slideWidthPx,
        slideHeightPx,
      ),
      await resolveBackground(
        zip,
        slideLayoutRoot,
        slideLayoutRelationships,
        themePalette,
        slideWidthPx,
        slideHeightPx,
      ),
      await resolveBackground(
        zip,
        slideMasterRoot,
        slideMasterRelationships,
        themePalette,
        slideWidthPx,
        slideHeightPx,
      ),
    );

    const spTree = asRecord(getChild(asRecord(getChild(slideRoot, "cSld")), "spTree"));
    const extractedElements = await extractNodeElements(
      spTree ?? {},
      context,
      layoutPlaceholders,
      masterPlaceholders,
    );

    // If we extracted no visible text elements (e.g. all shapes were empty
    // placeholders), try to harvest raw text from every paragraph run in the
    // slide XML so the slide is never blank.
    const hasTextElements = extractedElements.some((el) => el.type === "text");
    let finalElements = extractedElements;

    if (!hasTextElements && spTree) {
      const allText: string[] = [];

      const harvestText = (node: XmlRecord) => {
        for (const sp of toArray(getChild(node, "sp"))) {
          const record = asRecord(sp);
          if (!record) continue;
          const txBody = asRecord(getChild(record, "txBody"));
          if (!txBody) continue;
          for (const para of toArray(getChild(txBody, "p")).map(asRecord)) {
            for (const run of toArray(getChild(para, "r")).map(asRecord)) {
              const t = getStringValue(getChild(run, "t"));
              if (t.trim()) allText.push(t);
            }
          }
        }
      };

      harvestText(spTree);

      if (allText.length > 0) {
        const fallbackFontSizePx = Math.round(96 * Math.min(slideWidthPx, slideHeightPx) / 720);
        finalElements = [
          ...extractedElements,
          {
            id: `pptx_fallback_text_${index + 1}`,
            type: "text" as const,
            x: 0,
            y: 0,
            width: slideWidthPx,
            height: slideHeightPx,
            content: allText.join(" "),
            richTextHtml: escapeHtml(allText.join(" ")),
            style: {
              fontFamily: "sans-serif",
              fontSize: fallbackFontSizePx,
              fontWeight: "400",
              fontStyle: "normal",
              color: "#000000",
              textAlign: "center" as const,
              verticalAlign: "middle" as const,
            },
          },
        ];
      }
    }

    const scaledElements = scaleElements(
      slideBackground.backgroundElement
        ? [slideBackground.backgroundElement, ...finalElements]
        : finalElements,
      slideWidthPx,
      slideHeightPx,
      1920,
      1080,
    );
    const textContent = scaledElements
      .filter((element) => element.type === "text")
      .map((element) => element.content)
      .join("\n")
      .trim();
    const effectiveBackgroundColor =
      slideBackground.backgroundColor ??
      (slideBackground.backgroundElement ? null : "#FFFFFF");

    parsedSlides.push({
      id: `pptx:${index + 1}`,
      title: `Slide ${index + 1}`,
      backgroundColor: effectiveBackgroundColor,
      elements: scaledElements,
      textContent,
    });
  }

  if (parsedSlides.length === 0) {
    throw new Error("This PPTX file does not contain any slides.");
  }

  return {
    title: path.basename(filePath, path.extname(filePath)) || "Imported presentation",
    slideWidthPx,
    slideHeightPx,
    slides: parsedSlides,
  };
}
