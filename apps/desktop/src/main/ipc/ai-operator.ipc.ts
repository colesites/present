import { ipcMain } from "electron";
import { getPresentAiTools } from "../ai/operator-tools";

export const registerAiOperatorIPC = (): void => {
  ipcMain.handle("ai-operator:list-tools", () => getPresentAiTools());
};
