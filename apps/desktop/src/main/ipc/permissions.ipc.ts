import { ipcMain } from "electron";
import {
  requestCameraAccess,
  requestMicrophoneAccess,
} from "../services/media-permissions.service";

export const registerPermissionsIPC = (): void => {
  ipcMain.handle("request-microphone-access", async () => {
    return await requestMicrophoneAccess();
  });

  ipcMain.handle("request-camera-access", async () => {
    return await requestCameraAccess();
  });
};
