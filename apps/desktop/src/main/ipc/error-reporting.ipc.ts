import { ipcMain } from "electron";
import { recordRendererError } from "../services/error-reporting.service";

export const registerErrorReportingIPC = (): void => {
  ipcMain.on("report-renderer-error", (_event, payload: unknown) => {
    recordRendererError(payload);
  });
};
