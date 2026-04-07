import { BrowserWindow, dialog, ipcMain } from "electron";
import { getMainWindow } from "../windows/main.window";
import { parsePptxFile } from "../services/pptx.service";

export const registerPptxIPC = (): void => {
  ipcMain.handle("open-pptx", async (event) => {
    const parentWindow =
      BrowserWindow.fromWebContents(event.sender) ?? getMainWindow() ?? undefined;
    const result = await dialog.showOpenDialog(parentWindow, {
      properties: ["openFile"],
      filters: [
        {
          name: "PowerPoint Files",
          extensions: ["pptx"],
        },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("parse-pptx", async (_event, filePath: string) => {
    return parsePptxFile(filePath);
  });
};
