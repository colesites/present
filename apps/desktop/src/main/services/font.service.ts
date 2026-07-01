import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import * as fontList from "font-list";
import type { CustomFontFace, SystemFontFace } from "../../shared/types/font";
import {
  dedupeFontFaces,
  getFontFileMimeType,
  inferFontMetaFromFileName,
  normalizeFontStyleMeta,
  normalizeFontWeightMeta,
  SUPPORTED_CUSTOM_FONT_EXTENSIONS,
} from "../../shared/lib/font";

const CUSTOM_FONT_DIRECTORY_NAME = "custom-fonts";
const FONT_LIST_DARWIN_HELPERS = ["fontlist", "fontlist2"] as const;

function getCustomFontDirectory() {
  return path.join(app.getPath("userData"), CUSTOM_FONT_DIRECTORY_NAME);
}

async function ensureFontListHelperPermissions() {
  if (process.platform !== "darwin") {
    return;
  }

  await Promise.all(
    FONT_LIST_DARWIN_HELPERS.map(async (helperName) => {
      const helperPath = path.join(__dirname, "native_modules", helperName);
      try {
        await fs.promises.chmod(helperPath, 0o755);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`Unable to update ${helperName} permissions`, error);
        }
      }
    }),
  );
}

async function ensureCustomFontDirectory() {
  const directoryPath = getCustomFontDirectory();
  await fs.promises.mkdir(directoryPath, { recursive: true });
  return directoryPath;
}

function isSupportedFontFile(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  return SUPPORTED_CUSTOM_FONT_EXTENSIONS.includes(
    extension as (typeof SUPPORTED_CUSTOM_FONT_EXTENSIONS)[number],
  );
}

function createUniqueTargetPath(directoryPath: string, originalFileName: string) {
  const parsed = path.parse(originalFileName);
  const extension = parsed.ext || ".ttf";
  const safeStem = parsed.name.trim() || "Custom Font";
  let candidatePath = path.join(directoryPath, `${safeStem}${extension}`);
  let counter = 1;

  while (fs.existsSync(candidatePath)) {
    candidatePath = path.join(
      directoryPath,
      `${safeStem} ${counter}${extension}`,
    );
    counter += 1;
  }

  return candidatePath;
}

function mapSystemFontFace(face: fontList.IFontInfo): SystemFontFace {
  const weightMeta = normalizeFontWeightMeta(face.weight);
  const styleMeta = normalizeFontStyleMeta(face.style);

  return {
    familyName: face.familyName.trim(),
    postScriptName: face.postScriptName.trim(),
    weight: weightMeta.weight,
    weightLabel: weightMeta.weightLabel,
    style: styleMeta.style,
    styleLabel: styleMeta.styleLabel,
    width: face.width?.trim() ?? "",
    monospace: Boolean(face.monospace),
    source: "system",
  };
}

async function buildCustomFontFace(filePath: string): Promise<CustomFontFace> {
  const fileName = path.basename(filePath);
  const buffer = await fs.promises.readFile(filePath);
  const inferred = inferFontMetaFromFileName(fileName);

  return {
    familyName: inferred.familyName,
    postScriptName: path.parse(fileName).name,
    weight: inferred.weight,
    weightLabel: inferred.weightLabel,
    style: inferred.style,
    styleLabel: inferred.styleLabel,
    width: "",
    monospace: false,
    source: "custom",
    fileName,
    filePath,
    dataUrl: `data:${getFontFileMimeType(fileName)};base64,${buffer.toString("base64")}`,
  };
}

export async function getSystemFontFamilies() {
  await ensureFontListHelperPermissions();
  const fonts = await fontList.getFonts({ disableQuoting: true });
  return Array.from(
    new Set(fonts.map((font) => font.trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));
}

export async function getSystemFontFaces() {
  await ensureFontListHelperPermissions();
  try {
    const faces = await fontList.getFonts2({ disableQuoting: true });
    return dedupeFontFaces(
      faces
        .map(mapSystemFontFace)
        .filter((face) => Boolean(face.familyName) && Boolean(face.postScriptName)),
    );
  } catch {
    const families = await getSystemFontFamilies();
    return families.map<SystemFontFace>((familyName) => ({
      familyName,
      postScriptName: familyName,
      weight: "400",
      weightLabel: "Regular",
      style: "normal",
      styleLabel: "Normal",
      width: "",
      monospace: false,
      source: "system",
    }));
  }
}

export async function listInstalledCustomFonts() {
  const directoryPath = getCustomFontDirectory();
  if (!fs.existsSync(directoryPath)) {
    return [] as CustomFontFace[];
  }

  const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && isSupportedFontFile(entry.name))
    .map((entry) => path.join(directoryPath, entry.name));

  return dedupeFontFaces(
    await Promise.all(files.map((filePath) => buildCustomFontFace(filePath))),
  );
}

export async function installCustomFonts(filePaths: string[]) {
  const directoryPath = await ensureCustomFontDirectory();
  const installedPaths: string[] = [];

  for (const filePath of filePaths) {
    if (!isSupportedFontFile(filePath)) {
      continue;
    }

    const targetPath = createUniqueTargetPath(directoryPath, path.basename(filePath));
    await fs.promises.copyFile(filePath, targetPath);
    installedPaths.push(targetPath);
  }

  return Promise.all(installedPaths.map((filePath) => buildCustomFontFace(filePath)));
}
