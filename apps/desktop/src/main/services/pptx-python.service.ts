import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type {
  SlideElement,
  SlideElementStyle,
  SlideTextBody,
} from "../../shared/types";
import type { ParsedPptxPresentation, ParsedPptxSlide } from "../../shared/types/pptx";

const TARGET_SLIDE_WIDTH = 1920;
const TARGET_SLIDE_HEIGHT = 1080;

type PythonTextRun = {
  text: string;
  font_name: string;
  font_size_px: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  character_spacing_px: number;
};

type PythonTextParagraph = {
  alignment: "left" | "center" | "right" | "justify";
  space_before_px: number;
  space_after_px: number;
  line_spacing: number;
  runs: PythonTextRun[];
};

type PythonTextBody = {
  inset_left_px: number;
  inset_right_px: number;
  inset_top_px: number;
  inset_bottom_px: number;
  vertical_align: "top" | "center" | "bottom";
  wrap: boolean;
  autofit: string;
  paragraphs: PythonTextParagraph[];
};

type PythonShape = {
  id?: string | number | null;
  name?: string;
  type: "text" | "image" | "shape" | "line" | "table" | "group" | "unknown";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  text_body?: PythonTextBody;
  format?: string;
  data?: string;
  fill_color?: string | null;
  line_color?: string | null;
  line_width_px?: number;
  children?: PythonShape[];
  rows?: Array<{
    index: number;
    height_px: number;
    cells: Array<{
      row_index: number;
      col_index: number;
      row_span: number;
      col_span: number;
      fill_color?: string | null;
      text_body: PythonTextBody;
    }>;
  }>;
};

type PythonSlide = {
  index: number;
  background: {
    type: "solid" | "image";
    color?: string;
    format?: string;
    data?: string;
  };
  shapes: PythonShape[];
};

