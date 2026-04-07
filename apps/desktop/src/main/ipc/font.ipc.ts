import { BrowserWindow, dialog, ipcMain } from "electron";
import { getMainWindow } from "../windows/main.window";
import {
  getSystemFontFaces,
  getSystemFontFamilies,
  installCustomFonts,
  listInstalledCustomFonts,
} from "../services/font.service";

export const registerFontIPC = (): void => {
  ipcMain.handle("get-system-fonts", async () => {
    return getSystemFontFamilies();
  });

  ipcMain.handle("get-system-font-faces", async () => {
    return getSystemFontFaces();
  });

  ipcMain.handle("pick-font-file", async (event) => {
    const parentWindow =
      BrowserWindow.fromWebContents(event.sender) ?? getMainWindow() ?? undefined;
    const result = await dialog.showOpenDialog(parentWindow, {
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Font Files",
          extensions: ["ttf", "otf", "woff", "woff2"],
        },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths;
  });

  ipcMain.handle("install-custom-fonts", async (_event, filePaths: string[]) => {
    return installCustomFonts(filePaths ?? []);
  });

  ipcMain.handle("get-custom-fonts", async () => {
    return listInstalledCustomFonts();
  });
};
