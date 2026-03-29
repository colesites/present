import path from 'path';
import { app } from 'electron';

/**
 * Check if a candidate path is within a root directory (security check)
 */
export const isPathWithinRoot = (candidatePath: string, rootPath: string): boolean => {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

/**
 * Get the web app base URL based on environment
 */
export const getWebAppBaseUrl = (): string => {
  const configuredWebUrl = process.env.WEB_APP_URL;
  if (configuredWebUrl) {
    return configuredWebUrl;
  }

  return process.env.NODE_ENV === 'development'
    ? 'http://localhost:3001'
    : 'https://present-gha.vercel.app';
};

/**
 * Check if running in development mode
 */
export const isDev = (): boolean => {
  // Check multiple indicators for development mode
  return (
    process.env.NODE_ENV === 'development' ||
    !app.isPackaged ||
    process.defaultApp === true ||
    /[\\/]electron-prebuilt[\\/]/.test(process.execPath) ||
    /[\\/]electron[\\/]/.test(process.execPath)
  );
};
