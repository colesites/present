import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import * as fontList from "font-list";
import type { CustomFontFace } from "../../shared/types/font";
import {
  customFontFace,
  dedupeFontFaces,
  finishSystemFontFaces,
  finishSystemFontFamilies,
  isSupportedFontFile,
  plainSystemFontFaces,
  uniqueFontFileName,
} from "../../shared/lib/font-catalog.mjs";

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

async function buildCustomFontFace(filePath: string): Promise<CustomFontFace> {
  const buffer = await fs.promises.readFile(filePath);
  return customFontFace(path.basename(filePath), filePath, buffer.toString("base64"));
}

export async function getSystemFontFamilies() {
  await ensureFontListHelperPermissions();
  const fonts = await fontList.getFonts({ disableQuoting: true });
  return finishSystemFontFamilies(fonts);
}

export async function getSystemFontFaces() {
  await ensureFontListHelperPermissions();
  try {
    const faces = await fontList.getFonts2({ disableQuoting: true });
    return finishSystemFontFaces(faces);
  } catch {
    return plainSystemFontFaces(await getSystemFontFamilies());
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
    if (!isSupportedFontFile(path.basename(filePath))) {
      continue;
    }

    const targetPath = path.join(
      directoryPath,
      uniqueFontFileName(path.basename(filePath), (name) =>
        fs.existsSync(path.join(directoryPath, name)),
      ),
    );
    await fs.promises.copyFile(filePath, targetPath);
    installedPaths.push(targetPath);
  }

  return Promise.all(installedPaths.map((filePath) => buildCustomFontFace(filePath)));
}
