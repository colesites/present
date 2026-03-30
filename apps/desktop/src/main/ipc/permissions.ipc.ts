import { ipcMain } from "electron";
import { requestMicrophoneAccess } from "../services/media-permissions.service";

export const registerPermissionsIPC = (): void => {
  ipcMain.handle("request-microphone-access", async () => {
    return await requestMicrophoneAccess();
  });
};
