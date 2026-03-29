/**
 * Central IPC registration
 * Import and register all IPC handlers here
 */
import { registerWindowIPC } from './window.ipc';
import { registerFileIPC } from './file.ipc';
import { registerBibleIPC } from './bible.ipc';
import { registerAuthIPC } from './auth.ipc';
import { registerNetworkIPC } from './network.ipc';

/**
 * Register all IPC handlers
 */
export const registerAllIPC = (): void => {
  registerWindowIPC();
  registerFileIPC();
  registerBibleIPC();
  registerAuthIPC();
  registerNetworkIPC();
};
