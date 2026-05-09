/**
 * Central IPC registration
 * Import and register all IPC handlers here
 */
import { registerWindowIPC } from './window.ipc';
import { registerFileIPC } from './file.ipc';
import { registerBibleIPC } from './bible.ipc';
import { registerAuthIPC } from './auth.ipc';
import { registerNetworkIPC } from './network.ipc';
import { registerPermissionsIPC } from './permissions.ipc';
import { registerBrowserIPC } from './browser.ipc';
import { registerFontIPC } from './font.ipc';
import { registerPptxIPC } from './pptx.ipc';
import { registerNdiIPC } from './ndi.ipc';

/**
 * Register all IPC handlers
 */
export const registerAllIPC = (): void => {
  registerWindowIPC();
  registerFileIPC();
  registerBibleIPC();
  registerAuthIPC();
  registerNetworkIPC();
  registerPermissionsIPC();
  registerBrowserIPC();
  registerFontIPC();
  registerPptxIPC();
  registerNdiIPC();
};
