import { app, globalShortcut } from "electron";
import { getMainWindow } from "../windows/main.window";

const AI_OPERATOR_ACCELERATOR = "Control+Alt+Space";
const AI_OPERATOR_TOGGLE_CHANNEL = "ai-operator:toggle-shortcut";

export const registerAiOperatorShortcuts = (): void => {
  const registered = globalShortcut.register(AI_OPERATOR_ACCELERATOR, () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send(AI_OPERATOR_TOGGLE_CHANNEL);
  });

  if (!registered) {
    console.warn(
      `[AI Operator] Failed to register global shortcut ${AI_OPERATOR_ACCELERATOR}.`,
    );
  }
};

export const unregisterAiOperatorShortcuts = (): void => {
  if (!app.isReady()) {
    return;
  }
  globalShortcut.unregister(AI_OPERATOR_ACCELERATOR);
};
