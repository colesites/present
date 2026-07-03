import { screen, type BrowserWindow } from 'electron';

export type PresentScreenRole = 'audience' | 'media' | 'worship';
export type PresentScreenResolution = {
  width: number;
  height: number;
};

let preferredOutputDisplayId: number | null = null;
const preferredDisplayIds: Record<PresentScreenRole, number | null> = {
  audience: null,
  media: null,
  worship: null,
};
const preferredResolutions: Record<PresentScreenRole, PresentScreenResolution> = {
  audience: { width: 1920, height: 1080 },
  media: { width: 1920, height: 1080 },
  worship: { width: 1920, height: 1080 },
};

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
  return getPreferredDisplay('audience');
};

export const getPreferredDisplay = (role: PresentScreenRole): Electron.Display => {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const preferredDisplayId =
    role === 'audience' ? preferredOutputDisplayId : preferredDisplayIds[role];

  if (preferredDisplayId !== null) {
    const explicitDisplay = displays.find((display) => display.id === preferredDisplayId);
    if (explicitDisplay) {
      return explicitDisplay;
    }
  }

  const externals = displays.filter((d) => d.id !== primary.id);

  if (externals.length === 0) {
    return primary;
  }

  // Prefer the largest external display (usually the TV/projector).
  externals.sort((a, b) => getDisplayArea(b) - getDisplayArea(a));
  return externals[0];
};

/**
 * Set explicit preferred output display.
 */
export const setPreferredOutputDisplayId = (displayId: number | null): void => {
  preferredOutputDisplayId = Number.isFinite(displayId as number) ? displayId : null;
  preferredDisplayIds.audience = preferredOutputDisplayId;
};

/**
 * Get explicit preferred output display id.
 */
export const getPreferredOutputDisplayId = (): number | null => preferredOutputDisplayId;

export const setPreferredDisplayId = (
  role: PresentScreenRole,
  displayId: number | null,
): void => {
  const normalized = Number.isFinite(displayId as number) ? displayId : null;
  preferredDisplayIds[role] = normalized;
  if (role === 'audience') {
    preferredOutputDisplayId = normalized;
  }
};

export const getPreferredDisplayId = (role: PresentScreenRole): number | null => {
  return role === 'audience' ? preferredOutputDisplayId : preferredDisplayIds[role];
};

export const setPreferredResolution = (
  role: PresentScreenRole,
  resolution: PresentScreenResolution | null | undefined,
): void => {
  if (
    resolution &&
    Number.isFinite(resolution.width) &&
    Number.isFinite(resolution.height)
  ) {
    preferredResolutions[role] = {
      width: Math.max(320, Math.round(resolution.width)),
      height: Math.max(240, Math.round(resolution.height)),
    };
  }
};

export const getPreferredResolution = (
  role: PresentScreenRole,
): PresentScreenResolution => preferredResolutions[role];

export const parseResolution = (
  value: string | null | undefined,
): PresentScreenResolution | null => {
  if (!value) return null;
  const match = value.match(/^(\d{3,5})x(\d{3,5})$/);
  if (!match) return null;
  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10),
  };
};

export const getCenteredWindowBounds = (
  target: Electron.Display,
  resolution: PresentScreenResolution,
): Electron.Rectangle => {
  const width = Math.min(resolution.width, target.bounds.width);
  const height = Math.min(resolution.height, target.bounds.height);
  return {
    x: target.bounds.x + Math.max(0, Math.floor((target.bounds.width - width) / 2)),
    y: target.bounds.y + Math.max(0, Math.floor((target.bounds.height - height) / 2)),
    width,
    height,
  };
};

/**
 * Move output window to a specific display
 */
export const moveOutputWindowToDisplay = (
  outputWindow: BrowserWindow,
  target: Electron.Display,
  resolution?: PresentScreenResolution,
): void => {
  if (!outputWindow || outputWindow.isDestroyed()) {
    return;
  }

  const bounds = resolution
    ? getCenteredWindowBounds(target, resolution)
    : target.bounds;
  outputWindow.setBounds(
    { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    false,
  );

  if (outputWindow.isFullScreen()) {
    outputWindow.setFullScreen(false);
  }
};

export const moveWindowToDisplay = moveOutputWindowToDisplay;

/**
 * Reconcile output window display (move to preferred display)
 */
export const reconcileOutputWindowDisplay = (outputWindow: BrowserWindow | null): void => {
  if (!outputWindow || outputWindow.isDestroyed()) {
    return;
  }
  moveOutputWindowToDisplay(
    outputWindow,
    getPreferredOutputDisplay(),
    getPreferredResolution('audience'),
  );
};
