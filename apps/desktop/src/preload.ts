import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openOutputWindow: () => ipcRenderer.invoke('open-output-window'),
  closeOutputWindow: () => ipcRenderer.invoke('close-output-window'),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  onOutputWindowClosed: (callback: () => void) => {
    ipcRenderer.on('output-window-closed', () => callback());
  },
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  readFolder: (folderPath: string) => ipcRenderer.invoke('read-folder', folderPath),

  // Output window IPC - send state from main window to output window
  sendToOutput: (data: unknown) => ipcRenderer.send('send-to-output', data),
  onOutputData: (callback: (data: unknown) => void) => {
    ipcRenderer.on('output-data', (_event, data) => callback(data));
  },
  // Output window tells main it's ready
  notifyOutputReady: () => ipcRenderer.send('output-ready'),
  onOutputReady: (callback: () => void) => {
    ipcRenderer.on('output-ready', () => callback());
  },

  // Auth & System URLs
  beginAuthFlow: () => ipcRenderer.invoke('begin-auth-flow'),
  consumePendingAuthToken: () => ipcRenderer.invoke('consume-pending-auth-token'),
  openExternalBrowser: (url: string) => ipcRenderer.invoke('open-external-browser', url),
  onAuthCallback: (callback: (token: string) => void) => {
    ipcRenderer.on('auth-callback', (_event, token) => callback(token));
  },
});
