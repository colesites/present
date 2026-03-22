
interface Display {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
}

interface ElectronAPI {
  openOutputWindow: () => Promise<boolean>;
  closeOutputWindow: () => Promise<boolean>;
  getDisplays: () => Promise<Display[]>;
  onOutputWindowClosed: (callback: () => void) => void;
  selectFolder: () => Promise<{ id: string; name: string; path: string } | null>;
  readFolder: (folderPath: string) => Promise<{ name: string; lastModified: number }[]>;

  // Output window IPC
  sendToOutput: (data: unknown) => void;
  onOutputData: (callback: (data: unknown) => void) => void;
  notifyOutputReady: () => void;
  onOutputReady: (callback: () => void) => void;
}

interface Window {
  electronAPI: ElectronAPI;
}
