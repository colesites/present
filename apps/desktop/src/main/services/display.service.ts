import { screen, type BrowserWindow } from 'electron';

/**
 * Get the display area (width * height)
 */
const getDisplayArea = (display: Electron.Display): number => {
  return display.bounds.width * display.bounds.height;
};

/**
 * Get the preferred output display (largest external, or primary if none)
 */
export const getPreferredOutputDisplay = (): Electron.Display => {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const externals = displays.filter((d) => d.id !== primary.id);

  if (externals.length === 0) {
    return primary;
  }

  // Prefer the largest external display (usually the TV/projector).
  externals.sort((a, b) => getDisplayArea(b) - getDisplayArea(a));
  return externals[0];
};

/**
 * Move output window to a specific display
 */
export const moveOutputWindowToDisplay = (outputWindow: BrowserWindow, target: Electron.Display): void => {
  if (!outputWindow || outputWindow.isDestroyed()) {
    return;
  }

  const { bounds } = target;
  // Move first (so fullscreen is applied on correct display).
  outputWindow.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, false);

  const isPrimary = target.id === screen.getPrimaryDisplay().id;
  if (isPrimary) {
    if (outputWindow.isFullScreen()) {
      outputWindow.setFullScreen(false);
    }
  } else {
    if (!outputWindow.isFullScreen()) {
      outputWindow.setFullScreen(true);
    }
  }
};

/**
 * Reconcile output window display (move to preferred display)
 */
export const reconcileOutputWindowDisplay = (outputWindow: BrowserWindow | null): void => {
  if (!outputWindow || outputWindow.isDestroyed()) {
    return;
  }
  moveOutputWindowToDisplay(outputWindow, getPreferredOutputDisplay());
};