type PythonPayload = {
  mode: "pptx";
  slide_width_px: number;
  slide_height_px: number;
  slides: PythonSlide[];
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readPathCandidates(filePath: string): string[] {
  return [
    path.resolve(process.resourcesPath, filePath),
    path.resolve(process.resourcesPath, "app.asar.unpacked", filePath),
    path.resolve(process.cwd(), "apps", "desktop", filePath),
    path.resolve(process.cwd(), filePath),
    path.resolve(process.cwd(), "..", filePath),
    path.resolve(process.cwd(), "..", "..", filePath),
    path.resolve(process.cwd(), "..", "..", "..", filePath),
    path.resolve(__dirname, "..", "..", "..", "..", filePath),
    path.resolve(__dirname, "..", "..", "..", "..", "..", "..", filePath),
    path.resolve(__dirname, "..", "..", "..", "..", "..", "..", "..", filePath),
  ];
}

function resolveParserScriptPath(): string {
  const candidates = readPathCandidates("parse_pptx.py");
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("parse_pptx.py was not found in expected project locations.");
}

async function runPythonParser(scriptPath: string, pptxPath: string): Promise<PythonPayload> {
  const executables = ["python3", "python"];
  let lastError: Error | null = null;

  for (const executable of executables) {
    try {
      const payload = await new Promise<PythonPayload>((resolve, reject) => {
        const child = spawn(executable, [scriptPath, "--mode", "pptx", pptxPath], {
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });

        child.on("error", (error) => {
          reject(error);
        });

        child.on("close", (code) => {
          if (code !== 0) {
            reject(
              new Error(
                `python parser exited with code ${code}. ${stderr.trim() || "No stderr output."}`,
              ),
            );
            return;
          }

          try {
            const parsed = JSON.parse(stdout) as PythonPayload;
            if (parsed?.mode !== "pptx" || !Array.isArray(parsed?.slides)) {
              throw new Error("Unexpected python parser payload shape.");
            }
            resolve(parsed);
          } catch (error) {
            reject(
              new Error(
                `Failed to parse python parser JSON output. ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
          }
        });
      });

      return payload;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.message.includes("ENOENT")) {
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("Python executable not found.");
}

function toVerticalAlign(value: string | undefined): "top" | "middle" | "bottom" {
  if (value === "top") {
    return "top";
  }
  if (value === "bottom") {
    return "bottom";
  }
  return "middle";
}

function toDataUrl(format: string | undefined, data: string | undefined): string {
  if (!data) {
    return "";
  }
  const normalizedFormat = (format ?? "png").toLowerCase();
  const mimeType = normalizedFormat === "jpg" ? "jpeg" : normalizedFormat;
  return `data:image/${mimeType};base64,${data}`;
}

function textBodyToPlainText(textBody: PythonTextBody): string {
  return textBody.paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text ?? "").join(""))
    .join("\n")
    .trim();
}

function toStructuredTextBody(textBody: PythonTextBody): SlideTextBody {
  return {
    insetLeft: textBody.inset_left_px,
    insetRight: textBody.inset_right_px,
    insetTop: textBody.inset_top_px,
    insetBottom: textBody.inset_bottom_px,
    verticalAlign: toVerticalAlign(textBody.vertical_align),
    wrap: textBody.wrap,
    autoFit: textBody.autofit,
    paragraphs: (textBody.paragraphs ?? []).map((paragraph) => ({
      alignment: paragraph.alignment,
      lineHeight: paragraph.line_spacing,
      spaceBefore: paragraph.space_before_px,
      spaceAfter: paragraph.space_after_px,
      runs: (paragraph.runs ?? []).map((run) => ({
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

function scaleTextBody(
  textBody: SlideTextBody | undefined,
  scaleX: number,
  scaleY: number,
): SlideTextBody | undefined {
  if (!textBody) {
    return undefined;
  }

  return {
    ...textBody,
    insetLeft: textBody.insetLeft === undefined ? undefined : textBody.insetLeft * scaleX,
    insetRight:
      textBody.insetRight === undefined ? undefined : textBody.insetRight * scaleX,
    insetTop: textBody.insetTop === undefined ? undefined : textBody.insetTop * scaleY,
    insetBottom:
      textBody.insetBottom === undefined ? undefined : textBody.insetBottom * scaleY,
    paragraphs: (textBody.paragraphs ?? []).map((paragraph) => ({
      ...paragraph,
      lineHeight:
        paragraph.lineHeight === undefined
          ? undefined
          : paragraph.lineHeight > 4
            ? paragraph.lineHeight * Math.min(scaleX, scaleY)
            : paragraph.lineHeight,
      spaceBefore:
        paragraph.spaceBefore === undefined
          ? undefined
          : paragraph.spaceBefore * scaleY,
      spaceAfter:
        paragraph.spaceAfter === undefined ? undefined : paragraph.spaceAfter * scaleY,
      runs: (paragraph.runs ?? []).map((run) => ({
        ...run,
        fontSize:
          run.fontSize === undefined
            ? undefined
            : run.fontSize * Math.min(scaleX, scaleY),
        letterSpacing:
          run.letterSpacing === undefined
            ? undefined
            : run.letterSpacing * scaleX,
      })),
    })),
  };
}

function scaleElement(
  element: SlideElement,
  scaleX: number,
  scaleY: number,
): SlideElement {
  const style = element.style;
  const scaledStyle: SlideElementStyle | undefined = style
    ? {
      ...style,
      fontSize:
        style.fontSize === undefined
          ? undefined
          : style.fontSize * Math.min(scaleX, scaleY),
      borderWidth:
        style.borderWidth === undefined
          ? undefined
          : style.borderWidth * Math.min(scaleX, scaleY),
      paddingLeft:
        style.paddingLeft === undefined
          ? undefined
          : style.paddingLeft * scaleX,
      paddingRight:
        style.paddingRight === undefined
          ? undefined
          : style.paddingRight * scaleX,
      paddingTop:
        style.paddingTop === undefined
          ? undefined
          : style.paddingTop * scaleY,
      paddingBottom:
        style.paddingBottom === undefined
          ? undefined
          : style.paddingBottom * scaleY,
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

function flattenShape(
  shape: PythonShape,
  slideIndex: number,
  scaleX: number,
  scaleY: number,
): SlideElement[] {
  const shapeId = `${slideIndex}_${shape.id ?? shape.name ?? Math.random().toString(36).slice(2)}`;
  const base: SlideElement = {
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
    return children.flatMap((child) => flattenShape(child, slideIndex, scaleX, scaleY));
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
      .map((row) => {
        const rowText = row.cells
          .map((cell) => {
            const text = textBodyToPlainText(cell.text_body);
            return text.trim();
          })
          .filter((text) => text.length > 0)
          .join(" | ");
        return rowText;
      })
      .filter((line) => line.length > 0)
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

function convertPayloadToPresentation(payload: PythonPayload, filePath: string): ParsedPptxPresentation {
  const sourceWidth = payload.slide_width_px || TARGET_SLIDE_WIDTH;
  const sourceHeight = payload.slide_height_px || TARGET_SLIDE_HEIGHT;
  const scaleX = TARGET_SLIDE_WIDTH / sourceWidth;
  const scaleY = TARGET_SLIDE_HEIGHT / sourceHeight;

  const slides: ParsedPptxSlide[] = payload.slides.map((slide, slideIndex) => {
    const slideElements: SlideElement[] = [];

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

export async function parsePptxWithPython(filePath: string): Promise<ParsedPptxPresentation> {
  const scriptPath = resolveParserScriptPath();
  const payload = await runPythonParser(scriptPath, filePath);
  return convertPayloadToPresentation(payload, filePath);
}
