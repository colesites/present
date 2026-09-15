import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ParsedPptxPresentation } from "../../shared/types/pptx";
// The payload-to-slides conversion lives in lib/pptx-payload.mjs, where
// tests/pptx-payload.test.mjs pins it for the Rust port.
import { convertPayloadToPresentation } from "../lib/pptx-payload.mjs";

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

export async function parsePptxWithPython(filePath: string): Promise<ParsedPptxPresentation> {
  const scriptPath = resolveParserScriptPath();
  const payload = await runPythonParser(scriptPath, filePath);
  return convertPayloadToPresentation(payload, filePath);
}
